// test-runner.js - Automated tests for Google AI Studio LaTeX & Markdown Fix (v1.3.0)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('=== Starting Test Suite for google-aistudio-latex-markdown-fix.user.js ===\n');

// 1. DOM Implementation for Node.js
class MockNode {
    constructor(nodeType, nodeName) {
        this.nodeType = nodeType;
        this.nodeName = nodeName;
        this.childNodes = [];
        this.parentNode = null;
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }

    get lastChild() {
        return this.childNodes[this.childNodes.length - 1] || null;
    }

    get firstElementChild() {
        return this.childNodes.find(c => c.nodeType === 1) || null;
    }

    get lastElementChild() {
        for (let i = this.childNodes.length - 1; i >= 0; i--) {
            if (this.childNodes[i].nodeType === 1) return this.childNodes[i];
        }
        return null;
    }

    get nextSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 && idx < this.parentNode.childNodes.length - 1 ? this.parentNode.childNodes[idx + 1] : null;
    }

    get previousSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
    }

    get nextElementSibling() {
        let cur = this.nextSibling;
        while (cur) {
            if (cur.nodeType === 1) return cur;
            cur = cur.nextSibling;
        }
        return null;
    }

    get previousElementSibling() {
        let cur = this.previousSibling;
        while (cur) {
            if (cur.nodeType === 1) return cur;
            cur = cur.previousSibling;
        }
        return null;
    }

    get isConnected() {
        let cur = this;
        while (cur) {
            if (cur === cur.parentNode) return false;
            if (!cur.parentNode) {
                return cur.nodeName === '#document' || (global.document && cur === global.document.body);
            }
            cur = cur.parentNode;
        }
        return false;
    }

    appendChild(child) {
        this._rawInnerHTML = undefined;
        if (child.nodeType === 11) {
            const children = [...child.childNodes];
            children.forEach(c => this.appendChild(c));
            child.childNodes = [];
            return child;
        }
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    insertBefore(newChild, refChild) {
        this._rawInnerHTML = undefined;
        if (newChild.nodeType === 11) {
            const children = [...newChild.childNodes];
            children.forEach(c => this.insertBefore(c, refChild));
            newChild.childNodes = [];
            return newChild;
        }
        if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
        newChild.parentNode = this;
        if (!refChild) {
            this.childNodes.push(newChild);
        } else {
            const idx = this.childNodes.indexOf(refChild);
            if (idx === -1) {
                this.childNodes.push(newChild);
            } else {
                this.childNodes.splice(idx, 0, newChild);
            }
        }
        return newChild;
    }

    removeChild(child) {
        this._rawInnerHTML = undefined;
        const idx = this.childNodes.indexOf(child);
        if (idx !== -1) {
            this.childNodes.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    contains(other) {
        let cur = other;
        while (cur) {
            if (cur === this) return true;
            cur = cur.parentNode;
        }
        return false;
    }
}

class MockTextNode extends MockNode {
    constructor(text) {
        super(3, '#text');
        this.nodeValue = text || '';
    }

    get textContent() {
        return this.nodeValue;
    }

    set textContent(val) {
        this.nodeValue = String(val);
    }
}

class MockElement extends MockNode {
    constructor(tagName) {
        super(1, tagName.toUpperCase());
        this.tagName = tagName.toUpperCase();
        this.attributes = new Map();
        this.style = {
            _props: new Map(),
            setProperty(name, val, priority) {
                this._props.set(name, { val, priority });
                this[name] = val;
            },
            getPropertyValue(name) {
                const p = this._props.get(name);
                return p ? p.val : (this[name] || '');
            },
            removeProperty(name) {
                this._props.delete(name);
                this[name] = '';
            },
            display: '',
            verticalAlign: '',
            fontSize: '',
            lineHeight: '',
            textDecoration: '',
            fontWeight: '',
            background: '',
            border: '',
            boxShadow: '',
            margin: '',
            padding: ''
        };
        this.dataset = {};
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            contains: (c) => this.classList._classes.has(c)
        };
    }

    setAttribute(name, val) {
        this.attributes.set(name, String(val));
        if (name === 'class') {
            this.classList._classes.clear();
            val.split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
        }
        if (name.startsWith('data-')) {
            const camel = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            this.dataset[camel] = String(val);
        }
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name.startsWith('data-')) {
            const camel = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            delete this.dataset[camel];
        }
    }

    get className() {
        return Array.from(this.classList._classes).join(' ');
    }

    set className(val) {
        this.setAttribute('class', val);
    }

    get textContent() {
        let res = '';
        for (const child of this.childNodes) {
            res += child.textContent;
        }
        return res;
    }

    set textContent(val) {
        this._rawInnerHTML = undefined;
        this.childNodes = [];
        if (val) {
            this.appendChild(new MockTextNode(String(val)));
        }
    }

    get innerHTML() {
        if (this._rawInnerHTML !== undefined) return this._rawInnerHTML;
        let res = '';
        for (const child of this.childNodes) {
            if (child.nodeType === 3) res += child.nodeValue;
            else if (child.nodeType === 1) {
                let attrs = '';
                if (child.className) attrs += ` class="${child.className}"`;
                for (const [k, v] of child.attributes.entries()) {
                    if (k !== 'class') attrs += ` ${k}="${v}"`;
                }
                res += `<${child.tagName.toLowerCase()}${attrs}>${child.innerHTML}</${child.tagName.toLowerCase()}>`;
            }
        }
        return res;
    }

    set innerHTML(val) {
        this._rawInnerHTML = String(val);
        this.childNodes = [];
        if (val) {
            this.appendChild(new MockTextNode(String(val)));
        }
    }

    closest(selector) {
        let cur = this;
        while (cur && cur.nodeType === 1) {
            if (matchesSimple(cur, selector)) return cur;
            cur = cur.parentNode;
        }
        return null;
    }

    querySelector(selector) {
        return querySelectorAllDeep(this, selector)[0] || null;
    }

    querySelectorAll(selector) {
        return querySelectorAllDeep(this, selector);
    }
}

function matchesSimple(el, selector) {
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(part => {
        // Space-separated descendant
        if (part.includes(' ')) {
            const segs = part.split(/\s+/);
            const targetSeg = segs[segs.length - 1];
            if (!matchSingle(el, targetSeg)) return false;
            let cur = el.parentNode;
            for (let i = segs.length - 2; i >= 0; i--) {
                const seg = segs[i];
                let matched = false;
                while (cur && cur.nodeType === 1) {
                    if (matchSingle(cur, seg)) {
                        matched = true;
                        cur = cur.parentNode;
                        break;
                    }
                    cur = cur.parentNode;
                }
                if (!matched) return false;
            }
            return true;
        }
        return matchSingle(el, part);
    });
}

function matchSingle(el, sel) {
    if (!sel || !el || el.nodeType !== 1) return false;
    let s = sel;
    // Attribute check [attr] or [attr="val"]
    const attrMatch = s.match(/\[([^=\]]+)(?:="?([^"\]]+)"?)?\]/);
    if (attrMatch) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2];
        if (!el.hasAttribute(attrName)) return false;
        if (attrVal !== undefined && el.getAttribute(attrName) !== attrVal) return false;
        s = s.replace(attrMatch[0], '');
    }
    // Class check .className
    const classMatch = s.match(/\.([\w-]+)/g);
    if (classMatch) {
        for (const cls of classMatch) {
            if (!el.classList.contains(cls.slice(1))) return false;
        }
        s = s.replace(/\.([\w-]+)/g, '');
    }
    // Tag check
    if (s && s !== '*') {
        if (el.tagName.toLowerCase() !== s.toLowerCase()) return false;
    }
    return true;
}

function querySelectorAllDeep(root, selector) {
    const results = [];
    function scan(node) {
        for (const child of node.childNodes) {
            if (child.nodeType === 1) {
                if (matchesSimple(child, selector)) {
                    results.push(child);
                }
                scan(child);
            }
        }
    }
    scan(root);
    return results;
}

class MockTreeWalker {
    constructor(root, whatToShow) {
        this.root = root;
        this.whatToShow = whatToShow;
        this.current = root;
        this.nodes = [];
        this._collect(root);
        this.index = 0;
    }

    _collect(node) {
        for (const child of node.childNodes) {
            if (this.whatToShow === 4 && child.nodeType === 3) {
                this.nodes.push(child);
            } else if (child.nodeType === 1) {
                this._collect(child);
            }
        }
    }

    nextNode() {
        if (this.index < this.nodes.length) {
            this.current = this.nodes[this.index++];
            return this.current;
        }
        return null;
    }
}

class MockDocument extends MockNode {
    constructor() {
        super(9, '#document');
        this.body = new MockElement('body');
        this.documentElement = new MockElement('html');
        this.documentElement.appendChild(this.body);
        this.appendChild(this.documentElement);
        this.readyState = 'complete';
    }

    createElement(tagName) {
        return new MockElement(tagName);
    }

    createDocumentFragment() {
        return new MockNode(11, '#document-fragment');
    }

    createTextNode(text) {
        return new MockTextNode(text);
    }

    createTreeWalker(root, whatToShow) {
        return new MockTreeWalker(root, whatToShow);
    }

    querySelector(selector) {
        return querySelectorAllDeep(this, selector)[0] || null;
    }

    querySelectorAll(selector) {
        return querySelectorAllDeep(this, selector);
    }

    addEventListener() {}
}

// Set up global environment
const mockDoc = new MockDocument();
global.document = mockDoc;
const winListeners = {};
global.window = {
    document: mockDoc,
    Map: global.Map,
    Array: global.Array,
    MutationObserver: class {
        observe() {}
        disconnect() {}
    },
    _listeners: winListeners,
    addEventListener(event, fn) {
        if (!winListeners[event]) winListeners[event] = [];
        winListeners[event].push(fn);
    }
};
global.NodeFilter = { SHOW_TEXT: 4 };
global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
global.HTMLElement = MockElement;
global.katex = {
    render: (tex, el, opts) => {
        const span = mockDoc.createElement('span');
        span.className = 'katex';
        span.appendChild(mockDoc.createTextNode(tex));
        el.appendChild(span);
    },
    renderToString: (tex, opts) => `<span class="katex"><span class="katex-html">${tex}</span></span>`
};

