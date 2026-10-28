'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, searchForm, galleryRow, detailMenu } = require('./browser-helpers');
const m = require('./helpers');

const list = 'https://exhentai.org/gallerytorrents.php?gid=123&t=abcdef0123';
const archiver = 'https://exhentai.org/archiver.php?gid=123&token=abcdef0123';
const pending = 'https://exhentai.org/archive/123/example/job/2';
const zip = 'https://test.hath.network/archive/example/original.zip';
const gallery = `<h1 id="gn">Example Title</h1><h1 id="gj">日本語の題名</h1>${detailMenu}`;
// Same structure as the reported attachment, with synthetic gallery and archive identifiers.
const processing = `<html><head><title>Archiver</title></head><body><div id="db">
<p>The file is already being processed. Please contact staff if it is not ready within a few minutes.</p>
<p id="continue">(<a href="/archive/123/example/job/2" onclick="gotonext(); return false">Click here if your browser does not continue automatically</a>)</p>
<script>function gotonext() { document.location = "/archive/123/example/job/2"; }
setTimeout("gotonext()", 30000);</script></div></body></html>`;
const form = '<p>Original Archive: 10 GP</p><form><input type="hidden" name="dltype" value="org"><input type="submit" name="dlcheck" value="Download Original Archive"></form>';

async function until(page, predicate, message) {
    for (let i = 0; i < 100 && !predicate(); i++) await page.flush();
    assert.ok(predicate(), message);
}

test('归档解析：附件中的继续链接和 30 秒等待不能当成 ZIP', () => {
    const result = m.parseArchive(processing, pending, list);
    assert.deepEqual(result, { next: pending, waitMs: 30000 });
    assert.equal(new URL(result.next).searchParams.has('start'), false);
});

test('归档解析：普通中转立即继续，meta refresh 保留网站延时', () => {
    assert.deepEqual(m.parseArchive(`<a href="${zip}">Original</a>`, archiver, list), { next: zip, waitMs: 0 });
    assert.deepEqual(m.parseArchive(`<meta http-equiv="refresh" content="5;url=${zip}">`, archiver, list), { next: zip, waitMs: 5000 });
    assert.throws(() => m.parseArchive('<p>Login required</p>', zip, list));
    assert.throws(() => m.parseArchive('<a href="https://evil.example/archive/a/b">Original</a>', archiver, list));
    assert.throws(() => m.parseArchive('<a href="https://exhentai.org/archive/456/a/b">Original</a>', archiver, list));
});

async function setup(t, { detail = true, confirm = false, fetch } = {}) {
    const page = load(detail ? gallery : `${searchForm}<table class="itg">${galleryRow(123)}</table>`, {
        url: detail ? 'https://exhentai.org/g/123/abcdef0123/' : 'https://exhentai.org/', readyState: 'complete',
        settings: { confirmArchiveCost: confirm },
    });
    t.after(page.close);
    const w = page.window, xhrs = [], saves = [], waits = [], fetches = [], dialogs = [];
    Object.assign(w, { TextEncoder, TextDecoder });
    w.fetch = async (url, options) => {
        fetches.push({ url, options });
        return fetch ? fetch(url, options) : new Response(form);
    };
    w.GM_xmlhttpRequest = options => {
        const item = { options, aborted: false };
        xhrs.push(item);
        return { abort() { item.aborted = true; options.onabort?.(); } };
    };
    w.GM_download = options => { saves.push(options); queueMicrotask(options.onload); };
    w.HTMLDialogElement.prototype.showModal = function () { dialogs.push(this); };
    w.HTMLDialogElement.prototype.close = function () { this.dispatchEvent(new w.Event('close')); };
    await page.flush();
    const nativeTimeout = w.setTimeout.bind(w);
    w.setTimeout = (callback, ms, ...args) => {
        // Hold only the poll waits, so the assertions see the exact pre-download state.
        if ([1000, 3000, 30000].includes(ms)) {
            // tabCall's 3-second watchdog also uses 3000 but is immediately cleared by the mock.
            const id = nativeTimeout(() => {}, 1000000);
            waits.push({ id, ms, callback, args, cleared: false });
            return id;
        }
        return nativeTimeout(callback, ms, ...args);
    };
    const nativeClear = w.clearTimeout.bind(w);
    w.clearTimeout = id => { const item = waits.find(item => item.id === id); if (item) item.cleared = true; nativeClear(id); };
    const anchor = page.document.querySelector('a[data-ehtd-archive]');
    const polls = () => waits.filter(item => !item.cleared);
    const tick = () => { const item = polls()[0]; assert.ok(item); w.clearTimeout(item.id); item.callback(...item.args); };
    return { ...page, xhrs, saves, waits, fetches, dialogs, anchor, polls, tick };
}

