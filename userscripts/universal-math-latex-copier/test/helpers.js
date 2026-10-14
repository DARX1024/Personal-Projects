'use strict';

// 在 jsdom 页面里运行用户脚本，模拟双击并读取写入剪贴板的内容。
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'universal-math-latex-copier.user.js'), 'utf8');

function load(html, { mathJax } = {}) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only' });
    const window = dom.window;
    const clipboard = [];

    window.GM_addStyle = () => {};
    window.GM_setClipboard = text => clipboard.push(text);
    window.unsafeWindow = window;
    if (mathJax) window.MathJax = mathJax;

    // jsdom 不支持 MathML 元素的 getComputedStyle。
    const computedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = el => (el instanceof window.HTMLElement ? computedStyle(el) : { display: 'inline' });

    window.eval(source);

    // 双击 selector 对应的元素；caret 指定光标落在哪个文本节点的第几个字符（jsdom 没有布局，需要手动给）。
    function dblclick(selector, { caret, shiftKey = false } = {}) {
        const el = window.document.querySelector(selector);
        if (!el) throw new Error(`no element: ${selector}`);

        window.document.caretRangeFromPoint = () => {
            if (!caret) return null;
            const node = textNodeContaining(window.document.body, caret.text);
            return { startContainer: node, startOffset: node.data.indexOf(caret.text) + (caret.offset ?? 0) };
        };

        const before = clipboard.length;
        const event = new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, shiftKey });
        el.dispatchEvent(event);

        return {
            copied: clipboard.length > before ? clipboard[clipboard.length - 1] : null,
            prevented: event.defaultPrevented,
        };
    }

    function textNodeContaining(root, text) {
        const walker = window.document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.data.includes(text)) return node;
        }
        throw new Error(`no text node contains: ${text}`);
    }

    return { window, document: window.document, dblclick };
}

module.exports = { load };