// 2. Load and evaluate the user script
const scriptPath = path.resolve('google-aistudio-latex-markdown-fix.user.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

// Verify metadata header
console.log('--- Test Suite 1: Script Header & Metadata Check ---');
const versionMatch = scriptSource.match(/@version\s+([0-9.]+)/);
assert.ok(versionMatch, 'Version header should exist');
assert.strictEqual(versionMatch[1], '1.5.1', 'Version should be bumped to 1.5.1');
console.log('✔ Version is correctly 1.5.1');

assert.ok(scriptSource.includes('fixBrokenCodeBlocks'), 'Script must define fixBrokenCodeBlocks');
assert.ok(scriptSource.includes('fixBrokenTildeMarkdown'), 'Script must define fixBrokenTildeMarkdown');
assert.ok(scriptSource.includes('fixBrokenBiochemicalStarBold'), 'Script must define fixBrokenBiochemicalStarBold');
assert.ok(scriptSource.includes('fixBrokenCjkPunctuationBold'), 'Script must define fixBrokenCjkPunctuationBold');
assert.ok(!scriptSource.includes('fixBrokenRetractionAndTruncation'), 'Flawed DOM level retraction wiper should be cleanly removed');
assert.ok(!scriptSource.includes('function fixBrokenSubscriptMarkdown'), 'Old fixBrokenSubscriptMarkdown function definition should be removed');
console.log('✔ Functions correctly named and old function removed\n');

// Wrap script in an evaluator that exposes private functions for testing
const wrappedSource = scriptSource.replace(
    'function runAllFixes() {',
    'global.__scriptInternals = { fixBrokenCodeBlocks, fixBrokenTildeMarkdown, fixBrokenBiochemicalStarBold, fixBrokenCjkPunctuationBold, fixBrokenParagraphs, fixBrokenBoldMarkdown, findRawLatexEnvBlock, collectRawLatexEnvsFromString, rawLatexEnvBlocks, isUserInitiatedAction, markUserAction, resetUserAction: () => { userActiveActionTs = 0; }, runAllFixes };\nfunction runAllFixes() {'
);

try {
    new Function(wrappedSource)();
    console.log('✔ Script evaluated without runtime errors in Mock DOM\n');
} catch (e) {
    console.error('Failed to evaluate script:', e);
    process.exit(1);
}

const {
    fixBrokenCodeBlocks,
    fixBrokenTildeMarkdown,
    fixBrokenBiochemicalStarBold,
    fixBrokenCjkPunctuationBold,
    fixBrokenParagraphs,
    fixBrokenBoldMarkdown,
    findRawLatexEnvBlock,
    collectRawLatexEnvsFromString,
    rawLatexEnvBlocks,
    isUserInitiatedAction,
    markUserAction,
    resetUserAction,
    runAllFixes
} = global.__scriptInternals;

// ----------------------------------------------------
console.log('--- Test Suite 2: fixBrokenCodeBlocks Tests ---');

// 2.1 The Mamba Swallowed Code Block Scenario
{
    mockDoc.body.childNodes = [];
    const turn = mockDoc.createElement('div');
    turn.className = 'markdown-content';

    const codeBlock = mockDoc.createElement('ms-code-block');
    const header = mockDoc.createElement('div');
    header.className = 'mat-expansion-panel-header';
    const title = mockDoc.createElement('span');
    title.className = 'mat-panel-title';
    title.textContent = 'Code';
    header.appendChild(title);
    codeBlock.appendChild(header);

    const pre = mockDoc.createElement('pre');
    pre.textContent =
`  **直接把这几十兆的状态存成一个文件。**
  下次你上线时直接把这个文件加载回显存，就能瞬间恢复到上次聊天的记忆状态。

### 总结
Transformer 和 Mamba 在处理长对话历史时，逻辑是完全相反的：
* 隐藏状态 $h_t$ 恒定在几十兆
* 显存占用固定为 $O(1)$`;
    codeBlock.appendChild(pre);
    turn.appendChild(codeBlock);
    mockDoc.body.appendChild(turn);

    fixBrokenCodeBlocks();

    // Verification
    assert.strictEqual(codeBlock.getAttribute('data-ms-code-unpacked'), '1', 'Code block should be marked unpacked');
    assert.strictEqual(header.style.display, 'none', 'Header should be hidden');
    assert.strictEqual(pre.style.display, 'none', 'Pre should be hidden');
    assert.strictEqual(codeBlock.parentNode, turn, 'Code block DOM node must remain intact for Angular Ivy');

    const unpackDiv = codeBlock.querySelector('.markdown-content.ms-unpacked-code');
    assert.ok(unpackDiv, 'Unpack container div should exist');

    const h3 = unpackDiv.querySelector('h3');
    assert.ok(h3, 'Heading ### 总结 should be converted to <h3>');
    assert.strictEqual(h3.textContent, '总结');

    const ul = unpackDiv.querySelector('ul');
    assert.ok(ul, 'List should be converted to <ul>');
    const lis = unpackDiv.querySelectorAll('li');
    assert.strictEqual(lis.length, 2, 'Should have 2 <li> items');

    const ps = unpackDiv.querySelectorAll('p');
    assert.ok(ps.length >= 1, 'Should have paragraph(s)');

    // Now test pipeline succession: KaTeX math and Bold fixing
    fixBrokenParagraphs();
    fixBrokenBoldMarkdown();

    // Check if **直接把这几十兆的状态存成一个文件。** was bolded
    const strong = unpackDiv.querySelector('strong');
    assert.ok(strong, 'Bold markdown **...** in unpacked container should be converted to <strong>');
    assert.ok(strong.textContent.includes('直接把这几十兆的状态存成一个文件。'));

    // Check if $h_t$ and $O(1)$ were rendered by KaTeX
    const katexNodes = unpackDiv.querySelectorAll('.katex');
    assert.ok(katexNodes.length >= 2, 'KaTeX formulas in unpacked block should be rendered');

    console.log('✔ Case 2.1 Passed: Mamba swallowed code block unpacked, heading created, bold and KaTeX rendered successfully');
}

// 2.2 Streaming incremental updates
{
    mockDoc.body.childNodes = [];
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent = '  **初始状态。**\n### 总结';
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    fixBrokenCodeBlocks();
    const div1 = cb._msUnpackDiv;
    assert.ok(div1, 'Initial unpack div exists');

    // Streaming updates: same text -> should not rebuild
    fixBrokenCodeBlocks();
    assert.strictEqual(cb._msUnpackDiv, div1, 'Unpack div preserved when text unchanged');

    // Streaming updates: text extended -> should cleanly rebuild
    pre.textContent = '  **初始状态。**\n### 总结\n新流式内容到达。';
    fixBrokenCodeBlocks();
    const div2 = cb._msUnpackDiv;
    assert.notStrictEqual(div2, div1, 'Unpack div updated when new stream arrives');
    assert.ok(div2.textContent.includes('新流式内容到达'), 'New content reflected');

    console.log('✔ Case 2.2 Passed: Streaming incremental updates handled seamlessly');
}

// 2.3 Real code blocks protection (languages explicitly specified)
{
    mockDoc.body.childNodes = [];
    const langs = ['python', 'json', 'cpp', 'bash', 'javascript', 'html', 'sql'];
    for (const lang of langs) {
        const cb = mockDoc.createElement('ms-code-block');
        const header = mockDoc.createElement('div');
        header.className = 'mat-expansion-panel-header';
        const title = mockDoc.createElement('span');
        title.className = 'mat-panel-title';
        title.textContent = lang;
        header.appendChild(title);
        cb.appendChild(header);

        const pre = mockDoc.createElement('pre');
        pre.textContent = `# 总结。\n**test**\n$x=1$\nprint("hello from ${lang}")`;
        cb.appendChild(pre);
        mockDoc.body.appendChild(cb);

        fixBrokenCodeBlocks();
        assert.strictEqual(cb.hasAttribute('data-ms-code-unpacked'), false, `Real ${lang} code block must NEVER be unpacked`);
    }
    console.log('✔ Case 2.3 Passed: Real language-tagged code blocks 100% protected');
}

// 2.4 Real code protection without language tags (Python / JS scripts)
{
    mockDoc.body.childNodes = [];
    const cb1 = mockDoc.createElement('ms-code-block');
    const pre1 = mockDoc.createElement('pre');
    pre1.textContent = `# 初始化模型配置。\ndef load_model():\n    return None`;
    cb1.appendChild(pre1);
    mockDoc.body.appendChild(cb1);

    const cb2 = mockDoc.createElement('ms-code-block');
    const pre2 = mockDoc.createElement('pre');
    pre2.textContent = `const a = 1;\nconsole.log(a);`;
    cb2.appendChild(pre2);
    mockDoc.body.appendChild(cb2);

    fixBrokenCodeBlocks();
    assert.strictEqual(cb1.hasAttribute('data-ms-code-unpacked'), false, 'Python script without lang tag must NOT be unpacked');
    assert.strictEqual(cb2.hasAttribute('data-ms-code-unpacked'), false, 'JS script without lang tag must NOT be unpacked');
    console.log('✔ Case 2.4 Passed: Real programming code without language tags protected from false positives');
}

// 2.5 Angular Material Header with <mat-icon> icon ligature (Live AI Studio DOM)
{
    mockDoc.body.childNodes = [];
    const cb = mockDoc.createElement('ms-code-block');
    const header = mockDoc.createElement('div');
    header.className = 'mat-expansion-panel-header';
    const title = mockDoc.createElement('span');
    title.className = 'mat-panel-title';

    const icon = mockDoc.createElement('mat-icon');
    icon.textContent = 'code';
    title.appendChild(icon);
    title.appendChild(mockDoc.createTextNode(' Code'));
    header.appendChild(title);
    cb.appendChild(header);

    const pre = mockDoc.createElement('pre');
    pre.textContent = '  **直接把这几十兆的状态存成一个文件。**\n### 总结\nTransformer 和 Mamba 机制。';
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    fixBrokenCodeBlocks();
    assert.strictEqual(cb.getAttribute('data-ms-code-unpacked'), '1', 'Code block with mat-icon in header must be correctly unpacked');
    console.log('✔ Case 2.5 Passed: Angular Material header containing <mat-icon> correctly unpacked');
}

// 2.6 Headings and list items starting with numbers and English words
{
    mockDoc.body.childNodes = [];
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent = '### 1. 架构对比\n这里是正文说明，逻辑完全不同：\n* Mamba 的处理速度很快，显存占用固定。';
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    fixBrokenCodeBlocks();
    assert.strictEqual(cb.getAttribute('data-ms-code-unpacked'), '1', 'Headings starting with numbers and lists with English must be unpacked');
    const unpackDiv = cb.querySelector('.ms-unpacked-code');
    const h3 = unpackDiv.querySelector('h3');
    assert.ok(h3, 'Heading starting with number converted to <h3>');
    assert.strictEqual(h3.textContent, '1. 架构对比');
    const li = unpackDiv.querySelector('li');
    assert.ok(li, 'List starting with English converted to <li>');
    assert.strictEqual(li.textContent, 'Mamba 的处理速度很快，显存占用固定。');
    console.log('✔ Case 2.6 Passed: Alphanumeric headings and list items accurately parsed');
}

// 2.7 Inner code blocks and blockquotes inside swallowed pseudo-code block
{
    mockDoc.body.childNodes = [];
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent =
`### 核心总结
这里是重要段落：
> 注意：显存恒定为 $O(1)$。

示例代码如下：
\`\`\`python
def load_state():
    return torch.load("memory.pt")
\`\`\`
恢复状态完成。`;
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    fixBrokenCodeBlocks();
    assert.strictEqual(cb.getAttribute('data-ms-code-unpacked'), '1');
    const unpackDiv = cb.querySelector('.ms-unpacked-code');
    const bq = unpackDiv.querySelector('blockquote');
    assert.ok(bq, 'Blockquote created');
    assert.ok(bq.textContent.includes('注意：显存恒定为'));

    const innerPre = unpackDiv.querySelector('pre');
    assert.ok(innerPre, 'Inner code block created as <pre>');
    const innerCode = innerPre.querySelector('code');
    assert.ok(innerCode, 'Inner <code> element created');
    assert.strictEqual(innerCode.className, 'language-python');
    assert.ok(innerCode.textContent.includes('def load_state():'));
    console.log('✔ Case 2.7 Passed: Inner code blocks and blockquotes structured properly');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 3: fixBrokenTildeMarkdown Tests ---');

// 3.1 The Argon Quota Scenario (del + bold concatenation fix)
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';

    // DOM: "发一句话消耗约 5%" <del>"16% 额度，连问 " <strong>"3"</strong></del> <strong>"5 次"</strong> " 就会触发 5 小时限制。"
    const t1 = mockDoc.createTextNode('发一句话消耗约 5%');
    const del = mockDoc.createElement('del');
    const delText = mockDoc.createTextNode('16% 额度，连问 ');
    const strong3 = mockDoc.createElement('strong');
    strong3.appendChild(mockDoc.createTextNode('3'));
    del.appendChild(delText);
    del.appendChild(strong3);

    const strong5 = mockDoc.createElement('strong');
    strong5.appendChild(mockDoc.createTextNode('5 次'));
    const t2 = mockDoc.createTextNode(' 就会触发 5 小时限制。');

    p.appendChild(t1);
    p.appendChild(del);
    p.appendChild(strong5);
    p.appendChild(t2);
    mockDoc.body.appendChild(p);

    fixBrokenTildeMarkdown();

    // Verification
    assert.strictEqual(del.getAttribute('data-ms-unsub'), 'true', 'del should be marked unsub');
    assert.strictEqual(del.style.getPropertyValue('text-decoration'), 'none', 'Strikethrough line must be erased');

    const openTilde = del.querySelector('[data-ms-sub-tilde="open"]');
    assert.ok(openTilde, 'Opening tilde must be inserted');
    assert.strictEqual(openTilde.textContent, '~');
    assert.strictEqual(openTilde.style.fontWeight, '', 'Opening tilde between 5% and 16% must NOT be bold');

    const closeTilde = del.querySelector('[data-ms-sub-tilde="close"]');
    assert.ok(closeTilde, 'Closing tilde must be inserted');
    assert.strictEqual(closeTilde.textContent, '~');
    assert.strictEqual(closeTilde.style.fontWeight, 'bold', 'Closing tilde must inherit bold weight from adjacent strong');

    // Verify visual sequence
    assert.strictEqual(
        p.textContent,
        '发一句话消耗约 5%~16% 额度，连问 3~5 次 就会触发 5 小时限制。',
        'Text content must correctly separate 3 and 5 with tildes'
    );
    console.log('✔ Case 3.1 Passed: Argon quota strikethrough cleared, 5%~16% and bold 3~5 次 restored');
}

// 3.2 Legitimate Chinese strikethrough protection (NO FALSE POSITIVES)
{
    mockDoc.body.childNodes = [];
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    const t1 = mockDoc.createTextNode('请注意：');
    const del1 = mockDoc.createElement('del');
    del1.appendChild(mockDoc.createTextNode('已作废的旧方案'));
    const t2 = mockDoc.createTextNode('，请参考新方案。');
    p1.appendChild(t1);
    p1.appendChild(del1);
    p1.appendChild(t2);
    mockDoc.body.appendChild(p1);

    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    const t3 = mockDoc.createTextNode('商品原价 ');
    const del2 = mockDoc.createElement('del');
    del2.appendChild(mockDoc.createTextNode('500 元'));
    const t4 = mockDoc.createTextNode('，现价 200 元。');
    p2.appendChild(t3);
    p2.appendChild(del2);
    p2.appendChild(t4);
    mockDoc.body.appendChild(p2);

    const p3 = mockDoc.createElement('p');
    p3.className = 'markdown-content';
    const del3 = mockDoc.createElement('del');
    del3.appendChild(mockDoc.createTextNode('100'));
    const t5 = mockDoc.createTextNode(' 200 元');
    p3.appendChild(del3);
    p3.appendChild(t5);
    mockDoc.body.appendChild(p3);

    fixBrokenTildeMarkdown();

    assert.strictEqual(del1.hasAttribute('data-ms-unsub'), false, 'Legitimate Chinese strikethrough must NOT be touched');
    assert.strictEqual(del1.style.textDecoration, '', 'Strikethrough style must remain untouched');
    assert.strictEqual(del2.hasAttribute('data-ms-unsub'), false, 'Legitimate strikethrough with number and unit must NOT be touched');
    assert.strictEqual(del3.hasAttribute('data-ms-unsub'), false, 'Strikethrough separated by space must NOT be touched');

    console.log('✔ Case 3.2 Passed: Legitimate strikethrough cases rigorously protected');
}

// 3.3 Subscript backward compatibility
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    p.appendChild(mockDoc.createTextNode('费用约 2万'));
    const sub = mockDoc.createElement('sub');
    sub.appendChild(mockDoc.createTextNode('5万日元（约1000'));
    p.appendChild(sub);
    p.appendChild(mockDoc.createTextNode('2500人民币）'));
    mockDoc.body.appendChild(p);

    fixBrokenTildeMarkdown();

    assert.strictEqual(sub.getAttribute('data-ms-unsub'), 'true', 'Subscript should be recognized');
    assert.strictEqual(sub.style.getPropertyValue('vertical-align'), 'baseline', 'Subscript should be reset to baseline');
    assert.strictEqual(p.textContent, '费用约 2万~5万日元（约1000~2500人民币）');
    console.log('✔ Case 3.3 Passed: Subscript backward compatibility verified');
}

