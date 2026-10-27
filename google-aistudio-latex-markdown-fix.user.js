// ==UserScript==
// @name         Google AI Studio - LaTeX and Markdown Render Fix
// @name:zh-CN   Google AI Studio LaTeX 与 Markdown 修复
// @name:ja      Google AI Studio 数式＆Markdownレンダリング修正
// @namespace    https://github.com/m1kuk1m/google-aistudio-latex-markdown-fix
// @version      1.1.0
// @description  Fixes LaTeX table truncation, broken matrix pipes, streaming race conditions, dollar currency math misrenderings, and formatting glitches in Google AI Studio.
// @description:zh-CN 修复 Google AI Studio 上的 Markdown 表格公式截断、分块矩阵竖线丢失、流式输出覆盖、美元符号误渲染公式及排版渲染问题
// @description:ja Google AI Studioにおける数式テーブルの途切れ、分割行列の縦線欠落、ストリーミング時の上書き、ドル記号の誤レンダリング、各種装飾の不具合を修正します
// @author       m1kuk1m
// @match        https://aistudio.google.com/*
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
// @run-at       document-start
// @grant        unsafeWindow
// @inject-into  page
// @sandbox      raw
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // 0. 环境桥接：安全获取真实页面 window 对象（兼容 Firefox Xray Vision 与各类油猴运行模式）
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : (typeof window !== 'undefined' ? window : globalThis);

    // 1. 原始 Markdown 缓冲池与 Angular LView 映射存储 (弱引用避免内存泄漏)
    const rawMarkdownLines = new Set();
    const lViewMapRefs = [];
    const seenMaps = new WeakSet();

    // 钩子 E: 拦截 Map.prototype.set 弱引用记录 Angular LView 映射表
    const hookMapPrototype = (targetMap) => {
        if (!targetMap || !targetMap.prototype) return;
        const origMapSet = targetMap.prototype.set;
        targetMap.prototype.set = function (k, v) {
            if (typeof k === 'number' && Array.isArray(v) && v.length >= 10 && !seenMaps.has(this) && lViewMapRefs.length < 16) {
                seenMaps.add(this);
                if (typeof WeakRef !== 'undefined') {
                    lViewMapRefs.push(new WeakRef(this));
                } else {
                    lViewMapRefs.push({ deref: () => this });
                }
            }
            return origMapSet.apply(this, arguments);
        };
    };
    hookMapPrototype(win.Map);
    if (typeof window !== 'undefined' && window !== win && window.Map) {
        hookMapPrototype(window.Map);
    }

    function getLViewById(id) {
        for (let i = 0; i < lViewMapRefs.length; i++) {
            const m = lViewMapRefs[i].deref();
            if (m && typeof m.get === 'function') {
                const v = m.get(id);
                if (v) return v;
            }
        }
        return null;
    }

    // 校验表格行中的公式与环境是否已完整闭合（防止流式半截行污染缓冲池）
    function isCompleteTableLine(line) {
        if (!line || typeof line !== 'string') return false;
        const begins = (line.match(/\\begin\{[^}]+\}/g) || []).length;
        const ends = (line.match(/\\end\{[^}]+\}/g) || []).length;
        if (begins !== ends) return false;
        // 过滤独立美元货币金额（如 $2.00、**$4.00**），避免单列货币金额误导公式配对判断
        const withoutCurrency = line.replace(/(?<!\\)\$\d+(?:[.,]\d+)*(?:\s*[kKmMbB万亿]|\/[a-zA-Z\u4e00-\u9fa5]+)?(?!\$)/g, '');
        const withoutDouble = withoutCurrency.replace(/\$\$/g, '');
        const dollars = (withoutDouble.match(/(?<!\\)\$/g) || []).length;
        if (dollars % 2 !== 0 && begins === 0) return false;
        return true;
    }

    // 符合 GFM 标准的表格行：首尾必须为竖线 |
    const TABLE_ROW_RE = /^\|.+\|$/;
    const JSON_ESC = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

    // 标准 RFC 8259 JSON 字符串反转义（单趟线性替换，避免 \\neq 中的 \n 被误当作换行）
    function jsonUnescape(s) {
        if (typeof s !== 'string') return '';
        return s.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\\/bfnrt]))/g, (_, hex, ch) =>
            hex ? String.fromCharCode(parseInt(hex, 16)) : JSON_ESC[ch]
        );
    }

    // 智能收集字符串中的 Markdown 表格候选行（自动去重并按最新顺序维护，上限 1500 条）
    function collectRawLinesFromString(str) {
        if (typeof str !== 'string' || !str.includes('|')) return;
        const lines = str.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (TABLE_ROW_RE.test(line) && (line.includes('begin{') || line.includes('$')) && isCompleteTableLine(line)) {
                rawMarkdownLines.delete(line);
                rawMarkdownLines.add(line);
                if (rawMarkdownLines.size > 1500) {
                    const oldest = rawMarkdownLines.values().next().value;
                    rawMarkdownLines.delete(oldest);
                }
            }
        }
    }

    // 从原始 JSON 文本中提取所有字符串字面量并解码为真实 Markdown
    const JSON_STR_RE = /"((?:[^"\\]|\\.)*)"/g;
    function collectFromJsonText(text, state) {
        if (!text || typeof text !== 'string' || !text.includes('|')) return;
        JSON_STR_RE.lastIndex = state ? state.pos || 0 : 0;
        let m;
        while ((m = JSON_STR_RE.exec(text)) !== null) {
            if (m[1].includes('|')) {
                collectRawLinesFromString(jsonUnescape(m[1]));
            }
            if (state) state.pos = JSON_STR_RE.lastIndex;
        }
    }

    // ==================== 2. 全域网络与流式拦截器 (解决手机火狐无法捕获数据流的问题) ====================

    // 保存底层原生的 TextDecoder.prototype.decode，供 fetch 内部调用，避免重复触发 Hook C
    const rawDecode = (win.TextDecoder && win.TextDecoder.prototype && win.TextDecoder.prototype.decode)
        ? win.TextDecoder.prototype.decode
        : (typeof TextDecoder !== 'undefined' ? TextDecoder.prototype.decode : null);

    // 钩子 A: 拦截 fetch (AI Studio 的核心流式数据通信管道 streamGenerateContent)
    if (typeof win.fetch === 'function') {
        const origFetch = win.fetch;
        win.fetch = function (...args) {
            const fetchPromise = origFetch.apply(this, args);
            fetchPromise.then((response) => {
                try {
                    if (response && response.clone) {
                        const ct = (response.headers && response.headers.get('content-type')) || '';
                        // 过滤二进制或多媒体响应，避免无谓克隆与解码
                        if (/^(image|video|audio|font)\/|octet-stream|wasm/i.test(ct)) {
                            return;
                        }
                        const clone = response.clone();
                        if (clone.body && typeof clone.body.getReader === 'function') {
                            const reader = clone.body.getReader();
                            const decoder = new (win.TextDecoder || TextDecoder)();
                            let accumulatedText = '';
                            const streamState = { pos: 0 };

                            const pump = () => {
                                reader.read().then(({ done, value }) => {
                                    if (value) {
                                        const chunk = rawDecode
                                            ? rawDecode.call(decoder, value, { stream: !done })
                                            : decoder.decode(value, { stream: !done });
                                        accumulatedText += chunk;
                                        collectRawLinesFromString(chunk);
                                        collectFromJsonText(accumulatedText, streamState);
                                    }
                                    if (!done) {
                                        pump();
                                    } else {
                                        collectFromJsonText(accumulatedText, streamState);
                                        collectRawLinesFromString(accumulatedText);
                                    }
                                }).catch(() => {});
                            };
                            pump();
                        }
                    }
                } catch (e) {}
            }).catch(() => {});
            return fetchPromise;
        };
    }

    // 钩子 B: 拦截 JSON.parse (捕获一次性下发的 JSPB 数据)
    if (win.JSON && win.JSON.parse) {
        const origJSONParse = win.JSON.parse;
        win.JSON.parse = function () {
            const res = origJSONParse.apply(this, arguments);
            try {
                const rawArg = arguments[0];
                if (typeof rawArg === 'string' && (rawArg.includes('begin{') || rawArg.includes('|'))) {
                    const scanObj = (obj, depth) => {
                        if (depth > 25 || !obj) return;
                        if (typeof obj === 'string') {
                            collectRawLinesFromString(obj);
                        } else if (Array.isArray(obj)) {
                            for (let i = 0; i < obj.length; i++) scanObj(obj[i], depth + 1);
                        } else if (typeof obj === 'object') {
                            for (const k in obj) scanObj(obj[k], depth + 1);
                        }
                    };
                    scanObj(res, 0);
                }
            } catch (e) {}
            return res;
        };
    }

    // 钩子 C: 拦截 TextDecoder (捕获流式文本解码)
    if (win.TextDecoder) {
        const origDecode = win.TextDecoder.prototype.decode;
        win.TextDecoder.prototype.decode = function () {
            const str = origDecode.apply(this, arguments);
            try {
                if (str && (str.includes('begin{') || str.includes('|'))) {
                    collectRawLinesFromString(str);
                    collectFromJsonText(str, null);
                }
            } catch (e) {}
            return str;
        };
    }

    // 钩子 D: 拦截 XMLHttpRequest (兜底其他旧版网络请求)
    if (win.XMLHttpRequest) {
        const origSend = win.XMLHttpRequest.prototype.send;
        win.XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', function () {
                try {
                    if (typeof this.responseText === 'string' && (this.responseText.includes('begin{') || this.responseText.includes('|'))) {
                        collectRawLinesFromString(this.responseText);
                        collectFromJsonText(this.responseText, null);
                    }
                } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };
    }

    // 钩子 F: 拦截 IntersectionObserver 与 focus，彻底根治手机端横向拉到底时虚拟滚动卸载导致的强制弹回
    const hookIntersectionAndFocus = (targetWin) => {
        if (!targetWin) return;

        // F1: 扩展 IntersectionObserver 水平 rootMargin 并拦截因横向滚动触发的伪离屏卸载
        if (typeof targetWin.IntersectionObserver === 'function' && !targetWin.IntersectionObserver.__msHooked) {
            const OrigIO = targetWin.IntersectionObserver;
            const expandHorizontalMargin = (marginStr) => {
                if (!marginStr || typeof marginStr !== 'string') return '0px 100000px 0px 100000px';
                const parts = marginStr.trim().split(/\s+/);
                if (parts.length === 1) return `${parts[0]} 100000px ${parts[0]} 100000px`;
                if (parts.length === 2) return `${parts[0]} 100000px ${parts[0]} 100000px`;
                if (parts.length === 3) return `${parts[0]} 100000px ${parts[2]} 100000px`;
                if (parts.length === 4) return `${parts[0]} 100000px ${parts[2]} 100000px`;
                return '0px 100000px 0px 100000px';
            };

            const WrappedIO = function (callback, options) {
                const wrappedCallback = function (entries, observer) {
                    if (!Array.isArray(entries)) return callback.call(this, entries, observer);
                    const asc = document.querySelector('ms-autoscroll-container');
                    const isHorizontallyScrolled = asc && asc.scrollLeft > 2;

                    const filtered = entries.filter((entry) => {
                        if (entry.isIntersecting) return true;
                        const rect = entry.boundingClientRect;
                        if (!rect || rect.height === 0) return true;
                        const rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
                        const rootBottom = entry.rootBounds ? entry.rootBounds.bottom : (targetWin.innerHeight || 1000);
                        const verticallyVisible = rect.bottom > rootTop - 300 && rect.top < rootBottom + 300;
                        // 若元素在纵向仍处于屏幕可视范围（仅因横向拉动导致 X 轴滑出屏幕），绝不通知 Angular 卸载
                        if (verticallyVisible && (isHorizontallyScrolled || rect.right <= 50)) {
                            return false;
                        }
                        return true;
                    });

                    if (filtered.length > 0) {
                        return callback.call(this, filtered, observer);
                    }
                };

                let newOpts = options;
                try {
                    newOpts = Object.assign({}, options || {});
                    newOpts.rootMargin = expandHorizontalMargin(newOpts.rootMargin);
                    return new OrigIO(wrappedCallback, newOpts);
                } catch (e) {
                    return new OrigIO(wrappedCallback, options);
                }
            };
            WrappedIO.prototype = OrigIO.prototype;
            WrappedIO.__msHooked = true;
            try {
                targetWin.IntersectionObserver = WrappedIO;
            } catch (e) {}
        }

        // F2: 阻止触摸或点击超宽公式右侧时 tabindex="-1" 容器触发浏览器焦点滚动归零
        if (targetWin.HTMLElement && targetWin.HTMLElement.prototype && !targetWin.HTMLElement.prototype.focus.__msHooked) {
            const origFocus = targetWin.HTMLElement.prototype.focus;
            const wrappedFocus = function (options) {
                try {
                    const asc = document.querySelector('ms-autoscroll-container');
                    const tag = this.tagName ? this.tagName.toLowerCase() : '';
                    const isTurnContainer =
                        tag === 'ms-autoscroll-container' ||
                        tag === 'ms-chat-turn' ||
                        (this.classList && (this.classList.contains('chat-turn-container') || this.classList.contains('virtual-scroll-container')));
                    if (isTurnContainer || (asc && asc.scrollLeft > 2)) {
                        const safeOpts = Object.assign({}, options || {}, { preventScroll: true });
                        return origFocus.call(this, safeOpts);
                    }
                } catch (e) {}
                return origFocus.apply(this, arguments);
            };
            wrappedFocus.__msHooked = true;
            try {
                targetWin.HTMLElement.prototype.focus = wrappedFocus;
            } catch (e) {}
        }
    };
    hookIntersectionAndFocus(win);
    if (typeof window !== 'undefined' && window !== win) {
        hookIntersectionAndFocus(window);
    }

    // ==================== 3. KaTeX 原生 DOM 渲染与语法还原 ====================

    function getKaTeX() {
        if (typeof katex !== 'undefined') return katex;
        if (typeof window !== 'undefined' && window.katex) return window.katex;
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.katex) return unsafeWindow.katex;
        return null;
    }

    // 原生 DOM 模式渲染 KaTeX（不使用 innerHTML，彻底规避 Trusted Types 与 XSS 风险）
    function renderTexInto(el, tex, displayMode, k) {
        if (!el || !k) return;
        el.textContent = '';
        try {
            k.render(tex, el, {
                displayMode: !!displayMode,
                throwOnError: false,
                strict: false
            });
            // 兼容 Google AI Studio 定制版 katex.min.css（补齐 .katex-sizing 使上下标字号正常缩小）
            const sizings = el.querySelectorAll('.sizing');
            for (let i = 0; i < sizings.length; i++) {
                sizings[i].classList.add('katex-sizing');
            }
        } catch (e) {
            el.textContent = tex;
        }
    }

    // 还原被 CommonMark 当作普通文本转义而吞掉反斜杠的 LaTeX 语法（如 `\;\;` -> `;;`、`\left\{` -> `\left{`）
    function restoreCommonMarkEatenLatexEscapes(tex) {
        if (!tex) return tex;
        return tex
            .replace(/(?<!\\)\\(?=\s|$|[0-9-])/gm, '\\\\')
            .replace(/(&\s*)([;,:!]+)(?=\s*\\|\s|$)/g, (_, prefix, chars) =>
                prefix + chars.split('').map((c) => '\\' + c).join('')
            )
            .replace(/(?<![\\a-zA-Z0-9])(;{2,}|;(?=\s*\\(?:vdots|cdots|dots|ldots|ddots)))/g, (m) =>
                m.split('').map(() => '\\;').join('')
            )
            .replace(/\\left\s*\{/g, '\\left\\{')
            .replace(/\\right\s*\}/g, '\\right\\}');
    }

    // 清理节点内的幽灵标签并还原符号
    function extractCleanTex(node) {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('[data-ms-math-seg], [data-ms-math-text], [data-ms-bold-seg], [data-ms-sub-tilde]').forEach((n) => n.remove());

        // 必须先还原 ms-katex / .katex（因其内部包含 <pre><code class="rendered">），再移除普通 code / pre
        clone.querySelectorAll('ms-katex, .katex').forEach((k) => {
            if (!clone.contains(k)) return;
            const ann = k.querySelector('annotation[encoding="application/x-tex"]');
            const raw = ann ? ann.textContent.trim() : '';
            if (k.hasAttribute('data-ms-unmath')) {
                k.replaceWith(document.createTextNode('$' + raw + '$'));
                return;
            }
            k.replaceWith(document.createTextNode(raw));
        });

        clone.querySelectorAll('code, pre').forEach((n) => n.remove());

        clone.querySelectorAll('em, i, span[style*="italic"]').forEach((em) => {
            em.before(document.createTextNode('_'));
            em.after(document.createTextNode('_'));
        });

        clone.querySelectorAll('sub:not([data-ms-unsub])').forEach((sub) => {
            sub.before(document.createTextNode('~'));
            sub.after(document.createTextNode('~'));
        });

        clone.querySelectorAll('br').forEach((br) => {
            br.replaceWith(document.createTextNode('\n'));
        });

        return clone.textContent || '';
    }

    // ==================== 4. 原始 Markdown 检索与解析 ====================

    const normTableTitle = (s) => (s || '').replace(/[\s$*_`~]/g, '');

    function findRawTableLine(tr, rowTitle, expectedCols) {
        if (!rowTitle) return null;
        const want = normTableTitle(rowTitle);

        // 1) 从网络/JSON 截获池里倒序匹配（优先最新的完整行）
        const lines = Array.from(rawMarkdownLines);
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line.includes('|')) continue;
            const cols = splitMarkdownTableRow(line);
            if (cols.length === expectedCols && normTableTitle(cols[0]) === want && isCompleteTableLine(line)) {
                return line;
            }
        }

        // 2) 递归搜索 Angular LView
        const visited = new WeakSet();
        let foundLine = null;

        function searchObj(obj, depth, isTopLView) {
            if (depth > 12 || !obj || foundLine) return;

            if (typeof obj === 'string') {
                if (obj.includes(rowTitle) && obj.includes('|')) {
                    const lines = obj.split(/\r?\n/);
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const trimmed = lines[i].trim();
                        if (trimmed.includes('|') && isCompleteTableLine(trimmed)) {
                            const cols = splitMarkdownTableRow(trimmed);
                            if (cols.length === expectedCols && normTableTitle(cols[0]) === want) {
                                foundLine = trimmed;
                                return;
                            }
                        }
                    }
                }
                return;
            }

            // 穿透 Angular Signals
            if (typeof obj === 'function') {
                if (visited.has(obj)) return;
                visited.add(obj);
                const syms = Object.getOwnPropertySymbols(obj);
                for (let i = 0; i < syms.length; i++) {
                    try { searchObj(obj[syms[i]], depth + 1, false); } catch (e) {}
                }
                return;
            }

            if (typeof obj !== 'object' || obj instanceof Node || obj instanceof Window || obj instanceof Document) return;
            if (visited.has(obj)) return;
            visited.add(obj);

            if (Array.isArray(obj)) {
                const limit = Math.min(obj.length, 100);
                for (let i = 0; i < limit; i++) {
                    if (isTopLView && (i === 1 || i === 3 || i === 4 || i === 11)) continue;
                    try { searchObj(obj[i], depth + 1, false); } catch (e) {}
                }
                return;
            }

            const keys = [
                ...Object.getOwnPropertyNames(obj),
                ...Object.getOwnPropertySymbols(obj)
            ];
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const ks = String(k);
                if (ks === 'tView' || ks === 'parent' || ks === 'next' || ks === 'injector') continue;
                try { searchObj(obj[k], depth + 1, false); } catch (e) {}
            }
        }

        // 沿 DOM 树向上查找，穿透火狐 Xray Vision
        let cur = tr;
        while (cur && cur !== document.body && !foundLine) {
            const unwrapped = cur.wrappedJSObject || cur;
            const ctx = unwrapped.__ngContext__;

            if (Array.isArray(ctx)) {
                searchObj(ctx, 0, true);
            } else if (typeof ctx === 'number') {
                const lview = getLViewById(ctx);
                if (lview) searchObj(lview, 0, true);
            } else if (typeof ctx === 'object' && ctx !== null) {
                searchObj(ctx, 0, false);
            }
            cur = cur.parentElement;
        }

        return foundLine;
    }

    // 智能分割 Markdown 表格行（自动忽略 $...$ 与 {...} 内部的竖线 |）
    function splitMarkdownTableRow(line) {
        let s = line.trim();
        if (s.startsWith('|')) s = s.slice(1);
        if (s.endsWith('|')) s = s.slice(0, -1);

        const cols = [];
        let cur = '';
        let inMath = false;
        let braceDepth = 0;

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            const prev = i > 0 ? s[i - 1] : '';

            if (ch === '$' && prev !== '\\') {
                inMath = !inMath;
                cur += ch;
            } else if (ch === '{' && prev !== '\\') {
                braceDepth++;
                cur += ch;
            } else if (ch === '}' && prev !== '\\') {
                braceDepth = Math.max(0, braceDepth - 1);
                cur += ch;
            } else if (ch === '|' && prev !== '\\' && !inMath && braceDepth === 0) {
                cols.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        cols.push(cur.trim());
        return cols;
    }

    // 单元格安全渲染助手（支持纯公式、多公式混排与纯文本，100% 避免 HTML 注入）
    function renderCellWithKaTeX(td, rawContent, k) {
        const s = (rawContent || '').trim();
        if (!s) return;

        // 匹配 $$...$$ 块级公式或 $...$ 行内公式（严格要求开启符右无空格、闭合符左无空格且后不紧跟数字）
        const mathRe = /\$\$([\s\S]+?)\$\$|(?<!\\|\$)\$(?!\s)([\s\S]+?)(?<!\s|\\)\$(?!\$)/g;
        let lastIdx = 0;
        let match;
        let hasMath = false;
        const frag = document.createDocumentFragment();

        while ((match = mathRe.exec(s)) !== null) {
            const isDisplay = match[1] !== undefined;
            const inner = isDisplay ? match[1] : match[2];
            const trimmedInner = inner.trim();

            // 若为单美元符号，检查是否为货币误匹配（如输入 $1.00 / 输出 $5.00）
            if (!isDisplay) {
                const afterMatch = s.slice(match.index + match[0].length);
                if (/^[0-9]/.test(afterMatch) || (/^[0-9]/.test(trimmedInner) && (
                    /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(trimmedInner) ||
                    /\*\*/.test(trimmedInner) ||
                    /\/(?:mo|month|yr|year|day|hr|hour|user|seat|token|tokens|1M|M|k)\b/i.test(trimmedInner)
                ))) {
                    continue;
                }
            }

            hasMath = true;
            if (match.index > lastIdx) {
                frag.appendChild(document.createTextNode(s.slice(lastIdx, match.index)));
            }
            const tex = restoreCommonMarkEatenLatexEscapes(trimmedInner);
            const span = document.createElement('span');
            renderTexInto(span, tex, isDisplay, k);
            frag.appendChild(span);
            lastIdx = mathRe.lastIndex;
        }

        if (hasMath) {
            if (lastIdx < s.length) {
                frag.appendChild(document.createTextNode(s.slice(lastIdx)));
            }
            td.textContent = '';
            td.appendChild(frag);
        } else {
            if (!td.textContent || td.textContent.trim() === '') {
                td.textContent = s;
            }
        }
    }

    // ==================== 5. 核心修复逻辑 ====================

    // ==================== 5.05 修复被误渲染为公式的美元货币符号 (v1.1.0 新增) ====================
    // 根因：AI Studio 官方前端 Markdown 解析器缺失 Pandoc 规范中“右闭合 $ 后方不能紧跟数字”的校验。
    // 当模型输出形如 `（$19.99/月）和 **Google AI Ultra**（$99.99/月起）` 时，第一个 $（$19.99）符合开启规则，
    // 第二个 $（（$99.99）因左侧紧挨中文全角左括号（无空格）被误判为闭合符，导致首尾 $ 被吞噬，
    // 夹在中间的正文与 ** 加粗标记被塞进 <ms-katex class="inline"> 导致空格丢失（$GoogleAIUltra$）且加粗失效变成数学星号。
    // 方案：
    // 1. 原生 DOM 零破坏：保留 <ms-katex> 节点在 DOM 树中的真实引用（维持 Angular Ivy LView 索引），将其置为 inline 并隐藏内部原生 <pre>；
    // 2. 智能分类与还原：识别纯货币对（恢复首尾 $ 与原始正文）及“货币+真公式”混排拆分还原；
    // 3. 管道协同：将还原后的文本置入 <span data-ms-currency-restore="1">，允许后置的 fixBrokenBoldMarkdown 无缝扫描并将其中的 ** 加粗恢复为 <strong>。
    function fixBrokenCurrencyMath() {
        const k = getKaTeX();
        const katexElements = document.querySelectorAll(
            'ms-cmark-node ms-katex, .markdown-content ms-katex, ms-katex'
        );
        if (!katexElements || katexElements.length === 0) return;

        function getNextImmediateText(node, blockContainer) {
            let cur = node;
            while (cur && cur !== blockContainer) {
                let sib = cur.nextSibling;
                while (sib) {
                    if (sib.nodeType === 3) {
                        const val = sib.nodeValue || '';
                        if (val.length > 0) return val;
                    } else if (sib.nodeType === 1) {
                        if (!sib.hasAttribute('data-ms-currency-restore')) {
                            const txt = sib.textContent || '';
                            if (txt.length > 0) return txt;
                        }
                    }
                    sib = sib.nextSibling;
                }
                cur = cur.parentNode;
            }
            return '';
        }

        katexElements.forEach((katexEl) => {
            if (katexEl.classList.contains('display') || (katexEl.parentElement && katexEl.parentElement.classList.contains('display'))) {
                return;
            }

            const ann = katexEl.querySelector('annotation[encoding="application/x-tex"]');
            const rawTex = ann ? ann.textContent : '';
            if (!rawTex) return;

            // 若已处理过且内容未发生流式变动，直接跳过
            if (katexEl.hasAttribute('data-ms-unmath')) {
                if (katexEl._msUnmathRaw === rawTex && katexEl._msRestoreSpan && katexEl._msRestoreSpan.isConnected) {
                    return;
                }
            }

            const trimmed = rawTex.trim();
            if (!/^[0-9]/.test(trimmed)) return;

            const blockContainer = katexEl.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote') || katexEl.parentElement;
            const nextText = getNextImmediateText(katexEl, blockContainer);

            // 规则 1: 紧跟数字（Pandoc 黄金规则，闭合 $ 之后紧跟数字，100% 为第二个金额的前缀，如 $99.99）
            const nextStartsWithDigit = /^[0-9]/.test(nextText);

            // 规则 2: 去除合法 \text{...} 等数学文本命令后，内容含有非数学排版特征（CJK、全角标点、加粗标记、常见货币周期单位等）
            const texWithoutTextCmds = trimmed.replace(/\\(?:text|mbox|textrm|textbf|textit|mathrm)\s*\{[^}]*\}/g, '');
            const hasCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(texWithoutTextCmds);
            const hasFullwidthPunct = /[\u3000-\u303f\uff00-\uffef—…·「」『』《》【】（）]/.test(texWithoutTextCmds);
            const hasBoldMarker = /\*\*/.test(texWithoutTextCmds);
            const hasCurrencyUnit = /\/(?:mo|month|yr|year|day|hr|hour|user|seat|token|tokens|1M|M|k)\b/i.test(texWithoutTextCmds);
            const hasInnerDollar = /(?<!\\)\$/.test(texWithoutTextCmds);

            const isCurrencyFalsePositive =
                nextStartsWithDigit ||
                hasCJK ||
                hasFullwidthPunct ||
                hasBoldMarker ||
                hasCurrencyUnit ||
                hasInnerDollar;

            if (!isCurrencyFalsePositive) return;

            // 若容器已有加粗状态，先还原加粗，待文本重置后再由加粗状态机统一重跑
            if (blockContainer && typeof blockContainer._msBoldRestore === 'function' && blockContainer._msBoldState) {
                blockContainer._msBoldRestore();
            }

            // 清理旧还原节点
            if (katexEl._msRestoreSpan && katexEl._msRestoreSpan.parentNode === katexEl) {
                katexEl._msRestoreSpan.remove();
            }

            // 标记 <ms-katex> 并隐藏内部 <pre>
            katexEl.setAttribute('data-ms-unmath', '1');
            katexEl.style.display = 'inline';
            const pre = katexEl.querySelector('pre');
            if (pre) pre.style.display = 'none';

            // 检查是否为“货币 + 真公式”混排拆分场景（如：单价为 $19.99/月，满足 $n \ge 100 时打折）
            let isMixed = false;
            let part1 = '';
            let part2 = '';
            if (hasInnerDollar && !nextStartsWithDigit) {
                const dollarIdx = trimmed.indexOf('$');
                if (dollarIdx > 0) {
                    const p1 = trimmed.slice(0, dollarIdx);
                    const p2 = trimmed.slice(dollarIdx + 1);
                    const p1NoCmds = p1.replace(/\\(?:text|mbox|textrm|textbf|textit|mathrm)\s*\{[^}]*\}/g, '');
                    if (/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(p1NoCmds) || /\*\*/.test(p1NoCmds)) {
                        isMixed = true;
                        part1 = p1;
                        part2 = p2;
                    }
                }
            }

            const restoreSpan = document.createElement('span');
            restoreSpan.setAttribute('data-ms-currency-restore', '1');

            if (isMixed) {
                restoreSpan.appendChild(document.createTextNode('$' + part1));
                if (k && part2.trim()) {
                    const mathSpan = document.createElement('span');
                    mathSpan.setAttribute('data-ms-math-seg', '1');
                    renderTexInto(mathSpan, part2.trim(), false, k);
                    restoreSpan.appendChild(mathSpan);
                } else {
                    restoreSpan.appendChild(document.createTextNode('$' + part2));
                }
            } else {
                restoreSpan.appendChild(document.createTextNode('$' + rawTex + '$'));
            }

            katexEl.appendChild(restoreSpan);
            katexEl._msRestoreSpan = restoreSpan;
            katexEl._msUnmathRaw = rawTex;
        });
    }

    // 修复普通段落里崩坏的多行公式 (v6.6 流式防抢跑 + 原位局部精准替换版)
    // 根因定位：
    // 1. 流式抢跑截胡：当列表项 <p> 内含多矩阵公式（如 `$$\mathbf{P} = \begin{pmatrix}...\end{pmatrix}, \mathbf{\Lambda} = \begin{pmatrix}...\end{pmatrix}$$`
    //    或 `$$\begin{aligned}...\end{aligned}$$`）时，流式输出刚吐完第 1 个 `\end{pmatrix}` 但末尾闭合 `$$` 尚未到达期间，
    //    AI Studio 暂将该半成品作为纯文本置于 <p> 内；旧版正则立即匹配出第 1 个子矩阵并用 `setSafeHTML(el, ...)` 覆盖整个 <p>！
    // 2. 整段覆盖吞字与 LView 断联：旧版 `setSafeHTML(el, renderedHtml)` 用单个 `match[1]` 覆写了整个 `<p>` 的 innerHTML，
    //    不仅吞噬了段落开头的中文说明与公式前缀（如 `计算 (S_2)^n = ...：`、`s_m = `），还销毁了 Angular Ivy 在 `<p>` 内的 `<ms-cmark-node>` 节点引用，
    //    并打上 `dataset.mathFixed = 'true'` 死锁，导致后续流式到达的公式与文字彻底丢失（必须刷新页面才能重绘）。
    // 方案：
    // 1. 严密流式完整性门禁：检查未渲染文本中的 `$$`、单 `$`、以及 `\begin{...}` / `\end{...}` 嵌套栈是否 100% 闭合配对；存在任何未闭合流式半成品时立即让行。
    // 2. 原位非破坏性局部替换：绝不覆写 `<p>.innerHTML`！构建 DOM-文本偏移映射表，优先捕获完整 `$$...$$` / `$...$` 公式区间（保留 `s_m = ` 等前缀与多矩阵组合），
    //    仅将崩坏公式区间对应的文本节点原位置空、内部 `<br>` 隐藏，并在原位旁插入 KaTeX 渲染片段；段落前后的中文说明、行内公式与 Angular LView 节点引用 100% 完好保留，且支持流式增量还原更新。
    function fixBrokenParagraphs() {
        const k = getKaTeX();
        if (!k) return;
        const elements = document.querySelectorAll(
            'ms-cmark-node p, ms-cmark-node li, ms-cmark-node blockquote, ' +
            '.markdown-content p, .markdown-content li, .markdown-content blockquote'
        );
        const supportedEnvs = new Set([
            'aligned', 'align', 'align*', 'gather', 'gather*',
            'array', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix',
            'cases', 'split', 'multline', 'multline*'
        ]);
        const skipTags = new Set(['code', 'pre', 'script', 'style', 'svg', 'math', 'annotation']);

        function collectMathSnapshot(container) {
            const textNodes = [];
            const katexNodes = [];

            function scan(node) {
                for (let child = node.firstChild; child; child = child.nextSibling) {
                    if (child.nodeType === 3) {
                        textNodes.push(child);
                    } else if (child.nodeType === 1) {
                        if (
                            child.hasAttribute('data-ms-math-seg') ||
                            child.hasAttribute('data-ms-math-text') ||
                            child.hasAttribute('data-ms-bold-seg') ||
                            child.hasAttribute('data-ms-sub-tilde')
                        ) {
                            continue;
                        }
                        const tag = child.tagName.toLowerCase();
                        if (tag === 'ms-katex' && child.hasAttribute('data-ms-unmath')) {
                            scan(child);
                            continue;
                        }
                        if (tag === 'ms-katex' || (child.classList && child.classList.contains('katex'))) {
                            katexNodes.push(child);
                            continue;
                        }
                        if (skipTags.has(tag)) continue;
                        scan(child);
                    }
                }
            }
            scan(container);
            return { textNodes, katexNodes };
        }

        function hasMathContainerChanged(container, state) {
            if (!state) return true;
            const snap = collectMathSnapshot(container);
            if (snap.textNodes.length !== state.textEntries.length || snap.katexNodes.length !== state.katexNodes.length) {
                return true;
            }
            for (let i = 0; i < snap.katexNodes.length; i++) {
                if (snap.katexNodes[i] !== state.katexNodes[i]) return true;
            }
            for (let i = 0; i < snap.textNodes.length; i++) {
                const entry = state.textEntries[i];
                const node = snap.textNodes[i];
                if (node !== entry.node) return true;

                let effectiveVal = node.nodeValue;
                if (!node._msMathManaged && container._msBoldState && container._msBoldState.textEntries) {
                    const bEntries = container._msBoldState.textEntries;
                    for (let j = 0; j < bEntries.length; j++) {
                        if (bEntries[j].node === node && node.nodeValue === bEntries[j].fixedVal) {
                            effectiveVal = bEntries[j].rawVal;
                            break;
                        }
                    }
                }
                if (effectiveVal !== entry.fixedVal) return true;
            }
            return false;
        }

        function restoreMathContainer(container, state) {
            const segs = container.querySelectorAll('[data-ms-math-seg="1"], [data-ms-math-text="1"]');
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                if (seg.parentNode) seg.parentNode.removeChild(seg);
            }
            if (state && state.textEntries) {
                for (let i = 0; i < state.textEntries.length; i++) {
                    const entry = state.textEntries[i];
                    entry.node._msMathManaged = false;
                    if (entry.node.nodeValue === entry.fixedVal) {
                        entry.node.nodeValue = entry.rawVal;
                    }
                }
            }
            if (state && state.hiddenNodes) {
                for (let i = 0; i < state.hiddenNodes.length; i++) {
                    const h = state.hiddenNodes[i];
                    h.node.style.display = h.prevDisplay;
                    h.node.removeAttribute('data-ms-math-hidden');
                }
            }
            container._msMathState = null;
        }

        function getEffectiveRawText(container) {
            const snap = collectMathSnapshot(container);
            const boldMap = new Map();
            const bEntries = container._msBoldState && container._msBoldState.textEntries;
            if (bEntries) {
                for (let i = 0; i < bEntries.length; i++) {
                    boldMap.set(bEntries[i].node, bEntries[i]);
                }
            }
            let s = '';
            for (let i = 0; i < snap.textNodes.length; i++) {
                const node = snap.textNodes[i];
                let v = node.nodeValue || '';
                const be = boldMap.get(node);
                if (be && !node._msMathManaged && v === be.fixedVal) {
                    v = be.rawVal;
                }
                s += v;
            }
            return s + '\u0000' + snap.katexNodes.length;
        }

        elements.forEach((el) => {
            // 若当前容器自身不是 p，但内部包含子级 p/li/blockquote 块元素，则让子级叶子容器独立处理，避免父容器重复处理与范围错位
            if (el.tagName.toLowerCase() !== 'p' && el.querySelector('p, li, blockquote')) {
                return;
            }

            if (el._msMathState) {
                if (!hasMathContainerChanged(el, el._msMathState)) {
                    return;
                }
                if (typeof el._msBoldRestore === 'function' && el._msBoldState) {
                    el._msBoldRestore();
                }
                restoreMathContainer(el, el._msMathState);
            }

            const rawSig = getEffectiveRawText(el);
            if (!rawSig.includes('\\begin{')) {
                el._msMathRejectSig = rawSig;
                return;
            }
            // 内容未变且上一轮已被最终判定不含可修复公式 → 直接跳过，绝不再还原加粗（打断死循环振荡）
            if (el._msMathRejectSig === rawSig) return;

            // 若当前段落挂载了加粗状态，先无损还原，待公式原位修复后由同轮观察器紧接着重跑加粗配对
            if (typeof el._msBoldRestore === 'function' && el._msBoldState) {
                el._msBoldRestore();
            }

            // 第一阶段：遍历段落 DOM 构建虚拟字符流与节点偏移映射
            const tokens = [];
            const katexNodes = [];
            const wrapperRanges = [];
            let virtualStr = '';

            function buildStream(node) {
                for (let child = node.firstChild; child; child = child.nextSibling) {
                    if (child.nodeType === 3) {
                        const text = child.nodeValue || '';
                        const start = virtualStr.length;
                        virtualStr += text;
                        tokens.push({ type: 'text', node: child, text, start, end: virtualStr.length });
                    } else if (child.nodeType === 1) {
                        if (
                            child.hasAttribute('data-ms-math-seg') ||
                            child.hasAttribute('data-ms-math-text') ||
                            child.hasAttribute('data-ms-bold-seg') ||
                            child.hasAttribute('data-ms-sub-tilde')
                        ) {
                            continue;
                        }
                        const tag = child.tagName.toLowerCase();
                        if (tag === 'ms-katex' && child.hasAttribute('data-ms-unmath')) {
                            buildStream(child);
                            continue;
                        }
                        if (tag === 'ms-katex' || (child.classList && child.classList.contains('katex'))) {
                            katexNodes.push(child);
                            const ann = child.querySelector('annotation[encoding="application/x-tex"]');
                            const rawTex = ann ? ann.textContent.trim() : '';
                            if (!rawTex) {
                                // 空 <ms-katex> 通常由流式未闭合或跨行的 `$$` 被误解析为空行内公式 `$ $` 产生，还原为虚拟 `$$`
                                const start = virtualStr.length;
                                virtualStr += '$$';
                                tokens.push({ type: 'empty-katex-dd', node: child, text: '$$', start, end: virtualStr.length });
                                wrapperRanges.push({ node: child, start, end: virtualStr.length });
                                continue;
                            }
                            const start = virtualStr.length;
                            virtualStr += '\uFFFC';
                            tokens.push({ type: 'katex', node: child, text: '\uFFFC', rawTex, start, end: virtualStr.length });
                            continue;
                        }
                        if (skipTags.has(tag)) {
                            const start = virtualStr.length;
                            virtualStr += '\uFFFC';
                            tokens.push({ type: 'opaque', node: child, text: '\uFFFC', start, end: virtualStr.length });
                            continue;
                        }
                        if (tag === 'br') {
                            const start = virtualStr.length;
                            virtualStr += '\n';
                            tokens.push({ type: 'br', node: child, text: '\n', start, end: virtualStr.length });
                            continue;
                        }

                        const isItalic =
                            tag === 'em' ||
                            tag === 'i' ||
                            (tag === 'span' && child.style && child.style.fontStyle === 'italic');
                        const isSub = tag === 'sub' && !child.hasAttribute('data-ms-unsub');

                        if (isItalic || isSub) {
                            const delim = isSub ? '~' : (virtualStr.endsWith('^') ? '*' : '_');
                            const wrapStart = virtualStr.length;
                            virtualStr += delim;
                            tokens.push({ type: 'wrapper-open', node: child, text: delim, start: wrapStart, end: virtualStr.length });
                            buildStream(child);
                            const closeStart = virtualStr.length;
                            virtualStr += delim;
                            tokens.push({ type: 'wrapper-close', node: child, text: delim, start: closeStart, end: virtualStr.length });
                            wrapperRanges.push({ node: child, start: wrapStart, end: virtualStr.length });
                        } else {
                            const elemStart = virtualStr.length;
                            buildStream(child);
                            if (virtualStr.length > elemStart && tag !== 'ms-cmark-node') {
                                wrapperRanges.push({ node: child, start: elemStart, end: virtualStr.length });
                            }
                        }
                    }
                }
            }

            buildStream(el);

            if (!virtualStr.includes('\\begin{')) {
                el._msMathRejectSig = rawSig;
                return;
            }

            // 第二阶段：流式输出完整性与防抢跑门禁（防止流式半截公式被提前截胡）
            // 1) 校验所有 \begin{...} 与 \end{...} 环境栈必须 100% 平衡闭合
            const envTokenRe = /\\(begin|end)\{([a-zA-Z*]+)\}/g;
            const envStack = [];
            const topLevelEnvs = [];
            let envTok;
            while ((envTok = envTokenRe.exec(virtualStr)) !== null) {
                const kind = envTok[1];
                const name = envTok[2];
                if (kind === 'begin') {
                    envStack.push({ name, start: envTok.index });
                } else {
                    if (envStack.length === 0 || envStack[envStack.length - 1].name !== name) {
                        el._msMathRejectSig = null; // 流式未闭合，允许后续重试
                        return; // 环境未闭合或嵌套不匹配
                    }
                    const opened = envStack.pop();
                    if (envStack.length === 0 && supportedEnvs.has(name)) {
                        topLevelEnvs.push({
                            name,
                            matchStart: opened.start,
                            matchEnd: envTok.index + envTok[0].length
                        });
                    }
                }
            }
            if (envStack.length !== 0 || topLevelEnvs.length === 0) {
                el._msMathRejectSig = null; // 环境栈未闭合（流式进行中），允许后续重试
                return;
            }

            // 计算活跃流式状态：仅当当前容器是整个页面中最后一个含未渲染 \begin{ 的块，且文本在过去 550ms 内发生变动时，判定为流式进行中
            const now = Date.now();
            if (el._msLastRawVirtual !== virtualStr) {
                el._msLastRawVirtual = virtualStr;
                el._msLastChangeTs = now;
            }
            const isLastCandidateParagraph = el === elements[elements.length - 1];
            const isActivelyStreaming = isLastCandidateParagraph && now - (el._msLastChangeTs || 0) < 550;

            // 2) 若处于活跃流式状态，且未渲染文本中存在奇数个 `$$`（且未被已闭合环境包容），说明块级公式仍在流式输出中，等待闭合
            const ddMatches = virtualStr.match(/\$\$/g);
            const ddCount = ddMatches ? ddMatches.length : 0;
            if (isActivelyStreaming && ddCount % 2 !== 0) {
                let hasUnclosedDDOutside = false;
                let ddm;
                const ddRe = /\$\$/g;
                while ((ddm = ddRe.exec(virtualStr)) !== null) {
                    const pos = ddm.index;
                    const insideEnv = topLevelEnvs.some((e) => pos >= e.matchStart && pos <= e.matchEnd);
                    if (!insideEnv) {
                        hasUnclosedDDOutside = true;
                        break;
                    }
                }
                if (hasUnclosedDDOutside) {
                    el._msMathRejectSig = null;
                    return;
                }
            }

            // 3) 若处于活跃流式状态，且去除 `$$` 后存在奇数个未转义单 `$`，说明行内公式仍在流式输出中
            const withoutDD = virtualStr.replace(/\$\$/g, '  ');
            const sdMatches = withoutDD.match(/(?<!\\)\$/g);
            const sdCount = sdMatches ? sdMatches.length : 0;
            if (isActivelyStreaming && sdCount % 2 !== 0) {
                let hasUnclosedSDOutside = false;
                let sdm;
                const sdRe = /(?<!\\)\$/g;
                while ((sdm = sdRe.exec(withoutDD)) !== null) {
                    const pos = sdm.index;
                    const insideEnv = topLevelEnvs.some((e) => pos >= e.matchStart && pos <= e.matchEnd);
                    if (!insideEnv) {
                        hasUnclosedSDOutside = true;
                        break;
                    }
                }
                if (hasUnclosedSDOutside) {
                    el._msMathRejectSig = null;
                    return;
                }
            }

            // 4) 若处于活跃流式状态，且段落末尾出现半截未输完的 LaTeX 指令或悬空二元运算符（如 `+`, `-`, `*`, `/`, `=`），等待流式后续内容
            if (isActivelyStreaming) {
                const trimmedTail = virtualStr.trim();
                if (/\\(b|be|beg|begi|begin|e|en|end)(\{[a-zA-Z*]*)?$/.test(trimmedTail)) {
                    el._msMathRejectSig = null;
                    return;
                }
                const lastEnvEnd = topLevelEnvs[topLevelEnvs.length - 1].matchEnd;
                const afterLastEnv = virtualStr.slice(lastEnvEnd);
                const sameLineAfterLastEnv = (afterLastEnv.split('\n')[0] || '').replace(/\$\$/g, '').trim();
                if (
                    sameLineAfterLastEnv.length > 0 &&
                    !/[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(sameLineAfterLastEnv) &&
                    (/[=+\-*/]$/.test(sameLineAfterLastEnv) ||
                        /\\(quad|qquad|cdot|times|frac|mathbf|mathrm|mathit|left|implies|iff|to)\s*\{?[^}]*$/.test(sameLineAfterLastEnv))
                ) {
                    el._msMathRejectSig = null;
                    return;
                }
            }

            // 5) 活跃流式尾部稳定期门禁：若当前容器处于活跃流式输出中，等待 550ms 稳定期
            if (isActivelyStreaming) {
                el._msMathRejectSig = null; // 允许稳定期到期后重新尝试
                if (!el._msStabilizeTimer) {
                    el._msStabilizeTimer = setTimeout(() => {
                        el._msStabilizeTimer = null;
                        runAllFixes();
                    }, 560);
                }
                return;
            }

            // 第三阶段：定位所有崩坏公式区间（优先捕获外层 $$...$$ 或 $...$，以完整保留 `s_m = `、`\mathbf{P} = ` 及同块多矩阵）
            const matchedRanges = [];

            function isOverlapping(start, end) {
                for (let i = 0; i < matchedRanges.length; i++) {
                    if (start < matchedRanges[i].matchEnd && end > matchedRanges[i].matchStart) {
                        return true;
                    }
                }
                return false;
            }

            function containsSupportedEnv(start, end) {
                for (let i = 0; i < topLevelEnvs.length; i++) {
                    if (topLevelEnvs[i].matchStart >= start && topLevelEnvs[i].matchEnd <= end) {
                        return true;
                    }
                }
                return false;
            }

            // 优先级 1: `$$ ... $$` 块级公式区间
            const blockMathRe = /\$\$([\s\S]*?)\$\$/g;
            let bm;
            while ((bm = blockMathRe.exec(virtualStr)) !== null) {
                const mStart = bm.index;
                const mEnd = bm.index + bm[0].length;
                if (containsSupportedEnv(mStart, mEnd)) {
                    matchedRanges.push({
                        matchStart: mStart,
                        matchEnd: mEnd,
                        innerStart: mStart + 2,
                        innerEnd: mEnd - 2,
                        displayMode: true
                    });
                }
            }

            // 优先级 2: `$ ... $` 行内公式区间（排除已匹配的 `$$...$$`）
            const inlineMathRe = /(?<!\\|\$)\$(?!\$)([\s\S]*?)(?<!\\|\$)\$(?!\$)/g;
            let im;
            while ((im = inlineMathRe.exec(virtualStr)) !== null) {
                const mStart = im.index;
                const mEnd = im.index + im[0].length;
                if (!isOverlapping(mStart, mEnd) && containsSupportedEnv(mStart, mEnd)) {
                    matchedRanges.push({
                        matchStart: mStart,
                        matchEnd: mEnd,
                        innerStart: mStart + 1,
                        innerEnd: mEnd - 1,
                        displayMode: im[1].includes('\n')
                    });
                }
            }

            // 优先级 3: 未包裹 `$` / `$$` 的裸 `\begin{env}...\end{env}`（自动扩展吸收同行非中文的等式前缀如 `s_m = ` 及同行多矩阵）
            const cjkOrObjRe = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef\uFFFC]/;
            for (let i = 0; i < topLevelEnvs.length; i++) {
                const env = topLevelEnvs[i];
                if (!isOverlapping(env.matchStart, env.matchEnd)) {
                    let mStart = env.matchStart;
                    let mEnd = env.matchEnd;

                    const lineStart = virtualStr.lastIndexOf('\n', mStart - 1) + 1;
                    const prefixOnLine = virtualStr.slice(lineStart, mStart);
                    if (prefixOnLine.trim().length > 0 && !cjkOrObjRe.test(prefixOnLine)) {
                        mStart = lineStart;
                    }

                    // 若同一纯数学行后方紧跟同行的其他裸矩阵（如 `P = \begin{pmatrix}...\end{pmatrix}, \Lambda = \begin{pmatrix}...\end{pmatrix}`），一并合并
                    while (i + 1 < topLevelEnvs.length) {
                        const nextEnv = topLevelEnvs[i + 1];
                        const between = virtualStr.slice(mEnd, nextEnv.matchStart);
                        if (!between.includes('\n') && !cjkOrObjRe.test(between) && !isOverlapping(nextEnv.matchStart, nextEnv.matchEnd)) {
                            mEnd = nextEnv.matchEnd;
                            i++;
                        } else {
                            break;
                        }
                    }

                    const nextNl = virtualStr.indexOf('\n', mEnd);
                    const lineEnd = nextNl === -1 ? virtualStr.length : nextNl;
                    const suffixOnLine = virtualStr.slice(mEnd, lineEnd);
                    if (suffixOnLine.trim().length > 0 && !cjkOrObjRe.test(suffixOnLine)) {
                        mEnd = lineEnd;
                    }

                    const innerStr = virtualStr.slice(mStart, mEnd).replace(/^\$+|\$+$/g, '');
                    const leadDollars = (virtualStr.slice(mStart, mEnd).match(/^\$+/) || [''])[0].length;
                    const trailDollars = (virtualStr.slice(mStart, mEnd).match(/\$+$/) || [''])[0].length;

                    matchedRanges.push({
                        matchStart: mStart,
                        matchEnd: mEnd,
                        innerStart: mStart + leadDollars,
                        innerEnd: mEnd - trailDollars,
                        displayMode: true
                    });
                }
            }

            if (matchedRanges.length === 0) {
                el._msMathRejectSig = rawSig;
                return;
            }
            matchedRanges.sort((a, b) => a.matchStart - b.matchStart);

            // 为每个崩坏公式区间提取纯净 TeX 并调用 KaTeX 渲染
            const validRanges = [];
            for (let i = 0; i < matchedRanges.length; i++) {
                const r = matchedRanges[i];
                let tex = '';
                for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
                    const tk = tokens[tIdx];
                    if (tk.end <= r.innerStart || tk.start >= r.innerEnd) continue;
                    if (tk.type === 'katex') {
                        tex += tk.rawTex || '';
                    } else if (tk.type === 'text') {
                        const s = Math.max(0, r.innerStart - tk.start);
                        const e = Math.min(tk.text.length, r.innerEnd - tk.start);
                        tex += tk.text.slice(s, e);
                    } else if (tk.type !== 'opaque') {
                        tex += tk.text;
                    }
                }

                tex = restoreCommonMarkEatenLatexEscapes(tex).trim();
                if (!tex) continue;

                try {
                    const mathEl = document.createElement('span');
                    mathEl.setAttribute('data-ms-math-seg', '1');
                    if (r.displayMode) {
                        mathEl.style.display = 'block';
                        mathEl.style.margin = '0.5em 0';
                    }
                    renderTexInto(mathEl, tex, r.displayMode, k);
                    validRanges.push({
                        matchStart: r.matchStart,
                        matchEnd: r.matchEnd,
                        displayMode: r.displayMode,
                        mathEl,
                        inserted: false
                    });
                } catch (e) {}
            }

            if (validRanges.length === 0) {
                el._msMathRejectSig = rawSig;
                return;
            }

            // 第四阶段：原位非破坏性挂载渲染结果（100% 保留上下文文本、行内公式与 Angular LView 节点引用）
            const hiddenNodes = [];
            const hiddenSet = new Set();

            function hideElementInPlace(node) {
                if (hiddenSet.has(node)) return;
                hiddenSet.add(node);
                hiddenNodes.push({ node, prevDisplay: node.style.display || '' });
                node.style.display = 'none';
                node.setAttribute('data-ms-math-hidden', '1');
            }

            // 隐藏完全处于崩坏公式区间内部的 <br> 与内联包装元素（如被误解析的 italic / sub）
            for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
                const tk = tokens[tIdx];
                if (tk.type === 'br') {
                    for (let rIdx = 0; rIdx < validRanges.length; rIdx++) {
                        if (tk.start >= validRanges[rIdx].matchStart && tk.end <= validRanges[rIdx].matchEnd) {
                            hideElementInPlace(tk.node);
                            break;
                        }
                    }
                }
            }
            for (let wIdx = 0; wIdx < wrapperRanges.length; wIdx++) {
                const wr = wrapperRanges[wIdx];
                for (let rIdx = 0; rIdx < validRanges.length; rIdx++) {
                    if (wr.start >= validRanges[rIdx].matchStart && wr.end <= validRanges[rIdx].matchEnd) {
                        hideElementInPlace(wr.node);
                        break;
                    }
                }
            }

            const textEntries = [];
            for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
                const tk = tokens[tIdx];
                if (tk.type !== 'text') continue;

                const overlapping = [];
                for (let rIdx = 0; rIdx < validRanges.length; rIdx++) {
                    const r = validRanges[rIdx];
                    if (tk.end > r.matchStart && tk.start < r.matchEnd) {
                        overlapping.push(r);
                    }
                }

                if (overlapping.length === 0) {
                    textEntries.push({ node: tk.node, rawVal: tk.text, fixedVal: tk.text });
                    continue;
                }

                const frag = document.createDocumentFragment();
                let cursor = tk.start;

                const appendPlainSlice = (str) => {
                    if (!str) return;
                    const span = document.createElement('span');
                    span.textContent = str;
                    span.setAttribute('data-ms-math-text', '1');
                    frag.appendChild(span);
                };

                for (let i = 0; i < overlapping.length; i++) {
                    const r = overlapping[i];
                    if (r.matchStart > cursor) {
                        appendPlainSlice(tk.text.slice(cursor - tk.start, r.matchStart - tk.start));
                    }
                    if (!r.inserted) {
                        frag.appendChild(r.mathEl);
                        r.inserted = true;
                    }
                    cursor = Math.min(tk.end, r.matchEnd);
                }

                if (cursor < tk.end) {
                    appendPlainSlice(tk.text.slice(cursor - tk.start));
                }

                tk.node.nodeValue = '';
                tk.node._msMathManaged = true;

                if (frag.childNodes.length > 0) {
                    // 若当前文本节点位于已被整体隐藏的内联包装节点内部，则将渲染片段提升至最外层隐藏包装节点之前插入
                    let anchor = tk.node;
                    let curParent = anchor.parentNode;
                    while (curParent && curParent !== el) {
                        if (hiddenSet.has(curParent)) {
                            anchor = curParent;
                        }
                        curParent = curParent.parentNode;
                    }
                    if (anchor.parentNode) {
                        if (anchor === tk.node) {
                            anchor.parentNode.insertBefore(frag, anchor.nextSibling);
                        } else {
                            anchor.parentNode.insertBefore(frag, anchor);
                        }
                    }
                }

                textEntries.push({ node: tk.node, rawVal: tk.text, fixedVal: '' });
            }

            el._msMathRejectSig = null; // 修复成功，清除拒绝标记
            el._msMathState = { textEntries, hiddenNodes, katexNodes };
        });
    }

    // 修复表格 <tr> 中被竖线 | 截断的公式与错位列
    function fixBrokenTableRows() {
        const k = getKaTeX();
        if (!k) return;
        const rows = document.querySelectorAll('ms-cmark-node tr, .markdown-content tr, table tr');

        rows.forEach((tr) => {
            if (tr.dataset.tableMathFixed) return;
            // 忽略纯表头
            if (tr.querySelector('th') && !tr.querySelector('td')) return;

            const cells = Array.from(tr.querySelectorAll('td'));
            if (cells.length < 2) return;

            const hasBrokenArray = cells.some((td) => {
                const t = td.textContent || '';
                return (t.includes('\\begin{array}') && !t.includes('\\end{array}')) ||
                       (t.includes('\\begin{bmatrix}') && !t.includes('\\end{bmatrix}')) ||
                       (t.includes('\\begin{') && !t.includes('\\end{'));
            });

            if (!hasBrokenArray) return;

            const table = tr.closest('table');
            const headRow = table && table.querySelector('tr');
            const headerCount = headRow ? headRow.querySelectorAll('th, td').length : cells.length;

            const rowTitle = extractCleanTex(cells[0]);
            const rawLine = findRawTableLine(tr, rowTitle, headerCount);

            if (rawLine) {
                const trueCols = splitMarkdownTableRow(rawLine);
                if (trueCols.length === headerCount) {
                    // 补齐不足单元格，绝不删除正常列（彻底杜绝第 3 列被误删蒸发的恶性 Bug）
                    while (cells.length < headerCount) {
                        const newTd = document.createElement('td');
                        tr.appendChild(newTd);
                        cells.push(newTd);
                    }

                    // 精准重填每一个数据列
                    for (let c = 1; c < trueCols.length; c++) {
                        renderCellWithKaTeX(cells[c], trueCols[c], k);
                    }
                    tr.dataset.tableMathFixed = 'true';
                    return;
                }
            }

            // 兜底方案：缝合残缺碎片（仅在已完整找到闭合 \end{array} 时执行并标记完成，防止流式半截锁死）
            let fixedFallback = false;
            for (let i = 0; i < cells.length - 1; i++) {
                const textA = cells[i].textContent || '';
                if (textA.includes('\\begin{array}') && !textA.includes('\\end{array}')) {
                    const mergedParts = [extractCleanTex(cells[i])];
                    let endIdx = -1;

                    for (let j = i + 1; j < cells.length; j++) {
                        const part = extractCleanTex(cells[j]);
                        mergedParts.push(part);
                        if (part.includes('\\end{array}')) {
                            endIdx = j;
                            break;
                        }
                    }

                    if (endIdx !== -1) {
                        let fullTex = mergedParts.join('|').trim().replace(/^\$+|\$+$/g, '');
                        fullTex = restoreCommonMarkEatenLatexEscapes(fullTex);

                        try {
                            renderTexInto(cells[i], fullTex, false, k);
                            for (let j = i + 1; j <= endIdx; j++) {
                                cells[j].textContent = '';
                            }
                            fixedFallback = true;
                        } catch (e) {}
                        break;
                    }
                }
            }
            if (fixedFallback) {
                tr.dataset.tableMathFixed = 'true';
            }
        });
    }

    // ==================== 5.15 修复波浪号(~)区间被误解析为 <sub> 下标 (v6.5 新增) ====================
    // 根因：AI Studio 的 Markdown 解析器 (ms-cmark-node) 启用了单波浪号下标扩展 (~text~ -> <sub>text</sub>)，
    // 在中文排版中（如 `2万~5万日元（约1000~2500人民币）`），两组数值区间之间的汉字和全角符号中间没有 ASCII 空格，
    // 导致第 1 个区间的 `~` 与第 2 个区间的 `~` 被跨区间误配对成一对下标定界符，两个 `~` 被解析器吞掉，中间内容变成 <sub> 缩小下沉。
    // 方案：在保持 Angular LView DOM 节点引用原位不动的前提下，识别误判的 <sub> 并将其样式重置为 normal baseline，
    // 同时在 <sub> 内部首尾补齐丢失的 `~` 节点，用户复制时完整保留波浪号，且与后续的 fixBrokenBoldMarkdown 无缝联动。
    function fixBrokenSubscriptMarkdown() {
        const subElements = document.querySelectorAll('ms-cmark-node sub, .markdown-content sub');
        if (!subElements || subElements.length === 0) return;

        function isBrokenTildeSubscript(subText, prev, next) {
            if (!subText) return false;

            // 1. 包含 CJK 字符或全角/中文标点（如 5万日元（约1000）
            if (/[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef『』「」《》【】（）—…·]/u.test(subText)) {
                return true;
            }

            // 2. 处于数字区间边界
            // 前方以数字或数字单位结尾，且 subText 以数字开头 (如 100~200)
            const prevEndsNum = /[0-9][%°℃万亿千百KkMmGg]?$/u.test(prev);
            const subStartsNum = /^[¥$€£]?\s*[0-9]/u.test(subText);
            if (prevEndsNum && subStartsNum) return true;

            // subText 以数字结尾，且后方以数字开头 (如 ...1000~2500)
            const subEndsNum = /[0-9][%°℃万亿千百KkMmGg]?$/u.test(subText);
            const nextStartsNum = /^[¥$€£]?\s*[0-9]/u.test(next);
            if (subEndsNum && nextStartsNum) return true;

            // 3. 包含非下标标点符号、超长文本、未闭合括号等
            if (subText.length > 12) return true;
            if (/[~～%$¥€£@#&*;:"'<>?!\/\\]/.test(subText)) return true;
            if ((subText.match(/\(/g) || []).length !== (subText.match(/\)/g) || []).length) return true;
            if (subText.includes('**')) return true;

            return false;
        }

        subElements.forEach((sub) => {
            if (sub.hasAttribute('data-ms-unsub')) return;
            if (sub.closest('[data-ms-math-seg], [data-ms-math-text], [data-ms-math-hidden]')) return;

            const subText = sub.textContent || '';
            const blockContainer = sub.closest(
                'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, ms-cmark-node'
            );

            let prevText = '';
            let nextText = '';
            if (blockContainer) {
                let reachedSub = false;
                const walker = document.createTreeWalker(blockContainer, NodeFilter.SHOW_TEXT, null);
                let node;
                while ((node = walker.nextNode())) {
                    if (node.parentElement && node.parentElement.closest('pre')) continue;
                    if (sub.contains(node)) {
                        reachedSub = true;
                        continue;
                    }
                    if (!reachedSub) {
                        prevText += node.nodeValue || '';
                    } else {
                        nextText += node.nodeValue || '';
                        if (nextText.length > 50) break;
                    }
                }
            }

            const cleanPrev = prevText.slice(-50).replace(/\*+$/, '').trimEnd();
            const cleanNext = nextText.slice(0, 50).replace(/^\*+/, '').trimStart();

            if (isBrokenTildeSubscript(subText, cleanPrev, cleanNext)) {
                sub.setAttribute('data-ms-unsub', 'true');
                sub.style.verticalAlign = 'baseline';
                sub.style.fontSize = 'inherit';
                sub.style.lineHeight = 'inherit';

                const openTilde = document.createElement('span');
                openTilde.textContent = '~';
                openTilde.setAttribute('data-ms-sub-tilde', 'open');

                const closeTilde = document.createElement('span');
                closeTilde.textContent = '~';
                closeTilde.setAttribute('data-ms-sub-tilde', 'close');

                sub.insertBefore(openTilde, sub.firstChild);
                sub.appendChild(closeTilde);
            }
        });
    }

    // ==================== 5.2 修复 CJK 标点导致的泄露加粗标记 (**) 与多米诺错位反相 (v6.4 全覆盖状态机版) ====================
    // 根因：CommonMark 6.2 规范将「中文右括号/引号 + 汉字」（如 `（方案五）**筛选`）中的闭合 `**` 误判为左翼开启符（OPEN-only），
    // 当同一段落存在多个此类加粗词时，第 1 个词末尾的 `#2` 会与第 2 个词开头的 `#3` 错误配对为原生 <strong>，
    // 引发全段「多米诺错位反相效应」（原本该加粗的词没加粗，不该加粗的过渡句全被加粗，且首尾 `**` 分散在不同文本节点残留）。
    // 方案：以叶子块级容器为单位，在完全保留 Angular 原始 DOM 节点引用（兼容流式输出增量更新）与行内公式 <ms-katex> 的前提下，
    // 将块内原生 <strong> 的首尾还原为虚拟 `**` 定界符，结合残留裸 `**` 执行全段落线性状态机重配对。
    function fixBrokenBoldMarkdown() {
        const containerSelector =
            'ms-cmark-node p, ms-cmark-node li, ms-cmark-node td, ms-cmark-node th, ' +
            'ms-cmark-node h1, ms-cmark-node h2, ms-cmark-node h3, ms-cmark-node h4, ms-cmark-node h5, ms-cmark-node h6, ' +
            'ms-cmark-node blockquote, .markdown-content p, .markdown-content li, .markdown-content td, .markdown-content th, ' +
            '.markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4, .markdown-content h5, .markdown-content h6, .markdown-content blockquote';
        const subBlockTags = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'table', 'pre', 'hr']);
        const skipInlineTags = new Set(['code', 'pre', 'ms-katex', 'annotation', 'script', 'style', 'svg', 'math']);
        const markerRegex = /(?<![\\*])\*\*(?!\*)/g;

        // 收集块级容器内属于当前层级的原始文本节点与原生 <strong>（忽略我们注入的 data-ms-bold-seg / data-ms-math-seg 片段与子块）
        function collectRawDomSnapshot(container) {
            const textNodes = [];
            const nativeStrongs = [];

            function scan(node) {
                for (let child = node.firstChild; child; child = child.nextSibling) {
                    if (child.nodeType === 3) {
                        if (child._msMathManaged) continue;
                        textNodes.push(child);
                    } else if (child.nodeType === 1) {
                        if (
                            child.hasAttribute('data-ms-bold-seg') ||
                            child.hasAttribute('data-ms-math-seg') ||
                            child.hasAttribute('data-ms-math-hidden')
                        ) {
                            continue;
                        }
                        const tag = child.tagName.toLowerCase();
                        if (subBlockTags.has(tag)) continue;
                        if (tag === 'ms-katex' && child.hasAttribute('data-ms-unmath')) {
                            scan(child);
                            continue;
                        }
                        if (skipInlineTags.has(tag) || (child.classList && child.classList.contains('katex'))) continue;
                        if ((tag === 'strong' || tag === 'b') && !child.hasAttribute('data-fixed-bold')) {
                            nativeStrongs.push(child);
                        }
                        scan(child);
                    }
                }
            }
            scan(container);
            return { textNodes, nativeStrongs };
        }

        // 检查已处理过的容器是否被 Angular 流式输出追加或修改了内容
        function hasContainerChanged(container, state) {
            if (!state) return true;
            const snap = collectRawDomSnapshot(container);
            if (snap.textNodes.length !== state.textEntries.length || snap.nativeStrongs.length !== state.nativeStrongs.length) {
                return true;
            }
            for (let i = 0; i < snap.nativeStrongs.length; i++) {
                if (snap.nativeStrongs[i] !== state.nativeStrongs[i]) return true;
            }
            for (let i = 0; i < snap.textNodes.length; i++) {
                const entry = state.textEntries[i];
                if (snap.textNodes[i] !== entry.node) return true;
                if (entry.node.nodeValue !== entry.fixedVal) return true;
            }
            return false;
        }

        // 将容器无损还原至 Angular 原始状态（同时保留 Angular 在流式输出期间新写入的节点文本）
        function restoreContainer(container, state) {
            const segs = container.querySelectorAll('[data-ms-bold-seg="1"]');
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                if (seg.parentNode) seg.parentNode.removeChild(seg);
            }
            if (state && state.textEntries) {
                for (let i = 0; i < state.textEntries.length; i++) {
                    const entry = state.textEntries[i];
                    // 若 nodeValue 仍为我们上次置空的 fixedVal，说明 Angular 未覆写该节点，还原其原始文本；
                    // 若 nodeValue 不等于 fixedVal，说明 Angular 流式更新了该节点，直接保留 Angular 的最新文本。
                    if (entry.node.nodeValue === entry.fixedVal) {
                        entry.node.nodeValue = entry.rawVal;
                    }
                }
            }
            if (state && state.nativeStrongs) {
                for (let i = 0; i < state.nativeStrongs.length; i++) {
                    const s = state.nativeStrongs[i];
                    s.style.fontWeight = '';
                    s.removeAttribute('data-ms-unbolded');
                }
            }
            container._msBoldState = null;
        }

        const containers = document.querySelectorAll(containerSelector);

        containers.forEach((container) => {
            if (container._msBoldState) {
                if (!hasContainerChanged(container, container._msBoldState)) {
                    return;
                }
                restoreContainer(container, container._msBoldState);
            }

            if (!container.textContent || !container.textContent.includes('**')) return;

            // 第一阶段：按文档流顺序遍历当前块级容器，构建「虚拟 ** 定界符 + 文本切片」事件流
            const events = [];
            const nativeStrongs = [];
            let totalDelimiters = 0;
            let literalMarkerCount = 0;

            function buildEvents(node) {
                for (let child = node.firstChild; child; child = child.nextSibling) {
                    if (child.nodeType === 3) {
                        if (child._msMathManaged) continue;
                        const rawVal = child.nodeValue || '';
                        const parts = [];
                        if (rawVal.includes('**')) {
                            markerRegex.lastIndex = 0;
                            let lastIdx = 0;
                            let match;
                            while ((match = markerRegex.exec(rawVal)) !== null) {
                                const pc = match.index > 0 ? rawVal[match.index - 1] : '';
                                const nc = match.index + 2 < rawVal.length ? rawVal[match.index + 2] : '';
                                // 忽略诸如 x**2 或 2**10 中的算术幂运算符（两侧均为 ASCII 字母数字）
                                if (/[A-Za-z0-9]/.test(pc) && /[A-Za-z0-9]/.test(nc)) {
                                    continue;
                                }
                                if (match.index > lastIdx) {
                                    parts.push({ type: 'text', text: rawVal.slice(lastIdx, match.index) });
                                }
                                totalDelimiters++;
                                literalMarkerCount++;
                                parts.push({ type: 'literal-marker', delimIndex: totalDelimiters });
                                lastIdx = markerRegex.lastIndex;
                            }
                            if (lastIdx < rawVal.length) {
                                parts.push({ type: 'text', text: rawVal.slice(lastIdx) });
                            }
                        } else if (rawVal.length > 0) {
                            parts.push({ type: 'text', text: rawVal });
                        }
                        events.push({ type: 'text-node', node: child, rawVal, parts });
                    } else if (child.nodeType === 1) {
                        if (
                            child.hasAttribute('data-ms-bold-seg') ||
                            child.hasAttribute('data-ms-math-seg') ||
                            child.hasAttribute('data-ms-math-hidden')
                        ) {
                            continue;
                        }
                        const tag = child.tagName.toLowerCase();
                        if (subBlockTags.has(tag)) continue;
                        if (tag === 'ms-katex' && child.hasAttribute('data-ms-unmath')) {
                            buildEvents(child);
                            continue;
                        }
                        if (skipInlineTags.has(tag) || (child.classList && child.classList.contains('katex'))) continue;

                        const isNativeStrong = (tag === 'strong' || tag === 'b') && !child.hasAttribute('data-fixed-bold');
                        if (isNativeStrong) {
                            nativeStrongs.push(child);
                            totalDelimiters++;
                            events.push({ type: 'strong-open', el: child, delimIndex: totalDelimiters });
                            buildEvents(child);
                            totalDelimiters++;
                            events.push({ type: 'strong-close', el: child, delimIndex: totalDelimiters });
                        } else {
                            buildEvents(child);
                        }
                    }
                }
            }

            buildEvents(container);

            // 若当前容器不含任何未转义的裸 `**`，说明 CommonMark 原生解析完全正常，无需介入
            if (literalMarkerCount === 0) return;

            // 仅配对前 2 * floor(totalDelimiters / 2) 个定界符；若流式输出末尾有落单的第奇数个 `**`，保留不配对
            const maxMatched = Math.floor(totalDelimiters / 2) * 2;
            if (maxMatched === 0) return;

            // 检查是否至少有 1 个裸 `**` 参与了有效配对（排除整段仅有末尾 1 个未闭合流式 `**` 的情况）
            let hasMatchedLiteral = false;
            for (let i = 0; i < events.length && !hasMatchedLiteral; i++) {
                const ev = events[i];
                if (ev.type === 'text-node') {
                    for (let j = 0; j < ev.parts.length; j++) {
                        if (ev.parts[j].type === 'literal-marker' && ev.parts[j].delimIndex <= maxMatched) {
                            hasMatchedLiteral = true;
                            break;
                        }
                    }
                }
            }
            if (!hasMatchedLiteral) return;

            // 第二阶段：取消块内原生 <strong> 的默认加粗样式（保持 DOM 节点原位不动以兼容 Angular LView），由线性状态机统一接管加粗渲染
            for (let i = 0; i < nativeStrongs.length; i++) {
                nativeStrongs[i].style.fontWeight = 'normal';
                nativeStrongs[i].setAttribute('data-ms-unbolded', 'true');
            }

            const textEntries = [];
            let inBold = false;
            let justOpenedLiteral = false;

            const appendSeg = (frag, text, bold) => {
                if (!text) return;
                const el = document.createElement(bold ? 'strong' : 'span');
                el.textContent = text;
                el.setAttribute('data-ms-bold-seg', '1');
                if (bold) {
                    el.setAttribute('data-fixed-bold', 'true');
                    el.style.fontWeight = '700';
                }
                frag.appendChild(el);
            };

            for (let i = 0; i < events.length; i++) {
                const ev = events[i];
                if (ev.type === 'strong-open' || ev.type === 'strong-close') {
                    if (ev.delimIndex <= maxMatched) {
                        inBold = !inBold;
                        justOpenedLiteral = false;
                    }
                    continue;
                }

                if (ev.type === 'text-node') {
                    const { node, rawVal, parts } = ev;
                    const hasMarkerInNode = parts.some((p) => p.type === 'literal-marker' && p.delimIndex <= maxMatched);

                    // 若该文本节点不含配对 `**` 且当前处于非加粗状态，则直接保持原样，零 DOM 开销
                    if (!hasMarkerInNode && !inBold) {
                        textEntries.push({ node, rawVal, fixedVal: rawVal });
                        continue;
                    }

                    const frag = document.createDocumentFragment();
                    for (let j = 0; j < parts.length; j++) {
                        const part = parts[j];
                        if (part.type === 'literal-marker') {
                            if (part.delimIndex <= maxMatched) {
                                inBold = !inBold;
                                justOpenedLiteral = inBold;
                            } else {
                                // 末尾落单的未闭合流式 `**`，原样保留显示
                                appendSeg(frag, '**', inBold);
                            }
                        } else if (part.type === 'text' && part.text.length > 0) {
                            let txt = part.text;
                            if (inBold) {
                                // 检查紧邻开启/闭合裸 `**` 内侧是否有冗余空格（如 `** 文本 **`）
                                const nextPart = j + 1 < parts.length ? parts[j + 1] : null;
                                const willCloseLiteralNext =
                                    nextPart && nextPart.type === 'literal-marker' && nextPart.delimIndex <= maxMatched;

                                let leadSpace = '';
                                let trailSpace = '';
                                if (justOpenedLiteral) {
                                    const mLead = txt.match(/^\s+/);
                                    if (mLead) {
                                        leadSpace = mLead[0];
                                        txt = txt.slice(leadSpace.length);
                                    }
                                }
                                if (willCloseLiteralNext && txt.length > 0) {
                                    const mTrail = txt.match(/\s+$/);
                                    if (mTrail) {
                                        trailSpace = mTrail[0];
                                        txt = txt.slice(0, txt.length - trailSpace.length);
                                    }
                                }

                                if (leadSpace) appendSeg(frag, leadSpace, false);
                                if (txt.length > 0) appendSeg(frag, txt, true);
                                if (trailSpace) appendSeg(frag, trailSpace, false);
                            } else {
                                appendSeg(frag, txt, false);
                            }
                            justOpenedLiteral = false;
                        }
                    }

                    // 保留原始 TextNode 在父节点中的位置并将其置空，在其后方插入渲染片段，确保 Angular LView 引用不丢失
                    node.nodeValue = '';
                    if (node.parentNode) {
                        node.parentNode.insertBefore(frag, node.nextSibling);
                    }
                    textEntries.push({ node, rawVal, fixedVal: '' });
                }
            }

            container._msBoldState = { textEntries, nativeStrongs };
            container._msBoldRestore = () => restoreContainer(container, container._msBoldState);
        });
    }

    // ==================== 5.3 同步超宽公式轮次的虚拟滚动占位框宽度 (v6.3 新增) ====================
    // 原理：完全保留 AI Studio 原生 ms-autoscroll-container 的纵/横滚动机制（不触碰任何 overflow 属性）；
    // 当某轮对话内含有超长公式时，将外层 ms-chat-turn、.chat-turn-container、.virtual-scroll-container 及虚拟滚动占位 div
    // 的水平几何包围盒扩展至公式真实宽度（同时锁定 .turn-content 为一屏宽度以保持普通正文正常换行），
    // 使横向拉到最右边时外层容器依然与视口相交，彻底杜绝虚拟滚动误判离屏卸载导致的 scrollWidth 坍塌弹回！
    function syncWideTurnWidths() {
        const asc = document.querySelector('ms-autoscroll-container');
        if (!asc) return;
        const viewportW = asc.clientWidth || window.innerWidth || 0;
        if (viewportW <= 0) return;

        const turns = document.querySelectorAll('ms-chat-turn');
        turns.forEach((turn) => {
            const ctc = turn.querySelector('.chat-turn-container');
            const vsc = turn.querySelector('.virtual-scroll-container');
            const tc = turn.querySelector('.turn-content');
            if (!ctc || !vsc || !tc) return;

            let maxW = tc.scrollWidth || 0;
            const wideEls = tc.querySelectorAll('.katex, .katex-display, ms-katex, table, pre');
            for (let i = 0; i < wideEls.length; i++) {
                const w = wideEls[i].scrollWidth || wideEls[i].offsetWidth || 0;
                if (w > maxW) maxW = w;
            }

            if (maxW > viewportW + 8) {
                const targetW = (maxW + 32) + 'px';
                if (turn.dataset.syncedWideWidth === targetW) return;
                turn.dataset.syncedWideWidth = targetW;

                // 锁定正文与右上角操作栏宽度为一屏宽度，确保普通文字自动换行与原版 100% 一致
                tc.style.maxWidth = 'calc(100cqw - 24px)';
                const actions = ctc.querySelector('.actions-container');
                if (actions) actions.style.maxWidth = 'calc(100cqw - 24px)';

                // 同步扩展虚拟滚动占位 div 与外层轮次容器的几何包围盒宽度
                const children = vsc.children;
                for (let i = 0; i < children.length; i++) {
                    if (!children[i].classList.contains('turn-content')) {
                        children[i].style.minWidth = targetW;
                    }
                }
                vsc.style.minWidth = targetW;
                ctc.style.maxWidth = 'none';
                ctc.style.minWidth = targetW;
                turn.style.minWidth = targetW;
            } else if (turn.dataset.syncedWideWidth) {
                // 当窗口调整或内容更新后不再超宽时，还原为原版样式
                delete turn.dataset.syncedWideWidth;
                tc.style.maxWidth = '';
                const actions = ctc.querySelector('.actions-container');
                if (actions) actions.style.maxWidth = '';
                const children = vsc.children;
                for (let i = 0; i < children.length; i++) {
                    if (!children[i].classList.contains('turn-content')) {
                        children[i].style.minWidth = '';
                    }
                }
                vsc.style.minWidth = '';
                ctc.style.maxWidth = '';
                ctc.style.minWidth = '';
                turn.style.minWidth = '';
            }
        });
    }

    // ==================== 6. 统一执行与 DOM 监听调度 ====================

    function runAllFixes() {
        fixBrokenCurrencyMath();
        fixBrokenParagraphs();
        fixBrokenTableRows();
        fixBrokenSubscriptMarkdown();
        fixBrokenBoldMarkdown();
        syncWideTurnWidths();
    }

    let timer = null;
    let firstPendingTs = 0;
    const observer = new (win.MutationObserver || MutationObserver)(() => {
        const now = Date.now();
        if (!firstPendingTs) firstPendingTs = now;
        clearTimeout(timer);
        // 250ms 防抖，若持续处于高频流式输出中，最多等待 800ms 强制执行一次
        const delay = (now - firstPendingTs >= 800) ? 0 : 250;
        timer = setTimeout(() => {
            timer = null;
            firstPendingTs = 0;
            runAllFixes();
        }, delay);
    });

    function startObserver() {
        const target = document.body || document.documentElement;
        if (!target) {
            window.addEventListener('DOMContentLoaded', startObserver, { once: true });
            return;
        }
        observer.observe(target, { childList: true, subtree: true, characterData: true });
        runAllFixes();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
        startObserver();
    }
})();
