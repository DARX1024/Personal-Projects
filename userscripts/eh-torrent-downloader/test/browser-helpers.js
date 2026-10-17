'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'eh-torrent-downloader.user.js'), 'utf8');
const token = 'abcdef0123';
const listPath = gid => `/gallerytorrents.php?gid=${gid}&t=${token}`;
const searchForm = '<form><input id="f_search"><p><a onclick="toggle_advsearch_pane()">高级搜索</a></p></form>';
const galleryRow = gid => `<tr><td><a href="/g/${gid}/${token}/">封面</a>
    <a href="/g/${gid}/${token}/"><span class="glink">Gallery ${gid}</span></a></td>
    <td><div class="gldown"><a href="${listPath(gid)}">T</a></div></td></tr>`;
const detailMenu = `<div id="gd5"><p class="g2"><a onclick="return popUp('${listPath(123)}')">Torrent Download</a></p>
    <p class="g2"><a href="/archiver.php?gid=123&token=${token}">Archive Download</a></p></div>`;

function load(html = '', { url = 'https://exhentai.org/', readyState = 'loading', empty = false,
    auto = false, stalledTabs = false, script = source } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
    const { window } = dom, { document } = window;
    // 保持页面处于 loading，独立模拟被慢脚本延后的 DOMContentLoaded。
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => readyState });
    document.addEventListener('DOMContentLoaded', event => event.stopImmediatePropagation(), { once: true });
    if (empty) document.documentElement.remove();
    const menus = [], requests = [], stats = { queries: 0, resourceReads: 0 };
    const observers = [], NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
        constructor(callback) { super(callback); observers.push(this); }
    };
    for (const prototype of [window.Document.prototype, window.Element.prototype]) {
        for (const name of ['querySelector', 'querySelectorAll']) {
            const original = prototype[name];
            prototype[name] = function (...args) { stats.queries++; return original.apply(this, args); };
        }
    }
    let tab = {};
    const values = new Map([['autoOnGallery', auto]]);
    Object.assign(window, {
        GM_info: { downloadMode: 'browser' },
        GM_getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        GM_setValue: (key, value) => values.set(key, value),
        GM_registerMenuCommand: (name, callback) => menus.push({ name, callback }),
        GM_addValueChangeListener: () => {},
        GM_getTab: callback => { if (!stalledTabs) callback(tab); },
        GM_saveTab: (value, callback) => { tab = value; callback(); },
        GM_getTabs: callback => callback({ test: tab }),
        GM_getResourceText: () => { stats.resourceReads++; throw new Error('startup must not load the dictionary'); },
        GM_xmlhttpRequest: options => { requests.push(options); return { abort() {} }; },
        unsafeWindow: window,
    });
    window.eval(script);
    return { window, document, stats, menus, requests,
        // 定时器让 MutationObserver 及其合并任务有机会完成。
        flush: async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 5)); },
        ready() { readyState = 'interactive'; document.dispatchEvent(new window.Event('DOMContentLoaded')); },
        close() { for (const observer of observers) observer.disconnect(); window.close(); } };
}

module.exports = { load, searchForm, galleryRow, detailMenu, listPath };