// 3.4 s and strike tag support
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    p.appendChild(mockDoc.createTextNode('延迟从 10ms'));
    const sTag = mockDoc.createElement('s');
    sTag.appendChild(mockDoc.createTextNode('50ms 到 100ms'));
    p.appendChild(sTag);
    p.appendChild(mockDoc.createTextNode('200ms'));
    mockDoc.body.appendChild(p);

    fixBrokenTildeMarkdown();

    assert.strictEqual(sTag.getAttribute('data-ms-unsub'), 'true', 's tag should be handled');
    assert.strictEqual(sTag.style.getPropertyValue('text-decoration'), 'none');
    assert.strictEqual(p.textContent, '延迟从 10ms~50ms 到 100ms~200ms');
    console.log('✔ Case 3.4 Passed: s and strike tags supported');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 4: runAllFixes() End-to-End Integration ---');
{
    mockDoc.body.childNodes = [];

    // 1. Swallowed code block
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent = '  **直接把这几十兆的状态存成一个文件。**\n### 总结\n公式为 $h_t$。';
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    // 2. Broken tilde del
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    p1.appendChild(mockDoc.createTextNode('消耗 5%'));
    const del = mockDoc.createElement('del');
    del.appendChild(mockDoc.createTextNode('16% 额度，连问 '));
    const st3 = mockDoc.createElement('strong');
    st3.appendChild(mockDoc.createTextNode('3'));
    del.appendChild(st3);
    p1.appendChild(del);
    const st5 = mockDoc.createElement('strong');
    st5.appendChild(mockDoc.createTextNode('5 次'));
    p1.appendChild(st5);
    mockDoc.body.appendChild(p1);

    // 3. Legitimate strikethrough
    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    const legitDel = mockDoc.createElement('del');
    legitDel.appendChild(mockDoc.createTextNode('~~已作废~~'));
    p2.appendChild(legitDel);
    mockDoc.body.appendChild(p2);

    // 4. Real python code
    const cbPython = mockDoc.createElement('ms-code-block');
    const pyHeader = mockDoc.createElement('div');
    pyHeader.className = 'mat-expansion-panel-header';
    const pyTitle = mockDoc.createElement('span');
    pyTitle.className = 'mat-panel-title';
    pyTitle.textContent = 'Python';
    pyHeader.appendChild(pyTitle);
    cbPython.appendChild(pyHeader);
    const pyPre = mockDoc.createElement('pre');
    pyPre.textContent = 'import torch\nprint("hello")';
    cbPython.appendChild(pyPre);
    mockDoc.body.appendChild(cbPython);

    // Run unified pipeline
    runAllFixes();

    // Verify 1: Code block unpacked and math/bold rendered
    assert.strictEqual(cb.getAttribute('data-ms-code-unpacked'), '1');
    assert.ok(cb.querySelector('.katex'), 'Math inside unpacked code block rendered by pipeline');
    assert.ok(cb.querySelector('strong'), 'Bold inside unpacked code block rendered by pipeline');

    // Verify 2: Tilde fixed
    assert.strictEqual(del.getAttribute('data-ms-unsub'), 'true');
    assert.strictEqual(p1.textContent, '消耗 5%~16% 额度，连问 3~5 次');

    // Verify 3: Legitimate strikethrough kept
    assert.strictEqual(legitDel.hasAttribute('data-ms-unsub'), false);

    // Verify 4: Real python block kept
    assert.strictEqual(cbPython.hasAttribute('data-ms-code-unpacked'), false);

    console.log('✔ Case 4.1 Passed: runAllFixes() full pipeline executed all steps in correct order with zero regressions');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 5: Edge Cases & Boundary Values ---');

// 5.1 Empty / Null / Corrupt inputs
{
    mockDoc.body.childNodes = [];
    const emptyCb = mockDoc.createElement('ms-code-block');
    mockDoc.body.appendChild(emptyCb);
    fixBrokenCodeBlocks();
    assert.strictEqual(emptyCb.hasAttribute('data-ms-code-unpacked'), false, 'Empty code block without pre handled gracefully');

    const emptyPreCb = mockDoc.createElement('ms-code-block');
    emptyPreCb.appendChild(mockDoc.createElement('pre'));
    mockDoc.body.appendChild(emptyPreCb);
    fixBrokenCodeBlocks();
    assert.strictEqual(emptyPreCb.hasAttribute('data-ms-code-unpacked'), false, 'Empty pre code block handled gracefully');

    const emptyDel = mockDoc.createElement('del');
    mockDoc.body.appendChild(emptyDel);
    fixBrokenTildeMarkdown();
    assert.strictEqual(emptyDel.hasAttribute('data-ms-unsub'), false, 'Empty del element handled gracefully');

    console.log('✔ Case 5.1 Passed: Empty, null, and corrupt DOM structures handled without throwing');
}

// 5.2 Display math $$...$$ and Headings h1..h6 in unpacked code blocks
{
    mockDoc.body.childNodes = [];
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent =
`# 标题1
## 标题2
### 标题3
#### 标题4
##### 标题5
###### 标题6

这里是正文段落，包含质能方程：
$$E = mc^2$$
以及欧拉公式 $e^{i\\pi} + 1 = 0$。`;
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    fixBrokenCodeBlocks();

    const unpackDiv = cb.querySelector('.ms-unpacked-code');
    assert.ok(unpackDiv, 'Unpack container created');
    for (let lvl = 1; lvl <= 6; lvl++) {
        const h = unpackDiv.querySelector('h' + lvl);
        assert.ok(h, `h${lvl} heading should be created`);
        assert.strictEqual(h.textContent, `标题${lvl}`);
    }

    const katexList = unpackDiv.querySelectorAll('.katex');
    assert.strictEqual(katexList.length, 2, 'Both display math $$...$$ and inline math $...$ rendered in unpacked block');

    console.log('✔ Case 5.2 Passed: Full h1-h6 headings and display math $$...$$ rendered accurately');
}

// 5.3 Complex strikethrough boundaries
{
    mockDoc.body.childNodes = [];

    // Currency range pair: ¥100~¥200 到 ¥300~¥400
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    p1.appendChild(mockDoc.createTextNode('价格大约 ¥100'));
    const del1 = mockDoc.createElement('del');
    del1.appendChild(mockDoc.createTextNode('¥200 到 ¥300'));
    p1.appendChild(del1);
    p1.appendChild(mockDoc.createTextNode('¥400'));
    mockDoc.body.appendChild(p1);

    // Number inside Chinese text without range boundary: <del>2023年已过期方案</del>
    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    p2.appendChild(mockDoc.createTextNode('注意：'));
    const del2 = mockDoc.createElement('del');
    del2.appendChild(mockDoc.createTextNode('2023年已过期方案'));
    p2.appendChild(del2);
    p2.appendChild(mockDoc.createTextNode('，请勿采纳。'));
    mockDoc.body.appendChild(p2);

    // Number at end of del, but next text is comma and text: <del>这是第 1 阶段</del>，这是第 2 阶段
    const p3 = mockDoc.createElement('p');
    p3.className = 'markdown-content';
    const del3 = mockDoc.createElement('del');
    del3.appendChild(mockDoc.createTextNode('这是第 1 阶段'));
    p3.appendChild(del3);
    p3.appendChild(mockDoc.createTextNode('，这是第 2 阶段'));
    mockDoc.body.appendChild(p3);

    // Real strikethrough followed by price: <del>原价 500元</del>200元起
    const p4 = mockDoc.createElement('p');
    p4.className = 'markdown-content';
    const del4 = mockDoc.createElement('del');
    del4.appendChild(mockDoc.createTextNode('原价 500元'));
    p4.appendChild(del4);
    p4.appendChild(mockDoc.createTextNode('200元起'));
    mockDoc.body.appendChild(p4);

    fixBrokenTildeMarkdown();

    assert.strictEqual(del1.getAttribute('data-ms-unsub'), 'true', 'Currency range pair ¥100~¥200 到 ¥300~¥400 recognized');
    assert.strictEqual(p1.textContent, '价格大约 ¥100~¥200 到 ¥300~¥400');

    assert.strictEqual(del2.hasAttribute('data-ms-unsub'), false, '<del>2023年已过期方案</del> must NOT be touched');
    assert.strictEqual(del3.hasAttribute('data-ms-unsub'), false, '<del>这是第 1 阶段</del> must NOT be touched');
    assert.strictEqual(del4.hasAttribute('data-ms-unsub'), false, '<del>原价 500元</del>200元起 must NOT be touched');

    console.log('✔ Case 5.3 Passed: Currency range handled and complex sentences with numbers protected');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 6: fixBrokenBiochemicalStarBold Tests (Figure 3) ---');

// 6.1 The A\beta*56 Biochemical Scenario (Figure 3 exact match)
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';

    // DOM: "一种名为 *" + <em>A<ms-katex>\beta</ms-katex></em> + <em>56</em> + " 的特定淀粉样蛋白寡聚体。"
    const tLead = mockDoc.createTextNode('一种名为 *');
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('A'));
    const katexBeta = mockDoc.createElement('ms-katex');
    katexBeta.appendChild(mockDoc.createTextNode('\\beta'));
    em1.appendChild(katexBeta);

    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('56'));

    const tTrail = mockDoc.createTextNode(' 的特定淀粉样蛋白寡聚体。');

    p.appendChild(tLead);
    p.appendChild(em1);
    p.appendChild(em2);
    p.appendChild(tTrail);
    mockDoc.body.appendChild(p);

    fixBrokenBiochemicalStarBold();

    // Verification
    assert.strictEqual(tLead.nodeValue, '一种名为 ', 'Preceding text must have bare asterisk removed');
    const strong = p.querySelector('strong');
    assert.ok(strong, 'Strong element must be created');
    assert.strictEqual(strong.getAttribute('data-fixed-bold'), 'true');
    assert.strictEqual(strong.getAttribute('data-ms-biochem-bold'), '1');
    assert.strictEqual(strong.textContent, 'A\\beta*56', 'Strong must wrap protein name, literal star, and subtype 56');
    assert.ok(strong.querySelector('ms-katex'), 'KaTeX formula node must be preserved intact inside strong');
    assert.strictEqual(p.querySelectorAll('em').length, 0, 'Both broken em tags must be eliminated');
    assert.strictEqual(
        p.textContent,
        '一种名为 A\\beta*56 的特定淀粉样蛋白寡聚体。',
        'Text content must be fully clean with zero bare asterisks'
    );
    console.log('✔ Case 6.1 Passed: A\\beta*56 biochemical star bold repaired, literal star restored, bare asterisk eliminated');
}

// 6.2 CYP2D*6 Allele & Subtypes with letters
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';

    // DOM: "检测到 *" + <em>CYP2D</em> + <em>6</em> + " 与 *" + <em>A</em> + <em>1a</em> + " 变体。"
    const t1 = mockDoc.createTextNode('检测到 *');
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('CYP2D'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('6'));

    const t2 = mockDoc.createTextNode(' 与 *');
    const em3 = mockDoc.createElement('em');
    em3.appendChild(mockDoc.createTextNode('A'));
    const em4 = mockDoc.createElement('em');
    em4.appendChild(mockDoc.createTextNode('1a'));

    const t3 = mockDoc.createTextNode(' 变体。');

    p.appendChild(t1);
    p.appendChild(em1);
    p.appendChild(em2);
    p.appendChild(t2);
    p.appendChild(em3);
    p.appendChild(em4);
    p.appendChild(t3);
    mockDoc.body.appendChild(p);

    fixBrokenBiochemicalStarBold();

    const strongs = p.querySelectorAll('strong');
    assert.strictEqual(strongs.length, 2, 'Both CYP2D*6 and A*1a must be reconstructed to strong');
    assert.strictEqual(strongs[0].textContent, 'CYP2D*6');
    assert.strictEqual(strongs[1].textContent, 'A*1a');
    assert.strictEqual(p.textContent, '检测到 CYP2D*6 与 A*1a 变体。');
    console.log('✔ Case 6.2 Passed: CYP2D*6 and A*1a alphanumeric subtypes successfully reconstructed');
}

// 6.3 Anti-False-Positive Guards: Regular italics and non-biochemical text protected
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';

    // 1. Two separate italics with space: *chapter* *1*
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('chapter'));
    const spaceText = mockDoc.createTextNode(' ');
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('1'));

    // 2. Regular italic sentence: *this is italic*
    const tNorm = mockDoc.createTextNode(' 以及 ');
    const em3 = mockDoc.createElement('em');
    em3.appendChild(mockDoc.createTextNode('普通斜体文字'));

    p.appendChild(em1);
    p.appendChild(spaceText);
    p.appendChild(em2);
    p.appendChild(tNorm);
    p.appendChild(em3);
    mockDoc.body.appendChild(p);

    fixBrokenBiochemicalStarBold();

    assert.strictEqual(p.querySelectorAll('strong').length, 0, 'No strong should be created for normal italics');
    assert.strictEqual(p.querySelectorAll('em').length, 3, 'All 3 legitimate em tags must remain intact');
    console.log('✔ Case 6.3 Passed: Legitimate italics strictly protected against false positives');
}

