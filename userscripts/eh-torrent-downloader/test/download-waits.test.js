'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, searchForm, galleryRow } = require('./browser-helpers');

const hash = 'a'.repeat(40);
const torrentHTML = gid => `<div id="torrentinfo"><table><tr><td>Downloads:</td><td>42</td></tr>
    <tr><td>Posted:</td><td>2026-10-01 12:00</td></tr><tr><td>
    <a href="https://ehtracker.org/${gid === 123 ? hash : 'b'.repeat(40)}.torrent">日本語の種子.torrent</a></td></tr></table></div>`;

async function until(page, predicate, message) {
    for (let i = 0; i < 100 && !predicate(); i++) await page.flush();
    assert.ok(predicate(), message);
}

async function setup(t, globals = {}, host = 'exhentai.org', gid = 123) {
    const page = load(`${searchForm}<table class="itg">${galleryRow(gid)}</table>`, {
        url: `https://${host}/`, readyState: 'complete', globals,
    });
    t.after(page.close);
    const requests = [], saves = [], dialogs = [], aborted = [];
    const w = page.window;
    Object.assign(w, { TextEncoder, TextDecoder });
    w.GM_xmlhttpRequest = options => { requests.push(options); return { abort() { aborted.push(options); options.onabort?.(); } }; };
    w.GM_download = options => saves.push(options);
    w.HTMLDialogElement.prototype.showModal = function () { dialogs.push(this); };
    w.HTMLDialogElement.prototype.close = function () { this.dispatchEvent(new w.Event('close')); };
    await page.flush();
    const anchor = page.document.querySelector('a[data-ehtd-list]');
    const reply = req => {
        const binary = req.responseType === 'arraybuffer';
        const response = binary ? new w.Uint8Array(Buffer.from('d4:infod4:name1:aee')).buffer : undefined;
        req.onload({ status: 200, finalUrl: req.url, response,
            responseText: new URL(req.url).pathname.startsWith('/g/')
                ? `<h1 id="gn">Example Title ${gid}</h1><h1 id="gj">日本語の題名 ${gid}</h1>` : torrentHTML(gid) });
    };
    return { ...page, requests, saves, dialogs, aborted, anchor, reply };
}

async function prepare(page) {
    await until(page, () => page.requests.length >= 2, '详情与种子列表应在任一响应返回前同时发出');
    const initial = page.requests.slice(-2);
    assert.ok(initial.some(req => new URL(req.url).pathname.startsWith('/g/')));
    assert.ok(initial.some(req => new URL(req.url).pathname === '/gallerytorrents.php'));
    assert.equal(page.requests.some(req => req.responseType === 'arraybuffer'), false, '历史核对前不读取种子文件');
    initial.forEach(page.reply);
    await until(page, () => page.requests.some(req => req.responseType === 'arraybuffer'), '历史核对后应读取种子文件');
    page.reply(page.requests.find(req => req.responseType === 'arraybuffer'));
    await until(page, () => page.saves.length === 1, '应调用浏览器保存');
}

test('种子：详情与列表并行读取，保留种子原名和完整下载历史', async t => {
    const page = await setup(t);
    page.anchor.click();
    await prepare(page);
    assert.equal(page.saves[0].name, '[EX_123_abcdef0123] 日本語の種子-aaaaaaaa.torrent');
    page.saves[0].onload();
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '保存完成后解除占位');
    const history = page.window.GM_getValue('downloadedTorrents');
    assert.equal(history.length, 1);
    assert.equal(history[0].status, undefined);
});

test('种子：取消浏览器保存会清除未完成历史并释放任务', async t => {
    const page = await setup(t);
    page.anchor.click();
    await prepare(page);
    page.saves[0].onerror({ error: 'USER_CANCELED' });
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '取消后解除占位');
    assert.equal(page.window.GM_getValue('downloadedTorrents').length, 0);
});

test('种子：列表为空时停止未完成的题名请求', async t => {
    const page = await setup(t);
    page.anchor.click();
    await until(page, () => page.requests.length === 2, '并行读取详情与列表');
    const list = page.requests.find(req => new URL(req.url).pathname === '/gallerytorrents.php');
    list.onload({ status: 200, finalUrl: list.url, responseText: '<div id="torrentinfo"></div>' });
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '无种子时立即结束');
    assert.equal(page.aborted.length, 1);
    assert.ok(new URL(page.aborted[0].url).pathname.startsWith('/g/'));
    assert.equal(page.saves.length, 0);
});