function replyHTML(request, html, url = pending) {
    const response = { status: 200, finalUrl: url, responseHeaders: 'content-type: text/html; charset=UTF-8', responseText: html };
    request.options.onreadystatechange({ ...response, readyState: 2 });
    assert.equal(request.aborted, false, 'HTML 响应头不能触发文件下载或停止页面读取');
    request.options.onload(response);
}

test('原档状态：POST 返回等待页，30 秒后只检查一次，收到 ZIP 头才保存并记完成', async t => {
    const page = await setup(t);
    page.anchor.click();
    await until(page, () => page.xhrs.length === 1, '提交一次申请');
    assert.equal(page.xhrs[0].options.method, 'POST');
    replyHTML(page.xhrs[0], processing);
    await until(page, () => page.polls().length === 1, '应按页面提示等待');
    assert.equal(page.polls()[0].ms, 30000);
    assert.equal(page.saves.length, 0);
    assert.equal(page.window.GM_getValue('downloadedTorrents', []).length, 0);
    page.tick();
    await until(page, () => page.xhrs.length === 2, '继续查询准备状态');
    const request = page.xhrs[1];
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.url, pending);
    request.options.onreadystatechange({ readyState: 2, status: 200, finalUrl: pending,
        responseHeaders: 'content-type: application/zip\r\ncontent-length: 12345' });
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '保存完成');
    assert.equal(request.aborted, true, '取得文件响应头后停止探测，不重复读完整 ZIP');
    assert.equal(page.saves.length, 1);
    assert.equal(page.saves[0].url, pending, '保留验证过的精确 URL');
    assert.equal(page.xhrs.filter(item => item.options.method === 'POST').length, 1);
    assert.equal(page.window.GM_getValue('downloadedTorrents')[0].status, undefined);
});

test('原档状态：服务器一直处理中，有界结束，不重复付费申请或写入成功历史', async t => {
    const page = await setup(t);
    page.anchor.click();
    await until(page, () => page.xhrs.length === 1, '开始申请');
    replyHTML(page.xhrs[0], processing);
    for (let i = 1; i <= 6; i++) {
        await until(page, () => page.polls().length === 1, '等待网站指定的间隔');
        page.tick();
        await until(page, () => page.xhrs.length === i + 1, '只进行 GET 检查');
        replyHTML(page.xhrs[i], processing);
    }
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '三分钟累计等待后结束');
    assert.equal(page.xhrs.filter(item => item.options.method === 'POST').length, 1);
    assert.equal(page.saves.length, 0);
    assert.equal(page.window.GM_getValue('downloadedTorrents', []).length, 0);
});

test('原档状态：普通中转不睡 3 秒，候选 ZIP 返回 HTML 错误时不保存', async t => {
    const page = await setup(t, { fetch: () => new Response(`<a href="${zip}">Original</a>`) });
    page.anchor.click();
    await until(page, () => page.xhrs.length === 1, '应立即探测候选文件');
    assert.equal(page.polls().length, 0);
    assert.equal(page.xhrs[0].options.method, 'GET');
    replyHTML(page.xhrs[0], '<p>Login required</p>', zip);
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '错误页结束流程');
    assert.equal(page.saves.length, 0);
    assert.equal(page.window.GM_getValue('downloadedTorrents', []).length, 0);
});

test('原档加速：列表题名和费用页并行发出，取消费用确认不申请下载', async t => {
    const responses = new Map();
    const page = await setup(t, { detail: false, confirm: true,
        fetch: url => new Promise(resolve => responses.set(new URL(url).pathname, resolve)) });
    page.anchor.click();
    await until(page, () => responses.size === 2, '两个请求应在任何响应返回前发出');
    assert.ok(responses.has('/g/123/abcdef0123/'));
    assert.ok(responses.has('/archiver.php'));
    responses.get('/archiver.php')(new Response(form));
    responses.get('/g/123/abcdef0123/')(new Response(gallery));
    await until(page, () => page.dialogs.length === 1, '先展示费用确认');
    assert.ok(page.dialogs[0].textContent.includes('日本語の題名'));
    [...page.dialogs[0].querySelectorAll('button')].find(button => button.textContent === '取消下载').click();
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '取消后结束');
    assert.equal(page.xhrs.length, 0);
    assert.equal(page.saves.length, 0);
});