// 6.4 Escaped Asterisk Protection: \* must NEVER be treated as a markdown delimiter
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    const t1 = mockDoc.createTextNode('特定生化位点 \\*');
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('CYP2D'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('6'));
    p.appendChild(t1);
    p.appendChild(em1);
    p.appendChild(em2);
    mockDoc.body.appendChild(p);

    fixBrokenBiochemicalStarBold();

    assert.strictEqual(p.querySelector('strong'), null, 'Escaped asterisk \\* must NOT trigger strong creation');
    assert.strictEqual(p.querySelectorAll('em').length, 2, 'Both legitimate em tags must remain untouched');
    assert.strictEqual(p.textContent, '特定生化位点 \\*CYP2D6');
    console.log('✔ Case 6.4 Passed: Escaped asterisk \\* strictly protected against false bold creation');
}

// 6.5 Trailing Leaked Single Asterisk Cleanup
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    const t1 = mockDoc.createTextNode('检测到 *');
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('CYP2D6'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('10A'));
    const t2 = mockDoc.createTextNode('* 等位基因说明。');
    p.appendChild(t1);
    p.appendChild(em1);
    p.appendChild(em2);
    p.appendChild(t2);
    mockDoc.body.appendChild(p);

    fixBrokenBiochemicalStarBold();

    const strong = p.querySelector('strong');
    assert.ok(strong, 'Strong element must be created');
    assert.strictEqual(strong.textContent, 'CYP2D6*10A');
    assert.strictEqual(p.textContent, '检测到 CYP2D6*10A 等位基因说明。');
    assert.ok(!p.textContent.includes('* 等位基因'), 'Trailing bare asterisk must be cleanly removed');
    console.log('✔ Case 6.5 Passed: Leaked trailing single asterisk cleanly eliminated');
}


// ----------------------------------------------------
console.log('\n--- Test Suite 7: fixBrokenCjkPunctuationBold Tests (Figure 1) ---');

// 7.1 The Elite Hacker Quote Scenario (Figure 1 exact match)
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'markdown-content';

    // DOM created by CommonMark:
    // TextNode: '*“恭喜你找到了这个严重漏洞，你就是我们认可的**31337（顶级精英）*'
    // Element: <em>黑客。”</em>
    const tLead = mockDoc.createTextNode('*“恭喜你找到了这个严重漏洞，你就是我们认可的**31337（顶级精英）*');
    const em = mockDoc.createElement('em');
    em.appendChild(mockDoc.createTextNode('黑客。”'));

    bq.appendChild(tLead);
    bq.appendChild(em);
    mockDoc.body.appendChild(bq);

    fixBrokenCjkPunctuationBold();

    // Verification
    const strong = bq.querySelector('strong');
    assert.ok(strong, 'Strong element must be created for bold text');
    assert.strictEqual(strong.getAttribute('data-fixed-bold'), 'true');
    assert.strictEqual(strong.textContent, '31337（顶级精英）', 'Bold text content must be 31337（顶级精英）');

    const outerEm = bq.querySelector('em');
    assert.ok(outerEm, 'Outer em must wrap the quote');
    assert.strictEqual(outerEm.getAttribute('data-fixed-italic'), 'true');
    assert.ok(outerEm.contains(strong), 'Strong must be inside outer em quote');

    assert.strictEqual(
        bq.textContent,
        '“恭喜你找到了这个严重漏洞，你就是我们认可的31337（顶级精英）黑客。”',
        'Text content must have all bare asterisks eliminated'
    );
    assert.ok(!bq.textContent.includes('*'), 'No asterisk should remain in text content');
    console.log('✔ Case 7.1 Passed: Elite hacker quote repaired, 31337（顶级精英） bolded, outer italic quote restored');
}

// 7.2 Diverse CJK closing punctuation marks (”, 】, 》)
{
    mockDoc.body.childNodes = [];
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    p1.appendChild(mockDoc.createTextNode('*“这是我们推选的**“核心人物”*'));
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('代表。”'));
    p1.appendChild(em1);

    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    p2.appendChild(mockDoc.createTextNode('*“查看**【方案五】*'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('说明。”'));
    p2.appendChild(em2);

    const p3 = mockDoc.createElement('p');
    p3.className = 'markdown-content';
    p3.appendChild(mockDoc.createTextNode('*“研读**《量子力学秘籍》*'));
    const em3 = mockDoc.createElement('em');
    em3.appendChild(mockDoc.createTextNode('教程。”'));
    p3.appendChild(em3);

    mockDoc.body.appendChild(p1);
    mockDoc.body.appendChild(p2);
    mockDoc.body.appendChild(p3);

    fixBrokenCjkPunctuationBold();

    assert.strictEqual(p1.querySelector('strong').textContent, '“核心人物”');
    assert.strictEqual(p1.textContent, '“这是我们推选的“核心人物”代表。”');

    assert.strictEqual(p2.querySelector('strong').textContent, '【方案五】');
    assert.strictEqual(p2.textContent, '“查看【方案五】说明。”');

    assert.strictEqual(p3.querySelector('strong').textContent, '《量子力学秘籍》');
    assert.strictEqual(p3.textContent, '“研读《量子力学秘籍》教程。”');

    console.log('✔ Case 7.2 Passed: Diverse CJK closing punctuation (”, 】, 》) correctly handled');
}

// 7.3 Without outer italic (standalone CJK bold with stolen em)
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    p.appendChild(mockDoc.createTextNode('你就是我们认可的**31337（顶级精英）*'));
    const em = mockDoc.createElement('em');
    em.appendChild(mockDoc.createTextNode('黑客。'));
    p.appendChild(em);
    mockDoc.body.appendChild(p);

    fixBrokenCjkPunctuationBold();

    const strong = p.querySelector('strong');
    assert.ok(strong);
    assert.strictEqual(strong.textContent, '31337（顶级精英）');
    assert.strictEqual(p.querySelectorAll('em').length, 0, 'em unwrapped to plain text');
    assert.strictEqual(p.textContent, '你就是我们认可的31337（顶级精英）黑客。');
    console.log('✔ Case 7.3 Passed: Standalone CJK bold without outer italic unwrapped cleanly');
}

// 7.4 Cross-node bold containing KaTeX formula
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    p.appendChild(mockDoc.createTextNode('*“确认了**A'));
    const katexNode = mockDoc.createElement('ms-katex');
    katexNode.appendChild(mockDoc.createTextNode('\\beta'));
    p.appendChild(katexNode);
    p.appendChild(mockDoc.createTextNode('（亚型）*'));
    const em = mockDoc.createElement('em');
    em.appendChild(mockDoc.createTextNode('蛋白。”'));
    p.appendChild(em);
    mockDoc.body.appendChild(p);

    fixBrokenCjkPunctuationBold();

    const strong = p.querySelector('strong');
    assert.ok(strong);
    assert.strictEqual(strong.textContent, 'A\\beta（亚型）');
    assert.ok(strong.contains(katexNode), 'KaTeX formula preserved inside strong');
    assert.strictEqual(p.textContent, '“确认了A\\beta（亚型）蛋白。”');
    console.log('✔ Case 7.4 Passed: Cross-node bold containing KaTeX formula successfully structured');
}

// 7.5 Anti-False-Positive Guards: Normal italics and normal bold protected
{
    mockDoc.body.childNodes = [];
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('“这是合法的引用斜体。”'));
    p1.appendChild(em1);

    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    p2.appendChild(mockDoc.createTextNode('这是正常文本 *italic* 以及 **bold**。'));

    mockDoc.body.appendChild(p1);
    mockDoc.body.appendChild(p2);

    fixBrokenCjkPunctuationBold();

    assert.strictEqual(p1.querySelector('strong'), null, 'No strong created in legitimate italic quote');
    assert.strictEqual(p1.querySelector('em').textContent, '“这是合法的引用斜体。”', 'Legitimate italic untouched');
    assert.strictEqual(p2.textContent, '这是正常文本 *italic* 以及 **bold**。', 'Normal text untouched');
    console.log('✔ Case 7.5 Passed: Legitimate italics and normal formatting strictly protected');
}

// 7.6 Cross-Node Italic Quote with Preceding Inline Formula
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'markdown-content';
    const t1 = mockDoc.createTextNode('*“恭喜你，参数为 ');
    const k = mockDoc.createElement('ms-katex');
    k.appendChild(mockDoc.createTextNode('\\alpha'));
    const t2 = mockDoc.createTextNode(' ，你就是我们认可的**31337（顶级精英）*');
    const em = mockDoc.createElement('em');
    em.appendChild(mockDoc.createTextNode('黑客。”'));
    bq.appendChild(t1);
    bq.appendChild(k);
    bq.appendChild(t2);
    bq.appendChild(em);
    mockDoc.body.appendChild(bq);

    fixBrokenCjkPunctuationBold();

    const outerEm = bq.querySelector('em[data-fixed-italic="true"]');
    assert.ok(outerEm, 'Outer em must wrap entire quote across preceding formula');
    const strong = outerEm.querySelector('strong');
    assert.ok(strong, 'Strong element must exist inside outer em');
    assert.strictEqual(strong.textContent, '31337（顶级精英）');
    assert.ok(outerEm.contains(k), 'Formula must be contained inside outer em');
    assert.strictEqual(bq.textContent, '“恭喜你，参数为 \\alpha ，你就是我们认可的31337（顶级精英）黑客。”');
    assert.ok(!bq.textContent.includes('*'), 'No exposed bare asterisks in quote');
    console.log('✔ Case 7.6 Passed: Cross-node quote with preceding formula cleanly structured');
}

// 7.7 Diverse Closing Punctuation Marks (！, ？, 。, —)
{
    mockDoc.body.childNodes = [];
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    p1.appendChild(mockDoc.createTextNode('*“获得了**顶级荣誉（一等奖）！*'));
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('黑客。”'));
    p1.appendChild(em1);

    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    p2.appendChild(mockDoc.createTextNode('*“这是**难道可能吗？*'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('回答。”'));
    p2.appendChild(em2);

    const p3 = mockDoc.createElement('p');
    p3.className = 'markdown-content';
    p3.appendChild(mockDoc.createTextNode('*“执行**方案完成。*'));
    const em3 = mockDoc.createElement('em');
    em3.appendChild(mockDoc.createTextNode('继续。”'));
    p3.appendChild(em3);

    mockDoc.body.appendChild(p1);
    mockDoc.body.appendChild(p2);
    mockDoc.body.appendChild(p3);

    fixBrokenCjkPunctuationBold();

    assert.strictEqual(p1.querySelector('strong').textContent, '顶级荣誉（一等奖）！');
    assert.strictEqual(p1.textContent, '“获得了顶级荣誉（一等奖）！黑客。”');

    assert.strictEqual(p2.querySelector('strong').textContent, '难道可能吗？');
    assert.strictEqual(p2.textContent, '“这是难道可能吗？回答。”');

    assert.strictEqual(p3.querySelector('strong').textContent, '方案完成。');
    assert.strictEqual(p3.textContent, '“执行方案完成。继续。”');

    console.log('✔ Case 7.7 Passed: Diverse punctuation (！, ？, 。) handled successfully');
}

// 7.8 Stolen em Containing KaTeX Formula or Leading Dashes
{
    mockDoc.body.childNodes = [];
    const bq1 = mockDoc.createElement('blockquote');
    bq1.className = 'markdown-content';
    bq1.appendChild(mockDoc.createTextNode('*“确认是**31337（顶级）*'));
    const em1 = mockDoc.createElement('em');
    const k = mockDoc.createElement('ms-katex');
    k.appendChild(mockDoc.createTextNode('\\beta'));
    em1.appendChild(k);
    em1.appendChild(mockDoc.createTextNode(' 蛋白。”'));
    bq1.appendChild(em1);

    const bq2 = mockDoc.createElement('blockquote');
    bq2.className = 'markdown-content';
    bq2.appendChild(mockDoc.createTextNode('*“这是**核心（精英）*'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('——确实如此。”'));
    bq2.appendChild(em2);

    mockDoc.body.appendChild(bq1);
    mockDoc.body.appendChild(bq2);

    fixBrokenCjkPunctuationBold();

    assert.strictEqual(bq1.querySelector('strong').textContent, '31337（顶级）');
    assert.strictEqual(bq1.textContent, '“确认是31337（顶级）\\beta 蛋白。”');

    assert.strictEqual(bq2.querySelector('strong').textContent, '核心（精英）');
    assert.strictEqual(bq2.textContent, '“这是核心（精英）——确实如此。”');

    console.log('✔ Case 7.8 Passed: Stolen em containing KaTeX formula or leading dashes resolved cleanly');
}

// 7.9 User Uploaded Screenshot Exact Match (media_1793508097246_5eca4ed9.png)
// Features: Half-width parens ( ), space before asterisk, ASCII quote at start, full-width quote at end, in blockquote p
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'callout';
    const p = mockDoc.createElement('p');

    // DOM created when model generates:
    // > *"恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) **黑客。"*
    // Leading TextNode ending with half-width paren + space + asterisk:
    const tLead = mockDoc.createTextNode('*"恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) *');
    const em = mockDoc.createElement('em');
    em.appendChild(mockDoc.createTextNode('黑客。”'));

    p.appendChild(tLead);
    p.appendChild(em);
    bq.appendChild(p);
    mockDoc.body.appendChild(bq);

    runAllFixes();

    const strong = bq.querySelector('strong');
    assert.ok(strong, 'Strong element must be created for bold text in blockquote');
    assert.strictEqual(strong.getAttribute('data-fixed-bold'), 'true');
    assert.strictEqual(strong.textContent, '31337 (顶级精英)', 'Bold text must match half-width parens without extra space');

    const outerEm = bq.querySelector('em[data-fixed-italic="true"]');
    assert.ok(outerEm, 'Outer em must wrap the entire quote');
    assert.ok(outerEm.contains(strong), 'Strong must be inside outer em quote');

    assert.strictEqual(
        bq.textContent,
        '"恭喜你找到了这个严重漏洞，你就是我们认可的31337 (顶级精英)黑客。”',
        'Text content must have all bare asterisks eliminated'
    );
    assert.ok(!bq.textContent.includes('*'), 'No asterisk should remain in text content');
    console.log('✔ Case 7.9 Passed: Screenshot pixel-perfect case (half-width parens + space before star) repaired in blockquote');
}