test('种子：并行题名请求返回限流时不继续读取种子文件', async t => {
    const page = await setup(t);
    page.anchor.click();
    await until(page, () => page.requests.length === 2, '并行读取详情与列表');
    for (const req of page.requests) {
        if (new URL(req.url).pathname.startsWith('/g/')) req.onload({ status: 200, finalUrl: req.url,
            responseText: 'You are opening pages too fast, thus placing a heavy load on the server.' });
        else page.reply(req);
    }
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '限流后结束任务');
    assert.equal(page.requests.length, 2);
    assert.equal(page.saves.length, 0);
});

function sharedTabs() {
    const tabs = new Map(), values = new Map();
    const clone = value => JSON.parse(JSON.stringify(value));
    const globals = id => ({
        GM_getValue: (key, fallback) => values.has(key) ? clone(values.get(key)) : fallback,
        GM_setValue: (key, value) => values.set(key, clone(value)),
        GM_getTab: callback => setTimeout(() => callback(clone(tabs.get(id) || {})), 0),
        GM_saveTab: (tab, callback) => setTimeout(() => { tabs.set(id, clone(tab)); callback(); }, 0),
        GM_getTabs: callback => setTimeout(() => callback(clone(Object.fromEntries(tabs))), 0),
    });
    return { tabs, values, globals };
}

test('跨标签页：EH 与 EX 同时点击只启动一次，完成后另一页仍能识别历史', async t => {
    const { tabs, values, globals } = sharedTabs();
    const pages = [await setup(t, globals('EH'), 'e-hentai.org'), await setup(t, globals('EX'))];
    for (const page of pages) page.anchor.click();
    await until(pages[0], () => pages.filter(page => page.requests.length > 0).length === 1
        && pages.some(page => !page.anchor.hasAttribute('aria-busy')), '竞争结束后只有一个页面开始请求');
    const winner = pages.find(page => page.requests.length > 0), other = pages.find(page => page !== winner);
    await prepare(winner);
    assert.equal(other.requests.length, 0);
    assert.equal(other.saves.length, 0);
    winner.saves[0].onload();
    await until(winner, () => !winner.anchor.hasAttribute('aria-busy'), '胜出的任务完成并释放锁');
    assert.equal(values.get('downloadedTorrents').length, 1);
    for (const tab of tabs.values()) {
        assert.equal(tab.ehtdCoordination151.mutex, undefined);
        assert.equal(tab.ehtdCoordination151.tasks.length, 0);
    }
    other.anchor.click();
    await until(other, () => other.requests.length === 2, '下一次点击可继续读取页面');
    other.requests.forEach(other.reply);
    await until(other, () => other.dialogs.length === 1, '另一页面必须看到已完成的历史并提醒重复');
    assert.ok(other.dialogs[0].textContent.includes('重复'));
    assert.equal(other.requests.some(req => req.responseType === 'arraybuffer'), false);
    assert.equal(other.saves.length, 0);
    [...other.dialogs[0].querySelectorAll('button')].find(button => button.textContent.includes('取消')).click();
    await until(other, () => !other.anchor.hasAttribute('aria-busy'), '取消重复下载后释放任务');
});

test('跨标签页：不同画廊并行下载时保留双方历史并正确标记完成', async t => {
    const { values, globals } = sharedTabs();
    const pages = [await setup(t, globals('one')), await setup(t, globals('two'), 'exhentai.org', 456)];
    for (const page of pages) page.anchor.click();
    await Promise.all(pages.map(prepare));
    assert.equal(values.get('downloadedTorrents').length, 2);
    for (const page of pages) page.saves[0].onload();
    await Promise.all(pages.map(page => until(page, () => !page.anchor.hasAttribute('aria-busy'), '并行保存后释放任务')));
    const history = values.get('downloadedTorrents');
    assert.deepEqual(history.map(entry => entry.gid).sort(), ['123', '456']);
    assert.ok(history.every(entry => entry.status === undefined));
});
