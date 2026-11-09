// ==UserScript==
// @name         Google AI Studio - LaTeX and Markdown Render Fix
// @name:zh-CN   Google AI Studio LaTeX 与 Markdown 修复 (含防撤回/防截断)
// @name:ja      Google AI Studio 数式＆Markdownレンダリング修正 (リトラクション防止)
// @namespace    https://github.com/m1kuk1m/google-aistudio-latex-markdown-fix
// @version      1.5.0
// @description  Fixes AI Studio output retraction and truncation, LaTeX table cutoffs, broken matrix pipes, streaming race conditions, dollar currency math misrenderings, swallowed code blocks, broken tilde strikethroughs, biochemical star-bold splits, CJK punctuation formatting glitches, and cross-block formula splits in Google AI Studio.
// @description:zh-CN 修复与防护 Google AI Studio 上的回答意外截断与敏感词整段撤回、Markdown 表格公式截断、分块矩阵竖线丢失、流式输出覆盖、美元符号误渲染公式、列表代码块缩进吞噬、波浪号区间误变删除线、生化星号加粗误拆、CJK 标点斜体窃取排版及多行 LaTeX 公式被列表/引用语法跨块劈裂问题
// @description:ja Google AI Studioにおける回答の意図しない切断・取り消し（リトラクション）の防止、数式テーブルの途切れ、分割行列の縦線欠落、ストリーミング時の上書き、ドル記号の誤レンダリング、生化学アスタリスク分割、各種装飾の不具合、リスト構文による数式分断を修正します
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

    // ==================== 1. 全域防撤回与防截断保护系统 (Anti-Retraction & Truncation Engine) ====================
    // 背景：AI Studio 在流式生成结束或检测到特定安全/异常码 (finishReason 处于黑名单 wNb/jIb 中) 时，
    // 前端 AOb/lJb 会清空本轮所有 model chunk 并替换为 text: "" 的空块，甚至导致已输出的长文本和思考过程被整段撤回蒸发；
    // 本引擎在双层架构中提供防护：
    //   第 1 层（源头拦截）：拦截 Array.prototype.includes 签名守卫，引导 AOb/lJb 走原生保留分支（零开销保留原生 <ms-thought-chunk> 与正文）；
    //   第 2 层（数据层兜底）：动态特征识别 finishReason 属性（不依赖 Closure Compiler 属性混淆名 v.Dl/v.Mm），在 Map.set/delete 拦截清空并复活内容。

    // AI Studio 官方触发撤回的 finishReason 黑名单 (对应官方源码 wNb/jIb = [0, 3, 4, 5, 7, 8, 9, 11, 14, 15, 17])
    const RETRACT_FINISH_REASONS = new Set([3, 4, 5, 7, 8, 9, 11, 14, 15, 17]);

    // 用户主动操作时间戳（用于区分用户主动点击清空/删除/重试 与 系统的被动抽风撤回）
    let userActiveActionTs = 0;
    const isUserInitiatedAction = () => (Date.now() - userActiveActionTs) < 1500;
    const markUserAction = (e) => {
        try {
            const target = e && e.target;
            if (!target || typeof target.closest !== 'function') return;
            if (target.closest('button, [role="button"], mat-icon, ms-prompt-run-button, .delete-turn-button, [aria-label*="delete" i], [aria-label*="clear" i], [aria-label*="edit" i], [aria-label*="rerun" i]')) {
                userActiveActionTs = Date.now();
            }
        } catch (_) {}
    };
    if (typeof win.addEventListener === 'function') {
        win.addEventListener('click', markUserAction, true);
        win.addEventListener('pointerdown', markUserAction, true);
    }
    if (typeof window !== 'undefined' && window !== win && typeof window.addEventListener === 'function') {
        window.addEventListener('click', markUserAction, true);
        window.addEventListener('pointerdown', markUserAction, true);
    }

    // ---------------- 第 1 层：Array.prototype.includes 源头签名守卫 ----------------
    // 在 AI Studio 打包核心中，11 个元素的错误码数组 [0, 3, 4, 5, 7, 8, 9, 11, 14, 15, 17]（wNb/jIb）
    // 唯一用途就是在 AOb/lJb 中执行 wNb.includes(g.finishReason)。
    // 拦截该调用使其在非用户主动操作时返回 false，AI Studio 会原生走 else 分支，保留所有原生思考面板与正文！
    const hookArrayPrototype = (targetProto) => {
        if (!targetProto || targetProto._msHookedIncludes) return;
        targetProto._msHookedIncludes = true;
        const origIncludes = targetProto.includes;
        targetProto.includes = function (searchElement, fromIndex) {
            const res = origIncludes.apply(this, arguments);
            if (!res) return false;
            if (
                typeof searchElement === 'number' &&
                RETRACT_FINISH_REASONS.has(searchElement) &&
                this.length === 11 &&
                this[0] === 0 &&
                this[1] === 3 &&
                this[2] === 4 &&
                this[10] === 17
            ) {
                if (!isUserInitiatedAction()) {
                    try {
                        console.info(`[AI Studio Fix] 🛡️ (第1层) 成功拦截 AOb/lJb 撤回判断 (finishReason: ${searchElement})，原生保留全部思考与正文块`);
                    } catch (_) {}
                    return false;
                }
            }
            return res;
        };
    };
    hookArrayPrototype(win.Array ? win.Array.prototype : (typeof Array !== 'undefined' ? Array.prototype : null));
    if (typeof window !== 'undefined' && window !== win && window.Array && window.Array.prototype) {
        hookArrayPrototype(window.Array.prototype);
    }
    if (typeof Array !== 'undefined' && Array.prototype) {
        hookArrayPrototype(Array.prototype);
    }

    // 影子快照池：记录所有 model 实体块的最新有效文本及部件快照
    const chunkSnapshotCache = new Map();
    // 救援池：暂存刚刚被 delete 的 model 块（键为 chunkId，值为快照与删除时间）
    const recentlyDeletedModelChunks = new Map();

    function cleanExpiredSnapshots() {
        const now = Date.now();
        for (const [id, rec] of recentlyDeletedModelChunks.entries()) {
            if (now - rec.deletedAt > 8000) {
                recentlyDeletedModelChunks.delete(id);
            }
        }
        if (chunkSnapshotCache.size > 2500) {
            const oldestKey = chunkSnapshotCache.keys().next().value;
            chunkSnapshotCache.delete(oldestKey);
        }
    }

    // 动态提取/设置 chunk 的结束元数据（兼容 Closure Compiler 混淆更新：旧版 v.Dl，新版 v.Mm，以及未来任意混淆名）
    function getChunkFinishMeta(v) {
        if (!v || typeof v !== 'object') return null;
        if (v.Mm && (typeof v.Mm.finishReason !== 'undefined' || Array.isArray(v.Mm.safetyRatings))) return { key: 'Mm', meta: v.Mm };
        if (v.Dl && (typeof v.Dl.finishReason !== 'undefined' || Array.isArray(v.Dl.safetyRatings))) return { key: 'Dl', meta: v.Dl };
        for (const k of Object.keys(v)) {
            const val = v[k];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                if (typeof val.finishReason !== 'undefined' || Array.isArray(val.safetyRatings)) {
                    return { key: k, meta: val };
                }
            }
        }
        return null;
    }

    function setChunkFinishMeta(v, newProps) {
        if (!v || typeof v !== 'object') return;
        const current = getChunkFinishMeta(v);
        const targetKey = current ? current.key : (v.Mm ? 'Mm' : 'Dl');
        v[targetKey] = Object.assign({}, v[targetKey], newProps);
    }

    // 原始 Markdown 缓冲池与 Angular LView 映射存储 (弱引用避免内存泄漏)
    const rawMarkdownLines = new Set();
    const lViewMapRefs = [];
    const seenMaps = new WeakSet();

    // 钩子 E: 拦截 Map 原型方法（同时守护 Angular LView 映射表与防撤回 entities 数据流）
    const hookMapPrototype = (targetMap) => {
        if (!targetMap || !targetMap.prototype) return;
        const origMapSet = targetMap.prototype.set;
        const origMapDelete = targetMap.prototype.delete;

        // 拦截 delete: 当实体块被 AOb/lJb 或 WIb 删除时，迅速打入救援池与当前 Map 实例暂存
        if (typeof origMapDelete === 'function' && !targetMap.prototype._msHookedDelete) {
            targetMap.prototype._msHookedDelete = true;
            targetMap.prototype.delete = function (k) {
                try {
                    if (typeof k === 'string' && k !== 'text-input-chunk-id') {
                        const existing = this.get(k) || chunkSnapshotCache.get(k);
                        if (existing && existing.role === 'model') {
                            const text = typeof existing.text === 'string' ? existing.text : '';
                            const isThought = !!(existing.thought || existing.Ul || existing.ln);
                            if (text.length > 0 || isThought) {
                                const record = {
                                    id: k,
                                    chunk: Object.assign({}, existing, { text, thought: isThought }),
                                    deletedAt: Date.now()
                                };
                                if (!this._msDeletedChunks) this._msDeletedChunks = [];
                                this._msDeletedChunks.push(record);
                                recentlyDeletedModelChunks.set(k, record);
                                cleanExpiredSnapshots();
                            }
                        }
                    }
                } catch (_) {}
                return origMapDelete.apply(this, arguments);
            };
        }

        // 拦截 set: 维护快照、捕获 lJb/AOb 空块替换、捕获 WIb/kOb 覆写清空
        if (typeof origMapSet === 'function' && !targetMap.prototype._msHookedSet) {
            targetMap.prototype._msHookedSet = true;
            targetMap.prototype.set = function (k, v) {
                // 1. 原有的 Angular LView 映射表记录
                if (typeof k === 'number' && Array.isArray(v) && v.length >= 10 && !seenMaps.has(this) && lViewMapRefs.length < 16) {
                    seenMaps.add(this);
                    if (typeof WeakRef !== 'undefined') {
                        lViewMapRefs.push(new WeakRef(this));
                    } else {
                        lViewMapRefs.push({ deref: () => this });
                    }
                }

                // 2. 防撤回核心数据层守卫
                try {
                    if (v && typeof v === 'object' && v.role === 'model' && typeof k === 'string') {
                        const prevSnapshot = chunkSnapshotCache.get(k);

                        // 性能极速通道：new Map(entities) 克隆时引用相等则 O(1) 立即返回
                        if (prevSnapshot && prevSnapshot.lastRef === v) {
                            return origMapSet.call(this, k, v);
                        }

                        const rawText = typeof v.text === 'string' ? v.text : '';
                        const hasSubstantiveText = rawText.length > 0;
                        const isUserInitiated = isUserInitiatedAction();
                        const isThoughtChunk = !!(v.thought || v.Ul || v.ln);

                        // 实时收集 Markdown 表格行与原始完整 LaTeX 环境，消除昂贵的网络层流式克隆与深度反射
                        if (rawText.includes('|')) {
                            collectRawLinesFromString(rawText);
                        }
                        if (rawText.includes('begin{')) {
                            collectRawLatexEnvsFromString(rawText);
                        }

                        if (hasSubstantiveText || isThoughtChunk) {
                            // 正常流式生长：保持最新最长文本快照
                            const oldText = prevSnapshot ? prevSnapshot.text : '';
                            const longest = rawText.length >= oldText.length ? rawText : oldText;
                            chunkSnapshotCache.set(k, {
                                id: k,
                                role: 'model',
                                thought: isThoughtChunk,
                                text: longest,
                                lastRef: v,
                                Di: v.Di ? [...v.Di] : (v.Ej ? [...v.Ej] : void 0),
                                Ej: v.Ej ? [...v.Ej] : void 0,
                                timestamp: v.timestamp || Date.now(),
                                lastSeen: Date.now()
                            });
                        }

                        // 核心防线 A: 拦截 AOb/lJb 撤回空块（AI Studio 因 finishReason 黑名单清空当前轮并插入 text: "" 的空块）
                        const finishMetaObj = getChunkFinishMeta(v);
                        const finishCode = finishMetaObj && finishMetaObj.meta ? finishMetaObj.meta.finishReason : undefined;
                        const isRetractReason = finishCode !== undefined && RETRACT_FINISH_REASONS.has(finishCode);
                        const hasDeleted = (this._msDeletedChunks && this._msDeletedChunks.length > 0) || recentlyDeletedModelChunks.size > 0;

                        if (!isUserInitiated && !hasSubstantiveText && isRetractReason && hasDeleted) {
                            const now = Date.now();
                            const candidateList = (this._msDeletedChunks && this._msDeletedChunks.length > 0)
                                ? this._msDeletedChunks
                                : Array.from(recentlyDeletedModelChunks.values());

                            const thoughtChunks = [];
                            const mainChunks = [];
                            const seenChunkIds = new Set();

                            for (let i = 0; i < candidateList.length; i++) {
                                const rec = candidateList[i];
                                if (now - rec.deletedAt < 8000) {
                                    const ch = rec.chunk;
                                    const cid = rec.id || ch.id;
                                    if (cid && seenChunkIds.has(cid)) continue;
                                    if (cid) seenChunkIds.add(cid);

                                    const chText = typeof ch.text === 'string' ? ch.text : '';
                                    if (ch.thought) {
                                        if (chText.trim().length > 0) thoughtChunks.push(chText);
                                    } else if (chText.trim().length > 0) {
                                        mainChunks.push(chText);
                                    }
                                }
                            }

                            const combinedThought = thoughtChunks.join('\n\n');
                            const combinedMain = mainChunks.join('\n\n');

                            if (combinedMain.trim().length > 0 || combinedThought.trim().length > 0) {
                                const finishMsg = (finishMetaObj && finishMetaObj.meta && finishMetaObj.meta.finishMessage) ? ` (${finishMetaObj.meta.finishMessage})` : '';

                                let injected = '';
                                if (combinedThought.trim().length > 0) {
                                    injected += `> 💭 **[已救回的思考过程]**\n>\n> ${combinedThought.replace(/\r?\n/g, '\n> ')}\n\n`;
                                }
                                if (combinedMain.trim().length > 0) {
                                    injected += combinedMain;
                                } else if (combinedThought.trim().length > 0) {
                                    injected += `> 💭 *[模型在思考阶段被中断撤回，已完整保留思考内容]*`;
                                }

                                injected += `\n\n> 🛡️ **[防撤回保护生效]** 检测到 AI Studio 触发异常撤回（原因代码: \`${finishCode}\`${finishMsg}），已自动拦截并完整保留生成内容。`;

                                v.text = injected;
                                v._msAntiRetractionRescued = true;
                                if (finishMetaObj) {
                                    v._originalDl = Object.assign({}, finishMetaObj.meta);
                                    setChunkFinishMeta(v, { finishReason: 1 });
                                }
                                v.incomplete = false;
                                if ('Ub' in v) v.Ub = 1;
                                if ('lc' in v) v.lc = 1;
                                if ('Ul' in v) v.Ul = false;
                                if ('ln' in v) v.ln = false;

                                try {
                                    console.info(`[AI Studio Fix] 🛡️ (第2层) 成功拦截并复活异常撤回回复 (finishReason: ${finishCode})`);
                                } catch (_) {}

                                this._msDeletedChunks = [];
                                recentlyDeletedModelChunks.clear();
                            }
                        }

                        // 核心防线 B: 拦截 WIb / kOb / hJa 意外原地覆写清空（无用户交互时已有长文本突然被置空）
                        if (!isUserInitiated && !hasSubstantiveText && prevSnapshot && prevSnapshot.text && prevSnapshot.text.length > 20) {
                            v.text = prevSnapshot.text;
                            if (prevSnapshot.Di && (!v.Di || v.Di.length === 0)) {
                                v.Di = [...prevSnapshot.Di];
                            }
                            if (prevSnapshot.Ej && (!v.Ej || v.Ej.length === 0)) {
                                v.Ej = [...prevSnapshot.Ej];
                            }
                            v._msAntiRetractionPreserved = true;
                        }
                    }
                } catch (_) {}

                return origMapSet.apply(this, arguments);
            };
        }
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

    // 原始完整 LaTeX 环境缓存池 (上限 800 条)，用于跨块劈裂公式精准无损还原
    const rawLatexEnvBlocks = new Set();

    const cleanLatexSnippet = (s) => (s || '').replace(/[\s\\]/g, '');

    // 智能收集完整闭合的原始 LaTeX 环境代码块
    function collectRawLatexEnvsFromString(str) {
        if (typeof str !== 'string' || !str.includes('begin{') || !str.includes('end{')) return;
        const envTokenRe = /\\(begin|end)\{([a-zA-Z*]+)\}/g;
        const stack = [];
        let m;
        while ((m = envTokenRe.exec(str)) !== null) {
            const kind = m[1];
            const name = m[2];
            if (kind === 'begin') {
                stack.push({ name, start: m.index });
            } else if (kind === 'end') {
                if (stack.length > 0 && stack[stack.length - 1].name === name) {
                    const open = stack.pop();
                    if (stack.length === 0) {
                        const blockEnd = m.index + m[0].length;
                        const blockStart = open.start;
                        // 向外扩展可能包裹的 $$
                        let fullStart = blockStart;
                        let fullEnd = blockEnd;
                        const before = str.slice(Math.max(0, blockStart - 10), blockStart);
                        const ddBefore = before.lastIndexOf('$$');
                        if (ddBefore !== -1 && before.slice(ddBefore + 2).trim() === '') {
                            fullStart = Math.max(0, blockStart - 10) + ddBefore;
                        }
                        const after = str.slice(blockEnd, Math.min(str.length, blockEnd + 10));
                        const ddAfter = after.indexOf('$$');
                        if (ddAfter !== -1 && after.slice(0, ddAfter).trim() === '') {
                            fullEnd = blockEnd + ddAfter + 2;
                        }
                        const rawBlock = str.slice(fullStart, fullEnd).trim();
                        if (rawBlock.length > 0) {
                            rawLatexEnvBlocks.delete(rawBlock);
                            rawLatexEnvBlocks.add(rawBlock);
                            if (rawLatexEnvBlocks.size > 800) {
                                const oldest = rawLatexEnvBlocks.values().next().value;
                                rawLatexEnvBlocks.delete(oldest);
                            }
                        }
                    }
                }
            }
        }
    }

    // 从原始 LaTeX 缓存池与快照中检索精准匹配的原始多行公式块
    function findRawLatexEnvBlock(envName, headSnippet, tailSnippet) {
        const normHead = headSnippet ? cleanLatexSnippet(headSnippet) : '';
        const normTail = tailSnippet ? cleanLatexSnippet(tailSnippet) : '';

        function checkMatch(blk) {
            if (!blk.includes(`\\begin{${envName}}`) || !blk.includes(`\\end{${envName}}`)) return false;
            const normBlk = cleanLatexSnippet(blk);
            if (normHead && !normBlk.includes(normHead)) return false;
            if (normTail && !normBlk.includes(normTail)) return false;
            return true;
        }

        // 1) 倒序检索 rawLatexEnvBlocks (最新优先)
        const blocks = Array.from(rawLatexEnvBlocks);
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (checkMatch(blocks[i])) {
                return blocks[i];
            }
        }

        // 2) 兜底：从 chunkSnapshotCache 扫描
        for (const snap of chunkSnapshotCache.values()) {
            if (snap && snap.text && snap.text.includes(`\\begin{${envName}}`)) {
                collectRawLatexEnvsFromString(snap.text);
            }
        }
        const updated = Array.from(rawLatexEnvBlocks);
        for (let i = updated.length - 1; i >= 0; i--) {
            if (checkMatch(updated[i])) {
                return updated[i];
            }
        }
        return null;
    }

    // 从原始 JSON 文本中提取所有字符串字面量并解码为真实 Markdown
    const JSON_STR_RE = /"((?:[^"\\]|\\.)*)"/g;
    function collectFromJsonText(text, state) {
        if (!text || typeof text !== 'string' || (!text.includes('|') && !text.includes('begin{'))) return;
        JSON_STR_RE.lastIndex = state ? state.pos || 0 : 0;
        let m;
        while ((m = JSON_STR_RE.exec(text)) !== null) {
            const unescaped = jsonUnescape(m[1]);
            if (unescaped.includes('begin{')) {
                collectRawLatexEnvsFromString(unescaped);
            }
            if (m[1].includes('|')) {
                collectRawLinesFromString(unescaped);
            }
            if (state) state.pos = JSON_STR_RE.lastIndex;
        }
    }

    // ==================== 2. 全域网络与流式拦截器 (解决手机火狐无法捕获数据流的问题) ====================

    // 保存底层原生的 TextDecoder.prototype.decode，供 fetch 内部调用，避免重复触发 Hook C
    const rawDecode = (win.TextDecoder && win.TextDecoder.prototype && win.TextDecoder.prototype.decode)
        ? win.TextDecoder.prototype.decode
        : (typeof TextDecoder !== 'undefined' ? TextDecoder.prototype.decode : null);

    // 钩子 A: 拦截 fetch (已由 Map.prototype.set 直接接管流式实体文本，无需耗费 CPU 进行全流 clone 与重复解码)
    if (typeof win.fetch === 'function') {
        const origFetch = win.fetch;
        win.fetch = function (...args) {
            return origFetch.apply(this, args);
        };
    }

    // 钩子 B: 拦截 JSON.parse (轻量捕获一次性下发的 JSPB 数据，杜绝 25 层全对象树递归)
    if (win.JSON && win.JSON.parse) {
        const origJSONParse = win.JSON.parse;
        win.JSON.parse = function () {
            const res = origJSONParse.apply(this, arguments);
            try {
                const rawArg = arguments[0];
                if (typeof rawArg === 'string' && (rawArg.includes('begin{') || rawArg.includes('|'))) {
                    collectFromJsonText(rawArg, null);
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

        // 1) 从 Markdown 表格缓冲池中倒序匹配（优先最新的完整行）
        const lines = Array.from(rawMarkdownLines);
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line.includes('|')) continue;
            const cols = splitMarkdownTableRow(line);
            if (cols.length === expectedCols && normTableTitle(cols[0]) === want && isCompleteTableLine(line)) {
                return line;
            }
        }

        // 2) 兜底：从内存 chunk 快照缓存中扫描未及时分割的原始文本行（纯内存操作，消除 12 层 Angular LView 反射）
        for (const snap of chunkSnapshotCache.values()) {
            if (snap && snap.text && snap.text.includes(rowTitle) && snap.text.includes('|')) {
                collectRawLinesFromString(snap.text);
            }
        }
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line.includes('|')) continue;
            const cols = splitMarkdownTableRow(line);
            if (cols.length === expectedCols && normTableTitle(cols[0]) === want && isCompleteTableLine(line)) {
                return line;
            }
        }

        return null;
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

    // ==================== 5.04 解构因 CommonMark 0 缩进错位导致的伪代码块 (v1.2.0 新增) ====================
    // 根因：在列表项内嵌套代码块时，若闭合围栏（```）使用 0 缩进（无前导空格），CommonMark 规范将触发列表强制截断，
    // 原嵌套代码块提前隐式闭合，而该 0 缩进的 ``` 在顶层作用域被解释为一个全新的开启围栏。
    // 因后续无配对闭合围栏且未声明语言（默认为 Code），导致后续所有普通正文、标题（### 总结）、加粗及数学公式全部被吞入 <ms-code-block>。
    // 方案：
    // 1. 保留 <ms-code-block> 原始 DOM 节点（维护 Angular Ivy LView 索引映射），重置其外观并隐藏内部头栏与 <pre>；
    // 2. 交叉校验代码块特征（排除 python/json 等声明语言及含实际代码关键字的代码块，匹配含 CJK 句子且具备标题、加粗或公式的伪代码块）；
    // 3. 将吞噬的纯文本按行结构化还原为 <div class="markdown-content ms-unpacked-code"> 内的 <h3>、<ul><li>、<ol><li> 与 <p>；
    // 4. 解构容器挂载 .markdown-content，后续流水线中的 fixBrokenParagraphs (KaTeX) 与 fixBrokenBoldMarkdown 会自动接管渲染。
    function fixBrokenCodeBlocks() {
        const codeBlocks = document.querySelectorAll('ms-code-block');
        if (!codeBlocks || codeBlocks.length === 0) return;

        codeBlocks.forEach((cb) => {
            const pre = cb.querySelector('pre');
            if (!pre) return;

            // 1. 语言标签检测：排除明确指定 python、json、cpp、bash 等正规语言的代码块
            const titleEl = cb.querySelector('.mat-expansion-panel-header mat-panel-title, .mat-panel-title, mat-panel-title');
            let lang = '';
            if (titleEl) {
                const textParts = [];
                function scanLangText(node) {
                    for (let child = node.firstChild; child; child = child.nextSibling) {
                        if (child.nodeType === 3) {
                            textParts.push(child.nodeValue || '');
                        } else if (child.nodeType === 1) {
                            const tag = child.tagName.toLowerCase();
                            if (tag === 'mat-icon' || tag === 'svg' || tag === 'button' || (child.classList && child.classList.contains('material-icons'))) {
                                continue;
                            }
                            scanLangText(child);
                        }
                    }
                }
                scanLangText(titleEl);
                lang = textParts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
            }
            if (lang && !['code', 'text', 'plaintext'].includes(lang)) return;

            const rawText = pre.textContent || '';
            if (cb.hasAttribute('data-ms-code-unpacked')) {
                if (cb._msUnpackRawText === rawText && cb._msUnpackDiv && cb._msUnpackDiv.isConnected) return;
            }

            // 2. 精准伪代码块特征判定（多重交叉校验）
            const hasSubHeading = /(?:^|\n)#{2,6}\s+[^\n]*[\u4e00-\u9fa5]/.test(rawText);
            const hasH1 = /(?:^|\n)#\s+[^\n]*[\u4e00-\u9fa5]/.test(rawText);
            const hasCjkBold = /\*\*[^\n*]*[\u4e00-\u9fa5][^\n*]*\*\*/.test(rawText);
            const hasMath = /(?<!\\)\$[a-zA-Z0-9_{}\\]+\$/.test(rawText) || /\$\$[\s\S]+?\$\$/.test(rawText) || /(?<!\\)\$[^$\n]{1,50}(?<!\\)\$/.test(rawText);
            const hasMarkdownList = /(?:^|\n)\s*[*+-]\s+[^\n]*[\u4e00-\u9fa5]/.test(rawText);
            const hasCjkSentence = /[\u4e00-\u9fa5]{2,}[，。！？：；、]/.test(rawText) || /[\u4e00-\u9fa5][\s\S]{0,30}[。！？]/.test(rawText);

            // 排除包含常见编程代码关键字的真实无语言代码块（单行 # 注释常被误认为 H1 标题）
            const looksLikeRealCode = /(?:^|\n)\s*(?:def|class|import|from\s+\w+\s+import|function|const|let|var|return|public|private)\b/.test(rawText);

            // 当仅具有 H1 或无序列表且出现代码关键字时，优先判定为真实代码块；但若包含 Markdown 次级标题(##~######)、加粗或 LaTeX 公式，则确凿为被吞噬文档
            const hasMarkdownStruct = hasSubHeading || hasCjkBold || hasMath || ((hasH1 || hasMarkdownList) && !looksLikeRealCode);
            const isPseudoCode = hasMarkdownStruct && hasCjkSentence;
            if (!isPseudoCode) {
                // 如果先前曾被误判定为伪代码块，但后续流式输出推翻了该判定（如到达了实际编程关键字），立即完整回滚原始外观与 DOM
                if (cb.hasAttribute('data-ms-code-unpacked')) {
                    cb.removeAttribute('data-ms-code-unpacked');
                    cb._msUnpackRawText = null;
                    const clearProp = (el, p) => {
                        if (!el || !el.style) return;
                        if (typeof el.style.removeProperty === 'function') el.style.removeProperty(p);
                        else el.style[p] = '';
                    };
                    ['background', 'border', 'box-shadow', 'margin', 'padding'].forEach(p => clearProp(cb, p));
                    const header = cb.querySelector('.mat-expansion-panel-header, mat-expansion-panel-header');
                    clearProp(header, 'display');
                    const expContent = cb.querySelector('.mat-expansion-panel-content');
                    clearProp(expContent, 'display');
                    clearProp(pre, 'display');
                    if (cb._msUnpackDiv && cb._msUnpackDiv.parentNode === cb) {
                        cb._msUnpackDiv.remove();
                    }
                    cb._msUnpackDiv = null;
                }
                return;
            }

            // 3. 原位样式重置（保留 ms-code-block 节点，不破坏 Angular LView 映射）
            cb.setAttribute('data-ms-code-unpacked', '1');
            cb.style.setProperty('background', 'transparent', 'important');
            cb.style.setProperty('border', 'none', 'important');
            cb.style.setProperty('box-shadow', 'none', 'important');
            cb.style.setProperty('margin', '0', 'important');
            cb.style.setProperty('padding', '0', 'important');

            const header = cb.querySelector('.mat-expansion-panel-header, mat-expansion-panel-header');
            if (header) header.style.setProperty('display', 'none', 'important');
            const expContent = cb.querySelector('.mat-expansion-panel-content');
            if (expContent) expContent.style.setProperty('display', 'none', 'important');
            pre.style.setProperty('display', 'none', 'important');

            if (cb._msUnpackDiv && cb._msUnpackDiv.parentNode === cb) {
                cb._msUnpackDiv.remove();
            }

            // 4. 创建标准 markdown-content 容器
            const unpackDiv = document.createElement('div');
            unpackDiv.className = 'markdown-content ms-unpacked-code';
            unpackDiv.setAttribute('data-ms-code-unpack', '1');

            // 5. 基础块元素还原（空行分段、标题、列表、引用、内部代码围栏）
            const lines = rawText.split(/\r?\n/);
            let currentBlock = null;
            let inCodeFence = false;
            let codeFenceLang = '';
            let codeFenceLines = [];

            function flushBlock() {
                currentBlock = null;
            }

            lines.forEach((line) => {
                const trimmed = line.trim();

                // 处理内部代码围栏 ```
                if (trimmed.startsWith('```')) {
                    if (!inCodeFence) {
                        flushBlock();
                        inCodeFence = true;
                        codeFenceLang = trimmed.slice(3).trim();
                        codeFenceLines = [];
                        return;
                    } else {
                        inCodeFence = false;
                        const preEl = document.createElement('pre');
                        const codeEl = document.createElement('code');
                        if (codeFenceLang) codeEl.className = 'language-' + codeFenceLang;
                        codeEl.textContent = codeFenceLines.join('\n');
                        preEl.appendChild(codeEl);
                        unpackDiv.appendChild(preEl);
                        return;
                    }
                }

                if (inCodeFence) {
                    codeFenceLines.push(line);
                    return;
                }

                if (!trimmed) {
                    flushBlock();
                    return;
                }

                // 标题: #{1,6}
                const mHeading = trimmed.match(/^(#{1,6})\s+(.*)$/);
                if (mHeading) {
                    flushBlock();
                    const level = mHeading[1].length;
                    const hEl = document.createElement('h' + level);
                    hEl.textContent = mHeading[2].trim();
                    unpackDiv.appendChild(hEl);
                    return;
                }

                // 引用: >
                const mBq = trimmed.match(/^>\s*(.*)$/);
                if (mBq) {
                    if (!currentBlock || currentBlock.type !== 'blockquote') {
                        flushBlock();
                        const bq = document.createElement('blockquote');
                        unpackDiv.appendChild(bq);
                        currentBlock = { type: 'blockquote', el: bq };
                    }
                    const p = document.createElement('p');
                    p.textContent = mBq[1].trim();
                    currentBlock.el.appendChild(p);
                    return;
                }

                // 无序列表: * / - / +
                const mUl = trimmed.match(/^[*+-]\s+(.*)$/);
                if (mUl) {
                    if (!currentBlock || currentBlock.type !== 'ul') {
                        flushBlock();
                        const ul = document.createElement('ul');
                        unpackDiv.appendChild(ul);
                        currentBlock = { type: 'ul', el: ul };
                    }
                    const li = document.createElement('li');
                    li.textContent = mUl[1].trim();
                    currentBlock.el.appendChild(li);
                    return;
                }

                // 有序列表: 1. / 2.
                const mOl = trimmed.match(/^\d+\.\s+(.*)$/);
                if (mOl) {
                    if (!currentBlock || currentBlock.type !== 'ol') {
                        flushBlock();
                        const ol = document.createElement('ol');
                        unpackDiv.appendChild(ol);
                        currentBlock = { type: 'ol', el: ol };
                    }
                    const li = document.createElement('li');
                    li.textContent = mOl[1].trim();
                    currentBlock.el.appendChild(li);
                    return;
                }

                // 列表项缩进续行
                if (currentBlock && (currentBlock.type === 'ul' || currentBlock.type === 'ol') && /^\s{2,}/.test(line)) {
                    const lastLi = currentBlock.el.lastElementChild;
                    if (lastLi) {
                        lastLi.textContent += '\n' + trimmed;
                        return;
                    }
                }

                // 普通段落
                if (!currentBlock || currentBlock.type !== 'p') {
                    flushBlock();
                    const p = document.createElement('p');
                    p.textContent = trimmed;
                    unpackDiv.appendChild(p);
                    currentBlock = { type: 'p', el: p };
                } else {
                    currentBlock.el.textContent += '\n' + trimmed;
                }
            });
            flushBlock();
            if (inCodeFence && codeFenceLines.length > 0) {
                const preEl = document.createElement('pre');
                const codeEl = document.createElement('code');
                if (codeFenceLang) codeEl.className = 'language-' + codeFenceLang;
                codeEl.textContent = codeFenceLines.join('\n');
                preEl.appendChild(codeEl);
                unpackDiv.appendChild(preEl);
            }

            // 6. 对解构出的块级元素，若包含 $...$ 或 $$...$$ 公式，使用 KaTeX 进行原位就绪渲染
            const k = getKaTeX();
            if (k) {
                const mathTargets = unpackDiv.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote');
                mathTargets.forEach((targetEl) => {
                    const rawVal = targetEl.textContent || '';
                    if (!rawVal.includes('$')) return;

                    const mathRe = /\$\$([\s\S]+?)\$\$|(?<!\\|\$)\$(?!\s)([\s\S]+?)(?<!\s|\\)\$(?!\$)/g;
                    let lastIdx = 0;
                    let match;
                    let hasMath = false;
                    const frag = document.createDocumentFragment();

                    while ((match = mathRe.exec(rawVal)) !== null) {
                        const isDisplay = match[1] !== undefined;
                        const inner = isDisplay ? match[1] : match[2];
                        const trimmedInner = inner.trim();

                        // 排除货币误匹配（如 $1.00）
                        if (!isDisplay) {
                            const afterMatch = rawVal.slice(match.index + match[0].length);
                            if (/^[0-9]/.test(afterMatch) || /^[0-9]/.test(trimmedInner)) {
                                continue;
                            }
                        }

                        hasMath = true;
                        if (match.index > lastIdx) {
                            frag.appendChild(document.createTextNode(rawVal.slice(lastIdx, match.index)));
                        }
                        const span = document.createElement('span');
                        span.setAttribute('data-ms-math-seg', '1');
                        renderTexInto(span, trimmedInner, isDisplay, k);
                        frag.appendChild(span);
                        lastIdx = mathRe.lastIndex;
                    }

                    if (hasMath) {
                        if (lastIdx < rawVal.length) {
                            frag.appendChild(document.createTextNode(rawVal.slice(lastIdx)));
                        }
                        targetEl.textContent = '';
                        targetEl.appendChild(frag);
                    }
                });
            }

            cb.appendChild(unpackDiv);
            cb._msUnpackDiv = unpackDiv;
            cb._msUnpackRawText = rawText;
        });
    }

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
            'ms-cmark-node p, ms-cmark-node li, ms-cmark-node blockquote, ms-cmark-node blockquote p, ms-cmark-node .callout, ms-cmark-node .callout p, ' +
            '.markdown-content p, .markdown-content li, .markdown-content blockquote, .markdown-content blockquote p, .markdown-content .callout, .markdown-content .callout p, ' +
            'blockquote, blockquote p, .callout, .callout p'
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
                    delete h.node._msMathAbsorbed;
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
            // 若当前元素已被标记为吸收隐藏（跨块公式后续部分），直接跳过
            if (el.hasAttribute('data-ms-math-hidden') || el._msMathAbsorbed || (el.closest && el.closest('[data-ms-math-hidden]'))) {
                return;
            }

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
                        if (tag === 'hr') {
                            const start = virtualStr.length;
                            virtualStr += '\n\\hline\n';
                            tokens.push({ type: 'text', node: child, text: '\n\\hline\n', start, end: virtualStr.length });
                            continue;
                        }
                        if (tag === 'li' && virtualStr.length > 0 && !virtualStr.endsWith('\n')) {
                            const start = virtualStr.length;
                            virtualStr += '\n';
                            tokens.push({ type: 'text', node: child, text: '\n', start, end: virtualStr.length });
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
                    if (envStack.length > 0 && envStack[envStack.length - 1].name === name) {
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
            }

            const absorbedSiblings = [];
            if (envStack.length > 0) {
                // 跨兄弟块（Cross-Sibling Block）探测：检查是否被 CommonMark 列表/引用误劈裂到后续兄弟元素中
                let nextSib = el.nextSibling;
                let lookaheadCount = 0;
                while (nextSib && lookaheadCount < 10 && envStack.length > 0) {
                    if (nextSib.nodeType === 3) {
                        if (!nextSib.nodeValue.trim()) {
                            nextSib = nextSib.nextSibling;
                            continue;
                        }
                    } else if (nextSib.nodeType === 8) {
                        nextSib = nextSib.nextSibling;
                        continue;
                    } else if (nextSib.nodeType === 1) {
                        lookaheadCount++;
                        const sibTag = nextSib.tagName.toLowerCase();
                        if (['script', 'style'].includes(sibTag)) {
                            nextSib = nextSib.nextSibling;
                            continue;
                        }

                        // 分隔符隔离
                        const sepStart = virtualStr.length;
                        virtualStr += '\n';
                        tokens.push({ type: 'separator', node: null, text: '\n', start: sepStart, end: virtualStr.length });

                        const sibScanStart = virtualStr.length;
                        buildStream(nextSib);
                        absorbedSiblings.push(nextSib);

                        // 扫描新追加的兄弟内容能否闭合 envStack
                        envTokenRe.lastIndex = sibScanStart;
                        while ((envTok = envTokenRe.exec(virtualStr)) !== null) {
                            const kind = envTok[1];
                            const name = envTok[2];
                            if (kind === 'begin') {
                                envStack.push({ name, start: envTok.index });
                            } else if (kind === 'end') {
                                if (envStack.length > 0 && envStack[envStack.length - 1].name === name) {
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
                        }

                        if (envStack.length === 0) {
                            break;
                        }
                    }
                    nextSib = nextSib.nextSibling;
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
                let rawEnvFound = null;

                // 优先从原始 LaTeX 环境缓存检索精准无损源码
                const envName = (topLevelEnvs[0] && topLevelEnvs[0].name) || 'array';
                const headSlice = virtualStr.slice(r.innerStart, Math.min(virtualStr.length, r.innerStart + 60));
                const tailSlice = virtualStr.slice(Math.max(r.innerStart, r.innerEnd - 60), r.innerEnd);
                rawEnvFound = findRawLatexEnvBlock(envName, headSlice, tailSlice);

                if (rawEnvFound) {
                    tex = rawEnvFound.replace(/^\$\$+|\$\$+$/g, '').trim();
                } else {
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

                    // 脱机 DOM 兜底：若由于 CommonMark 列表误判导致行首丢失了 '+ ' 或 '- '，进行智能补偿
                    if (absorbedSiblings.length > 0) {
                        tex = tex.replace(/(\\\s*(?:\r?\n)+)\s*(&\s*&?\s*[-+])/g, '$1+ $2');
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

            // 对跨块公式吸收的所有后续兄弟节点进行原位隐藏并打标记
            for (let sIdx = 0; sIdx < absorbedSiblings.length; sIdx++) {
                const sib = absorbedSiblings[sIdx];
                hideElementInPlace(sib);
                sib._msMathAbsorbed = true;
            }

            const textEntries = [];
            for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
                const tk = tokens[tIdx];
                if (tk.type !== 'text') continue;

                // 若该文本节点属于被吸收的后续兄弟节点，跳过插入（兄弟节点已整块原位隐藏）
                if (absorbedSiblings.length > 0 && !el.contains(tk.node)) {
                    continue;
                }

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

            // 确保跨块公式即使在特殊文本分布下也能挂载入起始容器
            for (let i = 0; i < validRanges.length; i++) {
                const r = validRanges[i];
                if (!r.inserted) {
                    el.appendChild(r.mathEl);
                    r.inserted = true;
                }
            }

            el._msMathRejectSig = null; // 修复成功，清除拒绝标记
            el._msMathState = { textEntries, hiddenNodes, katexNodes, absorbedSiblings };
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

    // ==================== 5.15 修复波浪号(~)区间被误解析为下标(sub)或删除线(del) (v1.2.0 重构) ====================
    // 根因：AI Studio 的 Markdown 解析器启用单波浪号扩展，两组数值区间（如 `5%~16%` 与 `**3~5 次**`）之间的
    // 汉字由于无 ASCII 空格，导致跨区间波浪号被误配对为下标(sub)或删除线(del/s/strike)，导致内容被删除线划掉且首尾波浪号丢失。
    // 在与 ** 加粗交叉嵌套时还会发生标签分裂（Tag Splitting），导致如 3 与 5 粘连并加粗为 35 次。
    // 方案：
    // 1. 扩充选择器纳管 sub, del, s, strike，在保持 Angular LView DOM 节点引用原位不动的前提下抹除下标或删除线样式；
    // 2. 严密数值区间特征防线：对 del/s 标签严格校验两端是否紧贴数值区间边界，杜绝误杀合法中文删除线（如 ~~已作废~~）；
    // 3. 在标签内部首尾插入补齐的 ~ 节点，并智能检测邻近的 <strong> 边界继承粗体字重，使数字与波浪号视觉融合。
    function fixBrokenTildeMarkdown() {
        const tildeElements = document.querySelectorAll(
            'ms-cmark-node sub, ms-cmark-node del, ms-cmark-node s, ms-cmark-node strike, ' +
            '.markdown-content sub, .markdown-content del, .markdown-content s, .markdown-content strike'
        );
        if (!tildeElements || tildeElements.length === 0) return;

        function isBrokenTilde(el, text, prev, next, rawPrev, rawNext) {
            if (!text) return false;
            const tag = el.tagName.toLowerCase();
            const isDel = ['del', 's', 'strike'].includes(tag);

            const prevEndsNum = /(?:[0-9]\s*(?:[%°℃万亿千百KkMmGg¥$€£次个条点分秒元块角米]|ms|s|h|d|min|px|em|rem)?|[¥$€£])$/u.test(prev);
            const subStartsNum = /^[¥$€£]?\s*[0-9]/u.test(text);
            const subEndsNum = /[0-9]\s*(?:[%°℃万亿千百KkMmGg¥$€£次个条点分秒元块角米]|ms|s|h|d|min|px|em|rem)?$/u.test(text);
            const nextStartsNum = /^[¥$€£]?\s*[0-9]/u.test(next);

            // 【关键防线】：对 del/s 标签，必须严格校验双端是否均处于数字区间边界且无多余空格，严禁误杀合法中文删除线（如 ~~已作废~~、~~500元~~200元）
            if (isDel) {
                const hasPrevSpace = /\s$/.test(rawPrev) || /\s\*+$/.test(rawPrev);
                const hasNextSpace = /^\s/.test(rawNext) || /^\*+\s/.test(rawNext);
                const leftValid = prevEndsNum && subStartsNum && !hasPrevSpace;
                const rightValid = subEndsNum && nextStartsNum && !hasNextSpace;
                return leftValid && rightValid;
            }

            // 针对 sub 标签的判定逻辑（保持既有高覆盖率规则）
            if (/[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef『』「」《》【】（）—…·]/u.test(text)) return true;
            if (prevEndsNum && subStartsNum) return true;
            if (subEndsNum && nextStartsNum) return true;
            if (text.length > 12) return true;
            if (/[~～%$¥€£@#&*;:"'<>?!\/\\]/.test(text)) return true;
            if ((text.match(/\(/g) || []).length !== (text.match(/\)/g) || []).length) return true;
            if (text.includes('**')) return true;
            return false;
        }

        tildeElements.forEach((el) => {
            if (el.hasAttribute('data-ms-unsub')) return;
            if (el.closest('[data-ms-math-seg], [data-ms-math-text], [data-ms-math-hidden]')) return;

            const text = el.textContent || '';
            const blockContainer = el.closest(
                'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, ms-cmark-node'
            );

            let prevText = '';
            let nextText = '';
            if (blockContainer) {
                let reached = false;
                const walker = document.createTreeWalker(blockContainer, NodeFilter.SHOW_TEXT, null);
                let node;
                while ((node = walker.nextNode())) {
                    if (node.parentElement && node.parentElement.closest('pre')) continue;
                    if (el.contains(node)) {
                        reached = true;
                        continue;
                    }
                    if (!reached) {
                        prevText += node.nodeValue || '';
                    } else {
                        nextText += node.nodeValue || '';
                        if (nextText.length > 50) break;
                    }
                }
            }

            const cleanPrev = prevText.slice(-50).replace(/\*+$/, '').trimEnd();
            const cleanNext = nextText.slice(0, 50).replace(/^\*+/, '').trimStart();

            if (isBrokenTilde(el, text, cleanPrev, cleanNext, prevText, nextText)) {
                el.setAttribute('data-ms-unsub', 'true');
                const tag = el.tagName.toLowerCase();
                if (tag === 'sub') {
                    el.style.setProperty('vertical-align', 'baseline', 'important');
                    el.style.setProperty('font-size', 'inherit', 'important');
                    el.style.setProperty('line-height', 'inherit', 'important');
                } else {
                    el.style.setProperty('text-decoration', 'none', 'important');
                }

                const openTilde = document.createElement('span');
                openTilde.textContent = '~';
                openTilde.setAttribute('data-ms-sub-tilde', 'open');

                const closeTilde = document.createElement('span');
                closeTilde.textContent = '~';
                closeTilde.setAttribute('data-ms-sub-tilde', 'close');

                function isStrongNode(node) {
                    return !!(node && node.nodeType === 1 && (node.tagName === 'STRONG' || node.tagName === 'B'));
                }

                // 保持粗体字重一致：若首端紧邻 <strong>，设置 bold（跳过空白文本节点，严格避免误判末尾 strong）
                let firstBorderNode = el.firstChild;
                while (firstBorderNode && firstBorderNode.nodeType === 3 && !firstBorderNode.nodeValue.trim()) {
                    firstBorderNode = firstBorderNode.nextSibling;
                }
                let prevBorderNode = el.previousSibling;
                while (prevBorderNode && prevBorderNode.nodeType === 3 && !prevBorderNode.nodeValue.trim()) {
                    prevBorderNode = prevBorderNode.previousSibling;
                }
                if (isStrongNode(firstBorderNode) || isStrongNode(prevBorderNode)) {
                    openTilde.style.fontWeight = 'bold';
                }

                // 保持粗体字重一致：若闭合端紧邻 <strong>，设置 bold（跳过空白文本节点）
                let lastBorderNode = el.lastChild;
                while (lastBorderNode && lastBorderNode.nodeType === 3 && !lastBorderNode.nodeValue.trim()) {
                    lastBorderNode = lastBorderNode.previousSibling;
                }
                let nextBorderNode = el.nextSibling;
                while (nextBorderNode && nextBorderNode.nodeType === 3 && !nextBorderNode.nodeValue.trim()) {
                    nextBorderNode = nextBorderNode.nextSibling;
                }
                if (isStrongNode(lastBorderNode) || isStrongNode(nextBorderNode)) {
                    closeTilde.style.fontWeight = 'bold';
                }

                el.insertBefore(openTilde, el.firstChild);
                el.appendChild(closeTilde);
            }
        });
    }

    // ==================== 5.18 修复生化/蛋白质星号命名误拆 (v1.3.0 新增) ====================
    // 根因：针对如 `一种名为 **A$\beta$*56** 的特定淀粉样蛋白寡聚体。` 的排版，CommonMark 引擎在遇到混排 LaTeX 结尾 `$` 时
    // 绕过了 3 的倍数规则，将结构拆成了前置孤立 `*` 文本 + `<em>A<ms-katex>\beta</ms-katex></em>` + `<em>56</em>`。
    // 方案：高特征守门检测前置裸单星号（严格排除连续星号与反斜杠转义 \*）、紧随两个连续 <em> 元素且第二个 <em> 为纯数字/生化亚型（/^\d+[a-zA-Z]?$/），
    // 原位重构为标准加粗 <strong>，还原中间的字面量星号 `*`，消除前置暴露的单星号及后方可能的单星号残留。
    function fixBrokenBiochemicalStarBold() {
        const emElements = document.querySelectorAll(
            'ms-cmark-node em, .markdown-content em, em'
        );
        if (!emElements || emElements.length === 0) return;

        emElements.forEach((em1) => {
            if (!em1.parentNode) return;
            if (em1.hasAttribute('data-fixed-italic') || (em1.closest && em1.closest('pre, code, [data-fixed-bold], [data-ms-biochem-bold]'))) return;

            let prevNode = em1.previousSibling;
            while (prevNode && ((prevNode.nodeType === 3 && !prevNode.nodeValue) || prevNode.nodeType === 8)) {
                prevNode = prevNode.previousSibling;
            }
            if (prevNode && prevNode.nodeType === 1) {
                for (let c = prevNode.lastChild; c; c = c.previousSibling) {
                    if (c.nodeType === 3 && c.nodeValue) { prevNode = c; break; }
                }
            }
            if (!prevNode || prevNode.nodeType !== 3) return;
            // 校验前置文本必须以孤立单星号结尾（严格排除连续星号与反斜杠转义 \*）
            if (!/(?<!\*)\*$/.test(prevNode.nodeValue)) return;
            if (/(?:^|[^\\])(?:\\\\)*\\\*$/.test(prevNode.nodeValue)) return;

            let em2 = em1.nextSibling;
            while (em2 && ((em2.nodeType === 3 && !em2.nodeValue) || em2.nodeType === 8)) {
                em2 = em2.nextSibling;
            }
            if (!em2 || em2.nodeType !== 1 || em2.tagName.toLowerCase() !== 'em') return;

            // 守门 1: 第二个 <em> 必须为纯数字或数字+单个字母亚型（如 56, 42, 1a, 02）
            const em2Text = (em2.textContent || '').trim();
            if (!/^\d+[a-zA-Z]?$/.test(em2Text)) return;

            // 守门 2: 第一个 <em> 必须为非空行内生化名称且不包含换行或代码块
            const em1Text = (em1.textContent || '').trim();
            if (!em1Text || em1Text.length > 100 || em1Text.includes('\n')) return;
            if (em1.querySelector && em1.querySelector('table, pre, code, blockquote')) return;

            // 执行逆向重构
            prevNode.nodeValue = prevNode.nodeValue.slice(0, -1);
            const strong = document.createElement('strong');
            strong.setAttribute('data-fixed-bold', 'true');
            strong.setAttribute('data-ms-biochem-bold', '1');

            while (em1.firstChild) {
                strong.appendChild(em1.firstChild);
            }
            strong.appendChild(document.createTextNode('*'));
            while (em2.firstChild) {
                strong.appendChild(em2.firstChild);
            }

            // 检查并清除 em2 后方可能残留的孤立单星号（闭合 ** 泄露）
            let nextNode = em2.nextSibling;
            while (nextNode && ((nextNode.nodeType === 3 && !nextNode.nodeValue) || nextNode.nodeType === 8)) {
                nextNode = nextNode.nextSibling;
            }
            if (nextNode && nextNode.nodeType === 1) {
                for (let c = nextNode.firstChild; c; c = c.nextSibling) {
                    if (c.nodeType === 3 && c.nodeValue) { nextNode = c; break; }
                }
            }
            if (
                nextNode &&
                nextNode.nodeType === 3 &&
                /^\*(?!\*)/.test(nextNode.nodeValue) &&
                !/(?:^|[^\\])(?:\\\\)*\\\*/.test(nextNode.nodeValue)
            ) {
                nextNode.nodeValue = nextNode.nodeValue.replace(/^\*/, '');
            }

            em1.parentNode.insertBefore(strong, em1);
            em1.remove();
            em2.remove();
        });
    }

    // ==================== 5.19 修复 CJK 标点加粗与斜体窃取补偿 (v1.3.2 深度重构版) ====================
    // 根因：针对如 `> *“恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) *黑客。”*`，
    // 全角/半角右括号（`）`、`)`）、引号、书名号等在后方紧随汉字或空格时使闭合 `**` 沦为仅开启符或无法闭合，
    // 导致末尾 `*` 窃取其 1 个星号组成 `<em>` 并在正文中暴露裸星号，或者在缺失末尾 `*` 时整段作为裸星号文本暴露在 blockquote 中。
    // 在真实 Google AI Studio 中，Angular Ivy 会将文本节点包裹在 `<span class="ng-star-inserted">` 中，
    // 且存在 `<ms-cmark-node>` 嵌套，旧版直接读取 em.previousSibling 并断言其 nodeType === 3 会直接踏空退出。
    // 方案：
    //   1. 方案 A（窃取 em 修复）：引入 getPrecedingTextNode 与 getPreviousTextNode 深度穿透 Angular 的 span 与 ms-cmark-node 容器，
    //      全面放行半角/全角括号、中英文引号及标点与星号之间的任意空格（\s*），精准截取加粗词并原位重构为标准 strong，
    //      同时跨节点寻回前置引用斜体开启符，消除所有多余裸露星号并清理末尾星号残留；
    //   2. 方案 B（纯文本 blockquote 兜底）：遍历 blockquote、blockquote p、.callout 等容器，
    //      对未被 CommonMark 解析为 em 的裸星号引用文本进行行内正则解构与重组，确保无论解析器是否生成 em 均 100% 修复。
    function fixBrokenCjkPunctuationBold() {
        const subBlockTags = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'table', 'pre', 'hr']);

        function getLastTextNode(node) {
            if (!node) return null;
            if (node.nodeType === 3) return node;
            if (node.nodeType === 1) {
                for (let c = node.lastChild; c; c = c.previousSibling) {
                    const found = getLastTextNode(c);
                    if (found && found.nodeValue) return found;
                }
            }
            return null;
        }

        function getPrecedingTextNode(node) {
            let cur = node.previousSibling;
            while (cur) {
                if (cur.nodeType === 8 || (cur.nodeType === 3 && !cur.nodeValue)) {
                    cur = cur.previousSibling;
                    continue;
                }
                if (cur.nodeType === 3) return cur;
                if (cur.nodeType === 1) {
                    const tag = cur.tagName.toLowerCase();
                    if (subBlockTags.has(tag) || tag === 'pre' || tag === 'code' || tag === 'blockquote') {
                        return null;
                    }
                    const tn = getLastTextNode(cur);
                    if (tn) return tn;
                }
                cur = cur.previousSibling;
            }
            return null;
        }

        function getPreviousTextNode(node, boundary) {
            let cur = node;
            while (cur && cur !== boundary) {
                if (cur !== node && cur.tagName && subBlockTags.has(cur.tagName.toLowerCase())) {
                    break;
                }
                let prev = cur.previousSibling;
                while (prev) {
                    if (prev.nodeType === 8 || (prev.nodeType === 3 && !prev.nodeValue)) {
                        prev = prev.previousSibling;
                        continue;
                    }
                    if (prev.nodeType === 3) return prev;
                    if (prev.nodeType === 1) {
                        const tag = prev.tagName.toLowerCase();
                        if (subBlockTags.has(tag) || tag === 'pre' || tag === 'code' || tag === 'blockquote') {
                            return null;
                        }
                        const tn = getLastTextNode(prev);
                        if (tn) return tn;
                    }
                    prev = prev.previousSibling;
                }
                cur = cur.parentNode;
            }
            return null;
        }

        // 方案 A：针对已生成失窃 <em> 的场景
        const emElements = document.querySelectorAll(
            'ms-cmark-node em, ms-cmark-node blockquote em, ms-cmark-node .callout em, ' +
            '.markdown-content em, blockquote em, .callout em, em'
        );

        if (emElements && emElements.length > 0) {
            emElements.forEach((em) => {
                if (!em.parentNode) return;
                if (em.hasAttribute('data-fixed-italic') || (em.closest && em.closest('pre, code, [data-fixed-bold], [data-fixed-italic]'))) return;

                const blockBoundary = (em.closest && em.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, .callout')) || em.parentNode;

                const prevTextNode = getPrecedingTextNode(em);
                if (!prevTextNode || prevTextNode.nodeType !== 3) return;

                // 检查前置文本是否以全角/半角标点或汉字结尾，后方必须紧随 1~2 个星号（杜绝无星号普通标点误匹配导致跨段吞噬）
                const punctMatch = prevTextNode.nodeValue.match(/([）)\]］｝}〉》】〕』」〗〙'"”’！？!?。.,，、;；:：…—\-]|\p{Unified_Ideograph}|\p{Script=Hiragana}|\p{Script=Katakana})\s*\*{1,2}\s*$/u);
                if (!punctMatch) return;
                if (/(?:^|[^\\])(?:\\\\)*\\\*\s*$/.test(prevTextNode.nodeValue)) return;
                const punctIdx = punctMatch.index;

                // 守门：被窃取的 <em> 必须为非空行内文本且不包含块级元素
                const emText = em.textContent || '';
                if (!emText.trim()) return;
                if (em.querySelector && em.querySelector('table, pre, code, blockquote, p, ul, ol')) return;

                // 查找加粗开启符 **：优先在 prevTextNode 内部，若无则在当前块级容器内向前查找
                let startNode = null;
                let lastBoldIdx = -1;

                if (prevTextNode.nodeValue.lastIndexOf('**', punctIdx) !== -1) {
                    startNode = prevTextNode;
                    lastBoldIdx = prevTextNode.nodeValue.lastIndexOf('**', punctIdx);
                } else {
                    let curTn = prevTextNode;
                    while (curTn) {
                        curTn = getPreviousTextNode(curTn, blockBoundary);
                        if (!curTn) break;
                        if (curTn.nodeValue && curTn.nodeValue.includes('**')) {
                            startNode = curTn;
                            lastBoldIdx = curTn.nodeValue.lastIndexOf('**');
                            break;
                        }
                    }
                }
                if (!startNode || lastBoldIdx === -1) return;

                const beforeBold = startNode.nodeValue.slice(0, lastBoldIdx);

                // 查找前置斜体开启符 *：优先在 startNode 内的 beforeBold 查找，若无则在当前块级容器内向前查找
                let openItalicNode = null;
                let openItalicIdx = -1;

                for (let i = beforeBold.length - 1; i >= 0; i--) {
                    if (beforeBold[i] === '*' && beforeBold[i - 1] !== '*' && beforeBold[i + 1] !== '*') {
                        const beforeStar = beforeBold.slice(0, i);
                        if (!/(?:^|[^\\])(?:\\\\)*\\$/.test(beforeStar)) {
                            openItalicNode = startNode;
                            openItalicIdx = i;
                            break;
                        }
                    }
                }

                if (!openItalicNode) {
                    let curTn = startNode;
                    while (curTn) {
                        curTn = getPreviousTextNode(curTn, blockBoundary);
                        if (!curTn) break;
                        const val = curTn.nodeValue || '';
                        for (let i = val.length - 1; i >= 0; i--) {
                            if (val[i] === '*' && val[i - 1] !== '*' && val[i + 1] !== '*') {
                                const beforeStar = val.slice(0, i);
                                if (!/(?:^|[^\\])(?:\\\\)*\\$/.test(beforeStar)) {
                                    openItalicNode = curTn;
                                    openItalicIdx = i;
                                    break;
                                }
                            }
                        }
                        if (openItalicNode) break;
                    }
                }

                const strong = document.createElement('strong');
                strong.setAttribute('data-fixed-bold', 'true');

                if (startNode === prevTextNode) {
                    const boldText = prevTextNode.nodeValue.slice(lastBoldIdx + 2, punctIdx + 1);
                    if (!boldText.trim()) return;
                    strong.textContent = boldText;
                } else {
                    // 跨节点加粗（加粗内部含有 KaTeX 或其他行内节点）
                    const startBoldSlice = startNode.nodeValue.slice(lastBoldIdx + 2);
                    const endBoldSlice = prevTextNode.nodeValue.slice(0, punctIdx + 1);
                    if (startBoldSlice) strong.appendChild(document.createTextNode(startBoldSlice));

                    let s = startNode.nextSibling;
                    const middleNodes = [];
                    let reached = false;
                    while (s) {
                        if (s === prevTextNode || s.contains(prevTextNode)) {
                            reached = true;
                            break;
                        }
                        middleNodes.push(s);
                        s = s.nextSibling;
                    }
                    if (!reached) return;
                    for (let mIdx = 0; mIdx < middleNodes.length; mIdx++) {
                        strong.appendChild(middleNodes[mIdx]);
                    }
                    if (endBoldSlice) strong.appendChild(document.createTextNode(endBoldSlice));
                    if (!strong.textContent.trim()) return;
                }

                if (openItalicNode) {
                    // 存在外层引用斜体开启符 *：重组为包含内部 strong 的外层引用 em
                    const newEm = document.createElement('em');
                    newEm.setAttribute('data-fixed-italic', 'true');

                    if (openItalicNode === startNode) {
                        const textBeforeItalic = beforeBold.slice(0, openItalicIdx);
                        const quoteText = beforeBold.slice(openItalicIdx + 1);

                        if (quoteText) {
                            newEm.appendChild(document.createTextNode(quoteText));
                        }
                        newEm.appendChild(strong);
                        while (em.firstChild) {
                            newEm.appendChild(em.firstChild);
                        }

                        // 清理 newEm 内部末尾可能残留的孤立单星号
                        const lastTn = getLastTextNode(newEm);
                        if (lastTn && lastTn.nodeValue) {
                            lastTn.nodeValue = lastTn.nodeValue.replace(/\s*\*+\s*$/, '');
                        }

                        startNode.nodeValue = textBeforeItalic;
                        if (!textBeforeItalic) {
                            if (startNode.parentNode === em.parentNode) {
                                startNode.remove();
                            } else if (startNode.parentNode && startNode.parentNode.childNodes.length === 1 && !startNode.parentNode.textContent.trim()) {
                                startNode.parentNode.remove();
                            }
                        }
                        if (prevTextNode !== startNode) {
                            if (prevTextNode.parentNode === em.parentNode) {
                                prevTextNode.remove();
                            } else if (prevTextNode.parentNode && prevTextNode.parentNode.childNodes.length === 1 && !prevTextNode.parentNode.textContent.trim()) {
                                prevTextNode.parentNode.remove();
                            } else {
                                prevTextNode.remove();
                            }
                        }

                        em.parentNode.insertBefore(newEm, em);
                        em.remove();
                    } else {
                        // openItalicNode 是更早的前置兄弟文本节点（例如 quote 开头有公式或其他内联节点）
                        const textBeforeItalic = openItalicNode.nodeValue.slice(0, openItalicIdx);
                        const quoteText = openItalicNode.nodeValue.slice(openItalicIdx + 1);

                        openItalicNode.nodeValue = textBeforeItalic;
                        if (quoteText) {
                            newEm.appendChild(document.createTextNode(quoteText));
                        }

                        let pCur = openItalicNode.nextSibling;
                        while (pCur && pCur !== startNode && !pCur.contains(startNode)) {
                            newEm.appendChild(pCur);
                            pCur = pCur.nextSibling;
                        }

                        if (beforeBold) {
                            newEm.appendChild(document.createTextNode(beforeBold));
                        }
                        newEm.appendChild(strong);
                        while (em.firstChild) {
                            newEm.appendChild(em.firstChild);
                        }

                        const lastTn = getLastTextNode(newEm);
                        if (lastTn && lastTn.nodeValue) {
                            lastTn.nodeValue = lastTn.nodeValue.replace(/\s*\*+\s*$/, '');
                        }

                        if (startNode.parentNode === em.parentNode) {
                            startNode.remove();
                        } else if (startNode.parentNode && startNode.parentNode.childNodes.length === 1 && !startNode.parentNode.textContent.trim()) {
                            startNode.parentNode.remove();
                        }
                        if (prevTextNode !== startNode) {
                            if (prevTextNode.parentNode === em.parentNode) {
                                prevTextNode.remove();
                            } else if (prevTextNode.parentNode && prevTextNode.parentNode.childNodes.length === 1 && !prevTextNode.parentNode.textContent.trim()) {
                                prevTextNode.parentNode.remove();
                            }
                        }

                        em.parentNode.insertBefore(newEm, em);
                        em.remove();
                    }
                } else {
                    // 无外层斜体开启符：独立加粗，解构脱开伪 em
                    if (startNode === prevTextNode) {
                        prevTextNode.nodeValue = beforeBold;
                        em.parentNode.insertBefore(strong, em);
                        while (em.firstChild) {
                            em.parentNode.insertBefore(em.firstChild, em);
                        }
                        em.remove();
                    } else {
                        startNode.nodeValue = beforeBold;
                        if (prevTextNode.parentNode === em.parentNode) {
                            prevTextNode.remove();
                        } else if (prevTextNode.parentNode && prevTextNode.parentNode.childNodes.length === 1 && !prevTextNode.parentNode.textContent.trim()) {
                            prevTextNode.parentNode.remove();
                        }
                        em.parentNode.insertBefore(strong, em);
                        while (em.firstChild) {
                            em.parentNode.insertBefore(em.firstChild, em);
                        }
                        em.remove();
                    }
                }
            });
        }

        // 方案 B：针对解析器未生成任何 <em> 的纯文本引用块（如末尾缺失闭合 * 的 `> *"恭喜...**31337 (顶级精英) *黑客。”`）
        // 检索 blockquote, .callout 等引用容器内的未解析裸星号引用（严格排除普通正文段落，防止误伤流式活跃段落）
        const quoteContainers = document.querySelectorAll(
            'ms-cmark-node blockquote, ms-cmark-node blockquote p, ms-cmark-node .callout, ms-cmark-node .callout p, ' +
            '.markdown-content blockquote, .markdown-content blockquote p, .markdown-content .callout, .markdown-content .callout p, ' +
            'blockquote, blockquote p, .callout, .callout p'
        );

        quoteContainers.forEach((container) => {
            if (container.closest && container.closest('pre, code, [data-fixed-italic]')) return;
            const walker = document.createTreeWalker(container, NodeFilter ? NodeFilter.SHOW_TEXT : 4, null);
            const rawTextNodes = [];
            let tNode;
            while ((tNode = walker.nextNode())) {
                rawTextNodes.push(tNode);
            }

            const rawQuoteRegex = /(?<![\\*])\*(["“][^*]+?)\*\*([^*]+?[）)\]］｝}〉》】〕』」〗〙'"”’！？!?。.,，、;；:：…—\-]|\p{Unified_Ideograph}|\p{Script=Hiragana}|\p{Script=Katakana})(?:\s*\*{1,2}\s*|\*{1,2})([^*]+?)(?:\*|(?<=[”"』」’'])\s*$)/u;

            rawTextNodes.forEach((node) => {
                if (!node.parentNode || !node.nodeValue) return;
                if (node.parentNode.hasAttribute && (node.parentNode.hasAttribute('data-fixed-italic') || node.parentNode.hasAttribute('data-fixed-bold'))) return;
                if (node.parentNode.closest && node.parentNode.closest('pre, code, ms-katex, [data-fixed-italic], [data-fixed-bold]')) return;

                const match = node.nodeValue.match(rawQuoteRegex);
                if (!match) return;

                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;
                const beforeText = node.nodeValue.slice(0, matchStart);
                const afterText = node.nodeValue.slice(matchEnd);

                const quoteLead = match[1];
                const boldContent = match[2];
                const quoteTail = match[3];

                const newEm = document.createElement('em');
                newEm.setAttribute('data-fixed-italic', 'true');

                if (quoteLead) {
                    newEm.appendChild(document.createTextNode(quoteLead));
                }

                const strong = document.createElement('strong');
                strong.setAttribute('data-fixed-bold', 'true');
                strong.textContent = boldContent;
                newEm.appendChild(strong);

                if (quoteTail) {
                    newEm.appendChild(document.createTextNode(quoteTail));
                }

                const parent = node.parentNode;
                if (!parent) return;

                if (beforeText) {
                    parent.insertBefore(document.createTextNode(beforeText), node);
                }
                parent.insertBefore(newEm, node);
                // 原位更新并保留原始 TextNode，防止 Angular Ivy LView 流式文本节点脱离 DOM 树
                node.nodeValue = afterText;
            });
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
            'ms-cmark-node blockquote, ms-cmark-node blockquote p, ms-cmark-node .callout, ms-cmark-node .callout p, ' +
            '.markdown-content p, .markdown-content li, .markdown-content td, .markdown-content th, ' +
            '.markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4, .markdown-content h5, .markdown-content h6, ' +
            '.markdown-content blockquote, .markdown-content blockquote p, .markdown-content .callout, .markdown-content .callout p, ' +
            'blockquote, blockquote p, .callout, .callout p';
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
                            child.hasAttribute('data-ms-math-hidden') ||
                            child.hasAttribute('data-ms-sub-tilde')
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
                            child.hasAttribute('data-ms-math-hidden') ||
                            child.hasAttribute('data-ms-sub-tilde')
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

            const curLen = tc.textContent ? tc.textContent.length : 0;
            if (turn._msLastCheckedLen === curLen && turn.dataset.syncedWideWidth) return;
            turn._msLastCheckedLen = curLen;

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
        fixBrokenCodeBlocks();             // 1. 最先解构伪代码块，使释放出来的段落无缝流入后续管线
        fixBrokenCurrencyMath();           // 2. 还原美元货币假公式
        fixBrokenParagraphs();             // 3. 修复段落 KaTeX 公式（自动渲染解构容器中的 $h_t$）
        fixBrokenTableRows();              // 4. 修复 Markdown 表格公式与分块矩阵
        fixBrokenTildeMarkdown();          // 5. 修复波浪号误伤（涵盖 sub 及具备数值区间的 del/s）
        fixBrokenBiochemicalStarBold();    // 6. 修复生化/蛋白质星号命名加粗误拆（如 **A$\beta$*56**）
        fixBrokenCjkPunctuationBold();     // 7. 修复 CJK 标点闭合加粗与斜体窃取补偿（如 *“...**31337（顶级精英）**黑客。”*）
        fixBrokenBoldMarkdown();           // 8. 重配加粗状态机（自动加粗解构容器中的 **内容）
        syncWideTurnWidths();              // 9. 虚拟滚动宽度对齐
    }

    let isRunningFixes = false;
    function safeRunAllFixes() {
        if (isRunningFixes) return;
        isRunningFixes = true;
        try {
            runAllFixes();
        } finally {
            if (observer && typeof observer.takeRecords === 'function') {
                observer.takeRecords();
            }
            isRunningFixes = false;
        }
    }

    let timer = null;
    let firstPendingTs = 0;
    const observer = new (win.MutationObserver || MutationObserver)(() => {
        if (isRunningFixes) return;
        const now = Date.now();
        if (!firstPendingTs) firstPendingTs = now;
        clearTimeout(timer);
        // 300ms 防抖，若持续处于高频流式输出中，最多等待 1000ms 强制执行一次
        const delay = (now - firstPendingTs >= 1000) ? 0 : 300;
        timer = setTimeout(() => {
            timer = null;
            firstPendingTs = 0;
            safeRunAllFixes();
        }, delay);
    });

    function startObserver() {
        const target = document.body || document.documentElement;
        if (!target) {
            window.addEventListener('DOMContentLoaded', startObserver, { once: true });
            return;
        }
        observer.observe(target, { childList: true, subtree: true, characterData: true });
        safeRunAllFixes();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
        startObserver();
    }
})();