// 7.10 Situation B: Unparsed pure text quote block (when parser created NO <em> element)
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'callout';
    const p = mockDoc.createElement('p');

    // Raw unparsed text when model omits trailing closing star
    const tRaw = mockDoc.createTextNode('*"恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) *黑客。”');
    p.appendChild(tRaw);
    bq.appendChild(p);
    mockDoc.body.appendChild(bq);

    runAllFixes();

    const strong = bq.querySelector('strong');
    assert.ok(strong, 'Strong element must be created from raw quote text in blockquote');
    assert.strictEqual(strong.getAttribute('data-fixed-bold'), 'true');
    assert.strictEqual(strong.textContent, '31337 (顶级精英)');

    const outerEm = bq.querySelector('em[data-fixed-italic="true"]');
    assert.ok(outerEm, 'Outer em must be synthesized for the quote');
    assert.ok(outerEm.contains(strong), 'Strong must be inside synthesized em');
    assert.ok(!bq.textContent.includes('*'), 'No bare asterisks in synthesized blockquote');
    console.log('✔ Case 7.10 Passed: Situation B (pure text blockquote without em) seamlessly synthesized');
}

// 7.11 Space and Asterisk Variations
{
    mockDoc.body.childNodes = [];

    // Variation A: Space after asterisk `)* `
    const pA = mockDoc.createElement('p');
    pA.className = 'markdown-content';
    pA.appendChild(mockDoc.createTextNode('*"系统核准**31337 (顶级精英)* '));
    const emA = mockDoc.createElement('em');
    emA.appendChild(mockDoc.createTextNode('黑客。"'));
    pA.appendChild(emA);

    // Variation B: Space before and after asterisk `) * `
    const pB = mockDoc.createElement('p');
    pB.className = 'markdown-content';
    pB.appendChild(mockDoc.createTextNode('*"系统核准**31337 (顶级精英) * '));
    const emB = mockDoc.createElement('em');
    emB.appendChild(mockDoc.createTextNode('黑客。"'));
    pB.appendChild(emB);

    // Variation C: Double asterisk with space `) **`
    const pC = mockDoc.createElement('p');
    pC.className = 'markdown-content';
    pC.appendChild(mockDoc.createTextNode('*"系统核准**31337 (顶级精英) **'));
    const emC = mockDoc.createElement('em');
    emC.appendChild(mockDoc.createTextNode('黑客。"'));
    pC.appendChild(emC);

    mockDoc.body.appendChild(pA);
    mockDoc.body.appendChild(pB);
    mockDoc.body.appendChild(pC);

    runAllFixes();

    [pA, pB, pC].forEach((p, idx) => {
        const strong = p.querySelector('strong');
        assert.ok(strong, `Strong must exist for variation ${idx}`);
        assert.strictEqual(strong.textContent, '31337 (顶级精英)');
        assert.ok(!p.textContent.includes('*'), `No bare asterisk in variation ${idx}`);
    });
    console.log('✔ Case 7.11 Passed: All whitespace and asterisk variations ()* , ) * , ) **) resolved cleanly');
}

// 7.12 Container Hierarchy & Scope Coverage (blockquote, .callout, ms-cmark-node)
{
    mockDoc.body.childNodes = [];

    // 1. Direct blockquote (compact, no <p>)
    const bqCompact = mockDoc.createElement('blockquote');
    bqCompact.appendChild(mockDoc.createTextNode('*"恭喜你，认证为**31337 (顶级精英) *'));
    const em1 = mockDoc.createElement('em');
    em1.appendChild(mockDoc.createTextNode('黑客。"'));
    bqCompact.appendChild(em1);

    // 2. ms-cmark-node blockquote p
    const msCmark = mockDoc.createElement('ms-cmark-node');
    const bqInner = mockDoc.createElement('blockquote');
    const pInner = mockDoc.createElement('p');
    pInner.appendChild(mockDoc.createTextNode('*"恭喜你，认证为**31337 (顶级精英) *'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('黑客。"'));
    pInner.appendChild(em2);
    bqInner.appendChild(pInner);
    msCmark.appendChild(bqInner);

    // 3. .callout container
    const callout = mockDoc.createElement('div');
    callout.className = 'callout';
    callout.appendChild(mockDoc.createTextNode('*"恭喜你，认证为**31337 (顶级精英) *'));
    const em3 = mockDoc.createElement('em');
    em3.appendChild(mockDoc.createTextNode('黑客。"'));
    callout.appendChild(em3);

    mockDoc.body.appendChild(bqCompact);
    mockDoc.body.appendChild(msCmark);
    mockDoc.body.appendChild(callout);

    runAllFixes();

    [bqCompact, bqInner, callout].forEach((c, idx) => {
        const strong = c.querySelector('strong');
        assert.ok(strong, `Strong must exist in container hierarchy ${idx}`);
        assert.strictEqual(strong.textContent, '31337 (顶级精英)');
        assert.ok(!c.textContent.includes('*'), `No bare asterisks in container hierarchy ${idx}`);
    });
    console.log('✔ Case 7.12 Passed: Diverse blockquote/callout container hierarchies 100% covered');
}

// 7.13 Real Google AI Studio Angular Ivy Hierarchy with <ms-cmark-node> and <span class="ng-star-inserted"> wrapping
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'ng-star-inserted';
    const msCmark1 = mockDoc.createElement('ms-cmark-node');
    const p = mockDoc.createElement('p');
    p.className = 'ng-star-inserted';
    const msCmark2 = mockDoc.createElement('ms-cmark-node');

    const spanLead = mockDoc.createElement('span');
    spanLead.className = 'ng-star-inserted';
    spanLead.appendChild(mockDoc.createTextNode('*"恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) *'));

    const em = mockDoc.createElement('em');
    em.className = 'ng-star-inserted';
    const msCmark3 = mockDoc.createElement('ms-cmark-node');
    const spanEm = mockDoc.createElement('span');
    spanEm.className = 'ng-star-inserted';
    spanEm.appendChild(mockDoc.createTextNode('黑客。”'));
    msCmark3.appendChild(spanEm);
    em.appendChild(msCmark3);

    msCmark2.appendChild(spanLead);
    msCmark2.appendChild(em);
    p.appendChild(msCmark2);
    msCmark1.appendChild(p);
    bq.appendChild(msCmark1);
    mockDoc.body.appendChild(bq);

    runAllFixes();

    const strong = bq.querySelector('strong');
    assert.ok(strong, 'Strong element must be created in Angular Ivy DOM hierarchy with span wrapping');
    assert.strictEqual(strong.getAttribute('data-fixed-bold'), 'true');
    assert.strictEqual(strong.textContent, '31337 (顶级精英)');
    const outerEm = bq.querySelector('em[data-fixed-italic="true"]');
    assert.ok(outerEm, 'Outer em must wrap quote in Angular Ivy hierarchy');
    assert.ok(!bq.textContent.includes('*'), 'No asterisk should remain in Angular Ivy hierarchy');
    console.log('✔ Case 7.13 Passed: Real Angular Ivy DOM hierarchy with span and ms-cmark-node nesting 100% repaired');
}

// 7.14 Real Google AI Studio Angular Ivy Hierarchy for Pure Text Blockquote (no em generated)
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'ng-star-inserted';
    const msCmark1 = mockDoc.createElement('ms-cmark-node');
    const p = mockDoc.createElement('p');
    p.className = 'ng-star-inserted';
    const msCmark2 = mockDoc.createElement('ms-cmark-node');

    const spanLead = mockDoc.createElement('span');
    spanLead.className = 'ng-star-inserted';
    spanLead.appendChild(mockDoc.createTextNode('*"恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) *黑客。”'));

    msCmark2.appendChild(spanLead);
    p.appendChild(msCmark2);
    msCmark1.appendChild(p);
    bq.appendChild(msCmark1);
    mockDoc.body.appendChild(bq);

    runAllFixes();

    const strong = bq.querySelector('strong');
    assert.ok(strong, 'Strong element must be created in pure-text Angular Ivy DOM');
    assert.strictEqual(strong.getAttribute('data-fixed-bold'), 'true');
    assert.strictEqual(strong.textContent, '31337 (顶级精英)');
    const outerEm = bq.querySelector('em[data-fixed-italic="true"]');
    assert.ok(outerEm, 'Outer em must wrap quote in pure-text Angular Ivy DOM');
    assert.ok(!bq.textContent.includes('*'), 'No asterisk should remain in pure-text Angular Ivy DOM');
    console.log('✔ Case 7.14 Passed: Real Angular Ivy DOM hierarchy for pure-text blockquote 100% repaired');
}

// 7.15 Screenshot Exact Whitespace Variant: Half-width space before closing quote `黑客。 ”`
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'ng-star-inserted';
    const p = mockDoc.createElement('p');
    const spanLead = mockDoc.createElement('span');
    spanLead.appendChild(mockDoc.createTextNode('*“恭喜你找到了这个严重漏洞，你就是我们认可的**31337 (顶级精英) *'));
    const em = mockDoc.createElement('em');
    em.appendChild(mockDoc.createTextNode('黑客。 ”'));
    p.appendChild(spanLead);
    p.appendChild(em);
    bq.appendChild(p);
    mockDoc.body.appendChild(bq);

    runAllFixes();

    const strong = bq.querySelector('strong');
    assert.ok(strong, 'Strong must exist');
    assert.strictEqual(strong.textContent, '31337 (顶级精英)');
    assert.ok(!bq.textContent.includes('*'), 'No asterisk should remain');
    console.log('✔ Case 7.15 Passed: Space before closing quote `黑客。 ”` in Angular DOM resolved');
}

// 7.16 Biochemical Star Bold with Angular Span Wrapping
{
    mockDoc.body.childNodes = [];
    const pBio = mockDoc.createElement('p');
    const spanBio1 = mockDoc.createElement('span');
    spanBio1.appendChild(mockDoc.createTextNode('一种名为 *'));
    const emBio1 = mockDoc.createElement('em');
    emBio1.appendChild(mockDoc.createTextNode('CYP2D'));
    const emBio2 = mockDoc.createElement('em');
    emBio2.appendChild(mockDoc.createTextNode('6'));
    const spanBio2 = mockDoc.createElement('span');
    spanBio2.appendChild(mockDoc.createTextNode('* 酶变体。'));

    pBio.appendChild(spanBio1);
    pBio.appendChild(emBio1);
    pBio.appendChild(emBio2);
    pBio.appendChild(spanBio2);
    mockDoc.body.appendChild(pBio);

    runAllFixes();

    const strong = pBio.querySelector('strong');
    assert.ok(strong, 'Strong element must be created for biochemical star bold in span wrapping');
    assert.strictEqual(strong.textContent, 'CYP2D*6');
    assert.ok(!pBio.textContent.includes('**'), 'No bare double asterisks');
    console.log('✔ Case 7.16 Passed: Biochemical star bold with Angular span wrapping verified');
}
console.log('\n--- Test Suite 8: Figure 2 Requirements & Full Pipeline Integration ---');

// 8.1 Figure 2 Requirement: Citations without URL must remain pure text
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';
    p.appendChild(mockDoc.createTextNode('相关结论参考了文献 [3, 4] 以及 [1, 2]，详见后续讨论。'));
    mockDoc.body.appendChild(p);

    runAllFixes();

    assert.strictEqual(p.querySelectorAll('a').length, 0, 'No anchor/link tags should be created for [3, 4]');
    assert.strictEqual(p.textContent, '相关结论参考了文献 [3, 4] 以及 [1, 2]，详见后续讨论。', 'Citations must remain pure text');
    console.log('✔ Case 8.1 Passed: Plain text citations [3, 4] strictly preserved per CommonMark semantics');
}

// 8.2 End-to-End Full Pipeline with all scenarios coexist simultaneously
{
    mockDoc.body.childNodes = [];

    // 1. Swallowed code block (v1.2.0)
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent = '  **直接把这几十兆的状态存成一个文件。**\n### 总结\n公式为 $h_t$。';
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    // 2. Argon quota tilde (v1.2.0)
    const pTilde = mockDoc.createElement('p');
    pTilde.className = 'markdown-content';
    pTilde.appendChild(mockDoc.createTextNode('消耗 5%'));
    const del = mockDoc.createElement('del');
    del.appendChild(mockDoc.createTextNode('16% 额度，连问 '));
    const st3 = mockDoc.createElement('strong');
    st3.appendChild(mockDoc.createTextNode('3'));
    del.appendChild(st3);
    pTilde.appendChild(del);
    const st5 = mockDoc.createElement('strong');
    st5.appendChild(mockDoc.createTextNode('5 次'));
    pTilde.appendChild(st5);
    mockDoc.body.appendChild(pTilde);

    // 3. Figure 3 Biochemical star bold: 一种名为 **A$\beta$*56** 的特定淀粉样蛋白寡聚体。
    const pBio = mockDoc.createElement('p');
    pBio.className = 'markdown-content';
    pBio.appendChild(mockDoc.createTextNode('一种名为 *'));
    const emBio1 = mockDoc.createElement('em');
    emBio1.appendChild(mockDoc.createTextNode('A'));
    const katexBio = mockDoc.createElement('ms-katex');
    katexBio.appendChild(mockDoc.createTextNode('\\beta'));
    emBio1.appendChild(katexBio);
    const emBio2 = mockDoc.createElement('em');
    emBio2.appendChild(mockDoc.createTextNode('56'));
    pBio.appendChild(emBio1);
    pBio.appendChild(emBio2);
    pBio.appendChild(mockDoc.createTextNode(' 的特定淀粉样蛋白寡聚体。'));
    mockDoc.body.appendChild(pBio);

    // 4. Figure 1 CJK Italic Stealing: > *“恭喜你找到了这个严重漏洞，你就是我们认可的**31337（顶级精英）**黑客。”*
    const bq = mockDoc.createElement('blockquote');
    bq.className = 'markdown-content';
    bq.appendChild(mockDoc.createTextNode('*“恭喜你找到了这个严重漏洞，你就是我们认可的**31337（顶级精英）*'));
    const emCjk = mockDoc.createElement('em');
    emCjk.appendChild(mockDoc.createTextNode('黑客。”'));
    bq.appendChild(emCjk);
    mockDoc.body.appendChild(bq);

    // 5. Figure 2 Plain text citations: 参考 [3, 4]
    const pCite = mockDoc.createElement('p');
    pCite.className = 'markdown-content';
    pCite.appendChild(mockDoc.createTextNode('请参考 [3, 4] 文献。'));
    mockDoc.body.appendChild(pCite);

    // Run unified pipeline
    runAllFixes();

    // Verify 1: Code block unpacked
    assert.strictEqual(cb.getAttribute('data-ms-code-unpacked'), '1');
    assert.ok(cb.querySelector('.katex'));

    // Verify 2: Tilde fixed
    assert.strictEqual(pTilde.textContent, '消耗 5%~16% 额度，连问 3~5 次');

    // Verify 3: Biochemical star bold
    assert.strictEqual(pBio.textContent, '一种名为 A\\beta*56 的特定淀粉样蛋白寡聚体。');
    const bioStrong = pBio.querySelector('strong');
    assert.ok(bioStrong);
    assert.strictEqual(bioStrong.textContent, 'A\\beta*56');

    // Verify 4: CJK Italic Stealing
    assert.strictEqual(bq.textContent, '“恭喜你找到了这个严重漏洞，你就是我们认可的31337（顶级精英）黑客。”');
    const cjkStrong = bq.querySelector('strong');
    assert.ok(cjkStrong);
    assert.strictEqual(cjkStrong.textContent, '31337（顶级精英）');

    // Verify 5: Citations kept as plain text
    assert.strictEqual(pCite.textContent, '请参考 [3, 4] 文献。');
    assert.strictEqual(pCite.querySelectorAll('a').length, 0);

    console.log('✔ Case 8.2 Passed: Full unified pipeline executed with 100% precision across all features simultaneously');
}

// 8.3 Combined Multi-Feature Test in a single paragraph
{
    mockDoc.body.childNodes = [];
    const p = mockDoc.createElement('p');
    p.className = 'markdown-content';

    // 1. Regular bold at beginning: **研究发现**
    const stNorm = mockDoc.createElement('strong');
    stNorm.appendChild(mockDoc.createTextNode('研究发现'));
    p.appendChild(stNorm);
    p.appendChild(mockDoc.createTextNode('：'));

    // 2. Figure 3 Biochemical star bold: **A$\beta$*56**
    p.appendChild(mockDoc.createTextNode('一种名为 *'));
    const emBio1 = mockDoc.createElement('em');
    emBio1.appendChild(mockDoc.createTextNode('A'));
    const kBio = mockDoc.createElement('ms-katex');
    kBio.appendChild(mockDoc.createTextNode('\\beta'));
    emBio1.appendChild(kBio);
    const emBio2 = mockDoc.createElement('em');
    emBio2.appendChild(mockDoc.createTextNode('56'));
    p.appendChild(emBio1);
    p.appendChild(emBio2);
    p.appendChild(mockDoc.createTextNode(' 寡聚体'));

    // 3. Figure 2 Plain text citation: [3, 4]
    p.appendChild(mockDoc.createTextNode('（详见 [3, 4]），'));

    // 4. Figure 1 CJK italic stealing: *“确认属于**顶级成果（一等奖）**项目。”*
    p.appendChild(mockDoc.createTextNode('*“确认属于**顶级成果（一等奖）*'));
    const emQuote = mockDoc.createElement('em');
    emQuote.appendChild(mockDoc.createTextNode('项目。”'));
    p.appendChild(emQuote);

    mockDoc.body.appendChild(p);

    runAllFixes();

    // Verify regular bold
    assert.ok(p.textContent.includes('研究发现：'));
    // Verify biochemical star bold
    assert.ok(p.textContent.includes('A\\beta*56 寡聚体'));
    const bioStrong = Array.from(p.querySelectorAll('strong')).find(s => s.getAttribute('data-ms-biochem-bold') === '1');
    assert.ok(bioStrong, 'Biochem strong exists');
    assert.strictEqual(bioStrong.textContent, 'A\\beta*56');

    // Verify citations
    assert.ok(p.textContent.includes('（详见 [3, 4]）'));
    assert.strictEqual(p.querySelectorAll('a').length, 0);

    // Verify CJK quote
    assert.ok(p.textContent.includes('“确认属于顶级成果（一等奖）项目。”'));
    const quoteEm = p.querySelector('em[data-fixed-italic="true"]');
    assert.ok(quoteEm, 'Outer em exists for quote');
    const cjkStrong = quoteEm.querySelector('strong');
    assert.ok(cjkStrong, 'Inner strong exists for CJK bold');
    assert.strictEqual(cjkStrong.textContent, '顶级成果（一等奖）');

    // Zero bare formatting asterisks (excluding the restored literal star in A\beta*56)
    const textWithoutBiochemStar = p.textContent.replace('A\\beta*56', '');
    assert.ok(!textWithoutBiochemStar.includes('*'), 'No exposed bare formatting asterisks in entire paragraph');

    console.log('✔ Case 8.3 Passed: All features coexisting in a single complex paragraph with zero conflicts');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 9: Anti-Retraction & Truncation Engine Tests ---');

// 9.1 AI Studio lJb Retraction Interception & Resurrect
{
    const entitiesMap = new Map();
    // Simulate active session
    entitiesMap.set('text-input-chunk-id', { tb: 'text', role: 'user', text: '请介绍一下量子力学基本原理' });

    const chunk1Id = 'chunk-model-thought-01';
    const chunk2Id = 'chunk-model-text-02';

    // Model streams thinking and substantive text
    entitiesMap.set(chunk1Id, {
        id: chunk1Id,
        tb: 'text',
        role: 'model',
        thought: true,
        text: '用户询问量子力学原理，需要从波函数、薛定谔方程、不确定性原理展开分析...',
        timestamp: Date.now() - 2000
    });

    entitiesMap.set(chunk2Id, {
        id: chunk2Id,
        tb: 'text',
        role: 'model',
        thought: false,
        text: '量子力学是描述微观物质运动规律的物理学分支。其核心原理包括态叠加原理与不确定性原理。态叠加原理表明系统在测量前可处于多个本征态的线性叠加：$$\\psi = \\sum c_n \\phi_n$$',
        timestamp: Date.now() - 1000
    });

    // Simulate AI Studio lJb: deletes all model chunks in current turn
    entitiesMap.delete(chunk1Id);
    entitiesMap.delete(chunk2Id);

    // AI Studio creates a new UUID chunk with empty text and blacklist finishReason: 3 (SAFETY)
    const newUUID = 'chunk-retracted-empty-99';
    const emptyRetractionChunk = {
        id: newUUID,
        tb: 'text',
        role: 'model',
        Ul: false,
        text: '',
        tokenCount: 0,
        Ub: 1,
        Dl: {
            finishReason: 3,
            finishMessage: 'Blocked due to safety threshold',
            safetyRatings: [{ category: 1, probability: 3 }]
        }
    };

    entitiesMap.set(newUUID, emptyRetractionChunk);

    // Assert: Anti-retraction engine must have intercepted and resurrected text
    assert.strictEqual(emptyRetractionChunk._msAntiRetractionRescued, true, 'Chunk should be marked as rescued');
    assert.ok(emptyRetractionChunk.text.includes('量子力学是描述微观物质运动规律的物理学分支'), 'Substantive text must be preserved');
    assert.ok(emptyRetractionChunk.text.includes('态叠加原理'), 'Formulas and core explanation preserved');
    assert.ok(emptyRetractionChunk.text.includes('💭 **[已救回的思考过程]**'), 'Thought markdown quote must be injected');
    assert.ok(emptyRetractionChunk.text.includes('🛡️ **[防撤回保护生效]**'), 'Protection notice must be appended');
    assert.strictEqual(emptyRetractionChunk.Dl.finishReason, 1, 'finishReason must be modified to normal STOP (1) to prevent Angular UI hiding');
    assert.strictEqual(emptyRetractionChunk._originalDl.finishReason, 3, 'Original finishReason must be archived in _originalDl');

    console.log('✔ Case 9.1 Passed: lJb retraction intercepted, text resurrected, thought preserved, and finishReason normalized');
}

// 9.2 Pure Thought Stage Retraction Resurrect
{
    const entitiesMap = new Map();
    const thoughtChunkId = 'chunk-early-thought-only';

    // Model streams thought, but triggers finishReason before any text is outputted
    entitiesMap.set(thoughtChunkId, {
        id: thoughtChunkId,
        tb: 'text',
        role: 'model',
        thought: true,
        text: '正在推演超导磁悬浮中的迈斯纳效应公式...',
        timestamp: Date.now() - 1000
    });

    entitiesMap.delete(thoughtChunkId);

    const newChunkId = 'chunk-thought-retracted-empty';
    const emptyChunk = {
        id: newChunkId,
        tb: 'text',
        role: 'model',
        Ul: false,
        text: '',
        tokenCount: 0,
        Ub: 1,
        Dl: { finishReason: 4, finishMessage: 'Recitation' }
    };

    entitiesMap.set(newChunkId, emptyChunk);

    assert.strictEqual(emptyChunk._msAntiRetractionRescued, true);
    assert.ok(emptyChunk.text.includes('正在推演超导磁悬浮中的迈斯纳效应公式'));
    assert.ok(emptyChunk.text.includes('模型在思考阶段被中断撤回，已完整保留思考内容'));

    console.log('✔ Case 9.2 Passed: Thought-only stage retraction rescued and displayed cleanly');
}

// 9.3 WIb Overwrite Blanking Guard
{
    const entitiesMap = new Map();
    const modelChunkId = 'chunk-long-standing-answer';

    const longAnswer = '这是 Gemini 生成的高维相对论时空几何方程推导：$$G_{\\mu\\nu} + \\Lambda g_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}$$';
    entitiesMap.set(modelChunkId, {
        id: modelChunkId,
        tb: 'text',
        role: 'model',
        text: longAnswer,
        timestamp: Date.now() - 3000
    });

    // Simulate WIb resetting text: "" during an unexpected stream reconnect
    const overwriteAttempt = {
        id: modelChunkId,
        tb: 'text',
        role: 'model',
        text: '',
        Di: []
    };

    entitiesMap.set(modelChunkId, overwriteAttempt);

    // Assert: overwrite should be rejected, preserving existing long text
    assert.strictEqual(overwriteAttempt.text, longAnswer, 'Text must not be wiped out by WIb reconnect reset');
    assert.strictEqual(overwriteAttempt._msAntiRetractionPreserved, true, 'Flagged as preserved');

    console.log('✔ Case 9.3 Passed: WIb accidental overwrite blanking strictly guarded');
}

// 9.4 User-Initiated Delete Action Respected
{
    const entitiesMap = new Map();
    const userDeletedChunkId = 'chunk-user-wants-to-delete';

    entitiesMap.set(userDeletedChunkId, {
        id: userDeletedChunkId,
        tb: 'text',
        role: 'model',
        text: '这是一段用户准备重新运行或删除的内容',
        timestamp: Date.now() - 1000
    });

    // Simulate user clicking delete / rerun button
    const mockDeleteButton = mockDoc.createElement('button');
    mockDeleteButton.className = 'delete-turn-button';
    mockDoc.body.appendChild(mockDeleteButton);

    const clickEvent = { target: mockDeleteButton };
    // Dispatch to mock window listener
    for (const listener of global.window._listeners.click || []) {
        listener(clickEvent);
    }

    // Now delete chunk and set empty chunk
    entitiesMap.delete(userDeletedChunkId);

    const userClearedChunk = {
        id: 'chunk-fresh-start',
        tb: 'text',
        role: 'model',
        text: '',
        Dl: { finishReason: 1 }
    };

    entitiesMap.set('chunk-fresh-start', userClearedChunk);

    // Assert: User action must be respected, no false positive rescue
    assert.strictEqual(userClearedChunk._msAntiRetractionRescued, undefined, 'User action must not be falsely rescued');
    assert.strictEqual(userClearedChunk.text, '', 'User-initiated empty chunk remains empty');

    console.log('✔ Case 9.4 Passed: User-initiated deletion respected with zero false positives');
}

// 9.5 Virtual Scroll Unmount & Dynamic Reflow Immunity Test
{
    mockDoc.body.childNodes = [];
    // Simulate real AI Studio virtual-scroll-container hierarchy from saved HTML
    const turn = mockDoc.createElement('ms-chat-turn');
    turn.className = 'text-chunk-host';

    const vsc = mockDoc.createElement('div');
    vsc.className = 'virtual-scroll-container model-prompt-container';
    vsc.setAttribute('data-turn-role', 'Model');

    // Spacer div for off-screen height maintenance
    const spacer = mockDoc.createElement('div');
    spacer.style.height = '349.6px';
    vsc.appendChild(spacer);

    // Off-screen unmounted turn content
    const tc = mockDoc.createElement('div');
    tc.className = 'turn-content';
    tc.innerHTML = ''; // completely empty when unmounted off-screen
    tc.textContent = '';
    vsc.appendChild(tc);

    turn.appendChild(vsc);
    mockDoc.body.appendChild(turn);

    // Execute full pipeline
    runAllFixes();

    // Verify: No false-positive DOM rescue banners injected
    assert.strictEqual(turn.dataset.msDomRescued, undefined, 'Turn must never be falsely marked as rescued');
    assert.strictEqual(mockDoc.querySelectorAll('.ms-dom-anti-retraction-banner').length, 0, 'Zero false retraction banners injected');
    assert.strictEqual(tc.textContent, '', 'Unmounted off-screen turn remains cleanly unmounted');

    console.log('✔ Case 9.5 Passed: Virtual Scroll unmount immunity verified with 100% precision');
}

// 9.6 Latest Closure Compiler Obfuscation Structure (HJ-037 / boq_alkali-makersuite_20261106.02_p0)
{
    resetUserAction();
    const entitiesMap = new Map();
    const thoughtId = 'chunk-hj037-thought';
    const textId = 'chunk-hj037-main';

    // Model streams thought and text
    entitiesMap.set(thoughtId, {
        id: thoughtId,
        yb: 'text',
        role: 'model',
        thought: true,
        ln: true,
        text: '正在检索 HJ-037 系列的详细信息并整理演员阵容与出品信息...',
        timestamp: Date.now() - 2000
    });

    entitiesMap.set(textId, {
        id: textId,
        yb: 'text',
        role: 'model',
        thought: false,
        ln: false,
        text: 'HJ-037 是著名的作品系列。以下是整理后的作品详情与演员阵容列表：\n| 编号 | 作品名 | 主演 |\n|---|---|---|\n| HJ-037-1 | 作品一 | 演员A |',
        timestamp: Date.now() - 1000
    });

    // Simulate AI Studio AOb / lJb: deletes all chunks
    entitiesMap.delete(thoughtId);
    entitiesMap.delete(textId);

    // AI Studio inserts empty chunk with obfuscated properties from m=_b_t56s:
    // v.Mm (instead of v.Dl), v.Ej (instead of v.Di), v.ln (instead of v.Ul), v.lc (instead of v.Ub), finishReason: 8 (PROHIBITED_CONTENT)
    const newUUID = 'BCE0F7FB-7111-4175-AFB9-C70ED184A508';
    const emptyRetractionChunk = {
        id: newUUID,
        yb: 'text',
        ln: false,
        role: 'model',
        timestamp: Date.now(),
        text: '',
        tokenCount: 0,
        lc: 1,
        Ej: [],
        Mm: {
            finishReason: 8,
            finishMessage: 'Prohibited content',
            safetyRatings: [{ category: 2, probability: 3 }]
        }
    };

    entitiesMap.set(newUUID, emptyRetractionChunk);

    assert.strictEqual(emptyRetractionChunk._msAntiRetractionRescued, true, 'Must rescue chunk with new v.Mm obfuscation');
    assert.ok(emptyRetractionChunk.text.includes('HJ-037 是著名的作品系列'), 'Main text must be rescued');
    assert.ok(emptyRetractionChunk.text.includes('正在检索 HJ-037 系列的详细信息'), 'Thinking process must be rescued');
    assert.ok(emptyRetractionChunk.text.includes('🛡️ **[防撤回保护生效]**'), 'Protection notice must be attached');
    assert.strictEqual(emptyRetractionChunk.Mm.finishReason, 1, 'finishReason in v.Mm must be normalized to 1');
    assert.strictEqual(emptyRetractionChunk._originalDl.finishReason, 8, 'Original finishReason 8 must be saved in _originalDl');

    console.log('✔ Case 9.6 Passed: Latest Closure Compiler obfuscation (v.Mm, v.Ej, finishReason: 8) rescued with 100% precision');
}

// 9.7 Layer 1 Array.prototype.includes Interception (wNb / jIb)
{
    resetUserAction();
    const wNb = [0, 3, 4, 5, 7, 8, 9, 11, 14, 15, 17];

    // Under automatic AI Studio retraction, includes(8) or includes(3) must return false
    assert.strictEqual(wNb.includes(8), false, 'wNb.includes(8) must return false to guide AOb into else branch');
    assert.strictEqual(wNb.includes(3), false, 'wNb.includes(3) must return false');

    // Normal arrays must remain completely untouched
    assert.strictEqual([1, 2, 3].includes(2), true, 'Normal array includes must work as expected');
    assert.strictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(8), true, 'Different array signature must work as normal');

    // When user initiates an action, wNb.includes must return true
    const mockButton = mockDoc.createElement('button');
    mockButton.className = 'delete-turn-button';
    mockDoc.body.appendChild(mockButton);
    for (const listener of global.window._listeners.click || []) {
        listener({ target: mockButton });
    }
    assert.strictEqual(wNb.includes(8), true, 'User initiated action allows normal includes');
    resetUserAction();

    console.log('✔ Case 9.7 Passed: Layer 1 Array.prototype.includes interception guard verified');
}

// 9.8 Multiple Thought Chunks Preservation in Chronological Order
{
    const entitiesMap = new Map();
    const thought1 = 'chunk-thought-step-1';
    const thought2 = 'chunk-thought-step-2';
    const thought3 = 'chunk-thought-step-3';
    const mainChunk = 'chunk-main-response';

    entitiesMap.set(thought1, {
        id: thought1,
        role: 'model',
        thought: true,
        text: '步骤 1：分析用户提问，准备执行第 1 次搜索...',
        timestamp: Date.now() - 3000
    });
    entitiesMap.set(thought2, {
        id: thought2,
        role: 'model',
        thought: true,
        text: '步骤 2：第 1 次搜索返回结果不全面，发起第 2 次深度搜索...',
        timestamp: Date.now() - 2000
    });
    entitiesMap.set(thought3, {
        id: thought3,
        role: 'model',
        thought: true,
        text: '步骤 3：综合多次搜索结果，开始构建回答...',
        timestamp: Date.now() - 1000
    });
    entitiesMap.set(mainChunk, {
        id: mainChunk,
        role: 'model',
        thought: false,
        text: '这是综合多次思考后的最终回答正文。',
        timestamp: Date.now() - 500
    });

    entitiesMap.delete(thought1);
    entitiesMap.delete(thought2);
    entitiesMap.delete(thought3);
    entitiesMap.delete(mainChunk);

    const emptyChunk = {
        id: 'chunk-all-deleted',
        role: 'model',
        text: '',
        Mm: { finishReason: 8 }
    };
    entitiesMap.set('chunk-all-deleted', emptyChunk);

    assert.ok(emptyChunk.text.includes('步骤 1：分析用户提问'), 'Step 1 thought preserved');
    assert.ok(emptyChunk.text.includes('步骤 2：第 1 次搜索返回结果不全面'), 'Step 2 thought preserved');
    assert.ok(emptyChunk.text.includes('步骤 3：综合多次搜索结果'), 'Step 3 thought preserved');
    assert.ok(emptyChunk.text.includes('这是综合多次思考后的最终回答正文'), 'Final answer text preserved');
    assert.ok(emptyChunk.text.indexOf('步骤 1') < emptyChunk.text.indexOf('步骤 2'), 'Order: step 1 before step 2');
    assert.ok(emptyChunk.text.indexOf('步骤 2') < emptyChunk.text.indexOf('步骤 3'), 'Order: step 2 before step 3');

    console.log('✔ Case 9.8 Passed: Multiple thought chunks preserved in chronological order');
}

// 9.9 Map.prototype.set O(1) Reference Equality Fast Path Performance
{
    const map = new Map();
    for (let i = 0; i < 100; i++) {
        map.set(`chunk-perf-${i}`, {
            id: `chunk-perf-${i}`,
            role: 'model',
            text: `This is a long model text chunk number ${i} with thousands of characters: `.repeat(50),
            timestamp: Date.now()
        });
    }

    const tStart = Date.now();
    // Simulate 1,000 streaming cycles cloning all 100 entities via new Map(map) -> 100,000 Map.set calls
    for (let c = 0; c < 1000; c++) {
        new Map(map);
    }
    const duration = Date.now() - tStart;
    assert.ok(duration < 250, `100,000 Map.set calls should finish in <250ms, took ${duration}ms`);

    console.log(`✔ Case 9.9 Passed: 100,000 Map.set fast-path calls completed in ${duration}ms (true O(1) performance)`);
}

// 7.17 Cross-Paragraph DOM Isolation (Bug 1 Fix Verification)
{
    mockDoc.body.childNodes = [];
    const p1 = mockDoc.createElement('p');
    p1.className = 'markdown-content';
    p1.appendChild(mockDoc.createTextNode('第一段：'));
    const st1 = mockDoc.createElement('strong');
    st1.appendChild(mockDoc.createTextNode('重要结论'));
    p1.appendChild(st1);
    p1.appendChild(mockDoc.createTextNode('，这是正常说明。'));

    const p2 = mockDoc.createElement('p');
    p2.className = 'markdown-content';
    p2.appendChild(mockDoc.createTextNode('第二段：普通标点，'));
    const em2 = mockDoc.createElement('em');
    em2.appendChild(mockDoc.createTextNode('斜体'));
    p2.appendChild(em2);
    p2.appendChild(mockDoc.createTextNode('内容。'));

    mockDoc.body.appendChild(p1);
    mockDoc.body.appendChild(p2);

    runAllFixes();

    assert.strictEqual(p1.textContent, '第一段：重要结论，这是正常说明。', 'Paragraph 1 must not be swallowed or corrupted');
    assert.strictEqual(p2.textContent, '第二段：普通标点，斜体内容。', 'Paragraph 2 must keep its own content');
    assert.strictEqual(mockDoc.body.childNodes.length, 2, 'Both paragraphs must remain distinct in body');
    assert.strictEqual(p1.querySelector('strong').textContent, '重要结论', 'Strong in p1 intact');

    console.log('✔ Case 7.17 Passed: Cross-paragraph boundary strictly isolated, zero DOM swallowing');
}

// 7.18 Streaming Safety: No TextNode Disconnection during streaming
{
    mockDoc.body.childNodes = [];
    const bq = mockDoc.createElement('blockquote');
    const p = mockDoc.createElement('p');
    const streamingTextNode = mockDoc.createTextNode('*"正在流式输出一段未完成的内容**加粗部分');
    p.appendChild(streamingTextNode);
    bq.appendChild(p);
    mockDoc.body.appendChild(bq);

    runAllFixes();

    // The text node must NOT be removed from DOM
    assert.strictEqual(streamingTextNode.parentNode, p, 'Streaming text node must remain connected to parent');
    assert.strictEqual(streamingTextNode.isConnected, true, 'Streaming text node must remain connected to document');

    console.log('✔ Case 7.18 Passed: Streaming unclosed lines strictly guarded, TextNode connection preserved');
}

// 2.8 fixBrokenCodeBlocks Reversion when Code Keywords arrive
{
    mockDoc.body.childNodes = [];
    const cb = mockDoc.createElement('ms-code-block');
    const pre = mockDoc.createElement('pre');
    pre.textContent = '# 这是主函数入口。\n这里用于计算核心数值。';
    cb.appendChild(pre);
    mockDoc.body.appendChild(cb);

    // Initial check: is unpacked because of # H1 comment + CJK sentence without code keywords yet
    runAllFixes();
    assert.strictEqual(cb.getAttribute('data-ms-code-unpacked'), '1', 'Initial pseudo code unpacked');

    // Streaming updates: Python code keyword def calculate() arrives!
    pre.textContent = '# 这是主函数入口。\ndef calculate(x):\n    return x * 2\n';
    runAllFixes();

    // Assert: must revert unpacking, restoring original code block appearance
    assert.strictEqual(cb.hasAttribute('data-ms-code-unpacked'), false, 'data-ms-code-unpacked must be removed');
    assert.strictEqual(cb.querySelector('.ms-unpacked-code'), null, 'Unpacked div must be removed');
    assert.strictEqual(pre.style.display, '', 'pre display style must be restored');

    console.log('✔ Case 2.8 Passed: Pseudo codeblock correctly reverted when real code keywords stream in');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 10: Cross-Block Formula Stitching Tests (v1.5.0) ---');

// 10.1 Screenshot Exact Reproduction: Domino Cancellation Array split by '+ ' into <p> + <ul><li>
{
    mockDoc.body.childNodes = [];
    const turn = mockDoc.createElement('div');
    turn.className = 'markdown-content';

    const rawMarkdownSource = `现在，把这两部分**上下对齐加起来**：

$$\\begin{array}{rccccccc}
& 1 & + & x & + & x^2 & & \\\\
+ & & - & x & - & x^2 & - & x^3 \\\\
\\hline
= & 1 & + & 0 & + & 0 & - & x^3
\\end{array}$$`;

    // 1. Simulate network stream feeding raw markdown to cache
    collectRawLatexEnvsFromString(rawMarkdownSource);

    // 2. Simulate AI Studio CommonMark DOM structure (p + ul)
    const p = mockDoc.createElement('p');
    p.appendChild(mockDoc.createTextNode('现在，把这两部分**上下对齐加起来**：\n\n\\begin{array}{rccccccc}\n& 1 & + & x & + & x^2 & & \\\n'));

    const ul = mockDoc.createElement('ul');
    const li = mockDoc.createElement('li');
    // Note: '+' was swallowed by CommonMark as list bullet, and '\\' became single '\'
    li.appendChild(mockDoc.createTextNode('& & - & x & - & x^2 & - & x^3 \\\n\\hline\n= & 1 & + & 0 & + & 0 & - & x^3\n\\end{array}'));
    ul.appendChild(li);

    turn.appendChild(p);
    turn.appendChild(ul);
    mockDoc.body.appendChild(turn);

    // Execute full pipeline
    runAllFixes();

    // Verification 1: KaTeX formula rendered inside <p>
    const katexEl = p.querySelector('.katex');
    assert.ok(katexEl, 'KaTeX rendered formula must exist inside <p>');
    assert.ok(katexEl.textContent.includes('\\begin{array}'), 'Rendered formula must contain array environment');
    assert.ok(katexEl.textContent.includes('+ & & - & x'), 'Original swallowed "+" must be seamlessly restored');

    // Verification 2: Subsequent sibling <ul> must be hidden in-place, NOT removed (Angular LView protected)
    assert.strictEqual(ul.style.display, 'none', 'Subsequent split <ul> must be hidden in place');
    assert.strictEqual(ul.getAttribute('data-ms-math-hidden'), '1', 'Subsequent split <ul> must be marked data-ms-math-hidden');
    assert.strictEqual(ul.parentNode, turn, 'Split <ul> must remain connected to parent in DOM tree');

    // Verification 3: Chinese explanation text and bold markdown preserved and bolded
    const strong = p.querySelector('strong');
    assert.ok(strong, 'Bold markdown **上下对齐加起来** must be successfully bolded');
    assert.strictEqual(strong.textContent, '上下对齐加起来');

    console.log('✔ Case 10.1 Passed: Domino cancellation array formula split by "+" seamlessly stitched & restored');
}

// 10.2 Offline Pure DOM Fallback Mode (zero network cache)
{
    mockDoc.body.childNodes = [];
    rawLatexEnvBlocks.clear(); // Clear all caches to simulate offline mode
    const turn = mockDoc.createElement('div');
    turn.className = 'markdown-content';

    const p = mockDoc.createElement('p');
    p.appendChild(mockDoc.createTextNode('推导过程如下：\n\\begin{array}{rccccccc}\n& 1 & + & x & + & x^2 & & \\\n'));

    const ul = mockDoc.createElement('ul');
    const li = mockDoc.createElement('li');
    li.appendChild(mockDoc.createTextNode('& & - & x & - & x^2 & - & x^3 \\\n\\hline\n= & 1 & + & 0 & + & 0 & - & x^3\n\\end{array}'));
    ul.appendChild(li);

    turn.appendChild(p);
    turn.appendChild(ul);
    mockDoc.body.appendChild(turn);

    runAllFixes();

    const katexEl = p.querySelector('.katex');
    assert.ok(katexEl, 'Formula must be rendered via offline DOM fallback');
    assert.ok(katexEl.textContent.includes('\\begin{array}'), 'Array environment preserved');
    assert.ok(katexEl.textContent.includes('+ & & - & x'), 'Offline compensation restored missing "+" prefix');
    assert.strictEqual(ul.style.display, 'none', 'Split <ul> hidden in place');

    console.log('✔ Case 10.2 Passed: Offline DOM fallback accurately compensated missing list prefix');
}

// 10.3 Multi-Block Continuous Split (<p> + <ul> + <ul>)
{
    mockDoc.body.childNodes = [];
    const turn = mockDoc.createElement('div');
    turn.className = 'markdown-content';

    const p = mockDoc.createElement('p');
    p.appendChild(mockDoc.createTextNode('\\begin{aligned}\na &= 1 + x \\\\\n'));

    const ul1 = mockDoc.createElement('ul');
    const li1 = mockDoc.createElement('li');
    li1.appendChild(mockDoc.createTextNode('b &= 2 + y \\\\\n'));
    ul1.appendChild(li1);

    const ul2 = mockDoc.createElement('ul');
    const li2 = mockDoc.createElement('li');
    li2.appendChild(mockDoc.createTextNode('c &= 3 + z\n\\end{aligned}'));
    ul2.appendChild(li2);

    turn.appendChild(p);
    turn.appendChild(ul1);
    turn.appendChild(ul2);
    mockDoc.body.appendChild(turn);

    runAllFixes();

    const katexEl = p.querySelector('.katex');
    assert.ok(katexEl, 'Multi-split formula stitched into <p>');
    assert.strictEqual(ul1.style.display, 'none', 'ul1 hidden');
    assert.strictEqual(ul2.style.display, 'none', 'ul2 hidden');

    console.log('✔ Case 10.3 Passed: Multi-block continuous split across multiple siblings stitched');
}

// 10.4 Streaming Half-Baked Formula Guard (Unclosed Stream Protection)
{
    mockDoc.body.childNodes = [];
    const turn = mockDoc.createElement('div');
    turn.className = 'markdown-content';

    const p = mockDoc.createElement('p');
    p.appendChild(mockDoc.createTextNode('正在推导：\n\\begin{array}{cc}\n1 & 2 \\\n'));
    turn.appendChild(p);
    mockDoc.body.appendChild(turn);

    runAllFixes();

    // Since \end{array} hasn't arrived yet, must NOT create broken math
    assert.strictEqual(p.querySelector('.katex'), null, 'Unclosed streaming formula must wait for completion');
    assert.ok(p.textContent.includes('\\begin{array}{cc}'), 'Original text preserved while streaming');

    console.log('✔ Case 10.4 Passed: Streaming unclosed formulas strictly guarded against premature execution');
}

// 10.5 In-Place DOM Reversibility & Cleanup
{
    mockDoc.body.childNodes = [];
    const turn = mockDoc.createElement('div');
    turn.className = 'markdown-content';

    const p = mockDoc.createElement('p');
    p.appendChild(mockDoc.createTextNode('\\begin{array}{c}\n1 \\\\\n'));
    const ul = mockDoc.createElement('ul');
    const li = mockDoc.createElement('li');
    li.appendChild(mockDoc.createTextNode('2\n\\end{array}'));
    ul.appendChild(li);

    turn.appendChild(p);
    turn.appendChild(ul);
    mockDoc.body.appendChild(turn);

    runAllFixes();
    assert.strictEqual(ul.style.display, 'none', 'Hidden after fix');

    // Simulate container content change triggering restore
    if (p._msMathState) {
        p.childNodes[0].textContent = 'Modified content';
        runAllFixes();
    }
    assert.strictEqual(ul.getAttribute('data-ms-math-hidden'), null, 'data-ms-math-hidden removed after restore');

    console.log('✔ Case 10.5 Passed: In-place DOM reversibility and hidden node cleanup verified');
}

// ----------------------------------------------------
console.log('\n--- Test Suite 11: Mobile Stuck Loading & Safety Retraction Closure Tests (v1.5.1) ---');

// 11.1 Zero-Content Safety Block Interception (Screenshot exact case: safety refusal with text: "")
{
    resetUserAction();
    const entities = new Map();
    const chunkId = 'model-chunk-safety-zero-content-' + Date.now();
    const interceptedChunk = {
        id: chunkId,
        role: 'model',
        yb: 'text',
        ln: true,
        text: '',
        tokenCount: 0,
        lc: 1,
        Mm: {
            finishReason: 3, // SAFETY
            finishMessage: 'SAFETY_VIOLATION'
        }
    };

    // Simulate AI Studio setting chunk into entities map
    entities.set(chunkId, interceptedChunk);

    // Verifications:
    // 1) ln must be strictly closed to false (terminating the "処理しています" loading spinner)
    assert.strictEqual(interceptedChunk.ln, false, 'Loading flag ln must be closed to false');
    assert.strictEqual(interceptedChunk.Ul, false, 'Streaming flag Ul must be closed to false');

    // 2) text must be populated with a helpful safety notification rather than left empty
    assert.ok(interceptedChunk.text.includes('[内容被系统安全策略拦截]'), 'Safety notice must be injected');
    assert.ok(interceptedChunk.text.includes('3'), 'Finish reason code must be shown');

    // 3) finishReason must be normalized to STOP (1) and incomplete set to false so Angular stops spinning
    assert.strictEqual(interceptedChunk.incomplete, false, 'incomplete flag must be false');
    assert.strictEqual(interceptedChunk.Mm.finishReason, 1, 'finishReason must be normalized to 1');

    console.log('✔ Case 11.1 Passed: Zero-content safety interception closed loading state and injected helpful notice');
}

// 11.2 Prohibited Content Interception with No Deleted Chunks (Layer 1 else branch routing)
{
    resetUserAction();
    const entities = new Map();
    const chunkId = 'model-chunk-prohibited-zero-content-' + Date.now();
    const interceptedChunk = {
        id: chunkId,
        role: 'model',
        yb: 'text',
        ln: true,
        text: '',
        Dl: {
            finishReason: 8, // PROHIBITED_CONTENT
            finishMessage: 'PROHIBITED'
        }
    };

    entities.set(chunkId, interceptedChunk);

    assert.strictEqual(interceptedChunk.ln, false, 'Loading flag ln must be closed to false');
    assert.ok(interceptedChunk.text.includes('[内容被系统安全策略拦截]'), 'Notice must be injected');
    assert.ok(interceptedChunk.text.includes('8'), 'Prohibited code 8 must be shown');
    assert.strictEqual(interceptedChunk.Dl.finishReason, 1, 'finishReason must be normalized');

    console.log('✔ Case 11.2 Passed: Prohibited content zero-content interception gracefully handled');
}

// 11.3 Partial Text Generation Followed by Abnormal Interruption
{
    resetUserAction();
    const entities = new Map();
    const chunkId = 'model-chunk-partial-text-' + Date.now();
    const partialChunk = {
        id: chunkId,
        role: 'model',
        yb: 'text',
        ln: true,
        text: '关于该历史人物的考证，经查证史料记载如下：',
        Mm: {
            finishReason: 3, // SAFETY interruption during streaming
            finishMessage: 'SAFETY'
        }
    };

    entities.set(chunkId, partialChunk);

    // 1) ln must be false
    assert.strictEqual(partialChunk.ln, false, 'Loading flag ln must be closed to false');
    // 2) Original partial text must be preserved
    assert.ok(partialChunk.text.startsWith('关于该历史人物的考证'), 'Original partial text must be kept');
    // 3) Protective notice appended
    assert.ok(partialChunk.text.includes('[防撤回保护生效]'), 'Retraction protection notice must be appended');
    assert.strictEqual(partialChunk.Mm.finishReason, 1, 'finishReason normalized to 1');

    console.log('✔ Case 11.3 Passed: Partial generated text preserved and loading state released on safety interruption');
}

// 11.4 Mobile Keyboard & Touch User Action Detection
{
    resetUserAction();
    assert.strictEqual(isUserInitiatedAction(), false, 'Should be inactive initially');

    // 1) Mobile virtual keyboard Enter keydown
    markUserAction({ type: 'keydown', key: 'Enter', keyCode: 13 });
    assert.strictEqual(isUserInitiatedAction(), true, 'Virtual keyboard Enter must be recognized as user-initiated action');

    // 2) Reset and test touchstart on <ms-run-button>
    resetUserAction();
    assert.strictEqual(isUserInitiatedAction(), false, 'Reset successfully');

    const fakeRunBtn = {
        closest: (selector) => selector.includes('ms-run-button') ? true : null
    };
    markUserAction({ type: 'touchstart', target: fakeRunBtn });
    assert.strictEqual(isUserInitiatedAction(), true, 'Touchstart on ms-run-button must be recognized as user-initiated action');

    console.log('✔ Case 11.4 Passed: Mobile virtual keyboard Enter and touch actions reliably recognized');
}

// 11.5 Normal Generation Stream Completion releases ln
{
    resetUserAction();
    const entities = new Map();
    const chunkId = 'model-chunk-normal-completion-' + Date.now();
    const normalChunk = {
        id: chunkId,
        role: 'model',
        yb: 'text',
        ln: true,
        text: '这是正常的回答内容。',
        Mm: {
            finishReason: 1 // STOP
        }
    };

    entities.set(chunkId, normalChunk);

    assert.strictEqual(normalChunk.ln, false, 'Normal stream completion with finishReason: 1 must release ln to false');
    assert.strictEqual(normalChunk.text, '这是正常的回答内容。', 'Normal text preserved intact');

    console.log('✔ Case 11.5 Passed: Normal stream completion releases loading flag cleanly');
}

console.log('\n=========================================');
console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (100%)');
console.log('=========================================');
