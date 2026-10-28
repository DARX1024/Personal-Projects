'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, searchForm, galleryRow, detailMenu } = require('./browser-helpers');
const m = require('./helpers');

const english = '[Example] Romaji Title (Example Series) [Chinese]';
const japanese = '[サンプル] 日本語の題名 (Example/Series) [中国翻訳] [DL版]';
const gallery = (localTitle = japanese) => `<h1 id="gn">${english}</h1><h1 id="gj">${localTitle}</h1>${detailMenu}`;
const zipURL = 'https://test.hath.network/archive/test/original.zip';

async function download(t, { detail = false, localTitle = japanese, settings = {}, failGallery = false,
    holdHead = false, cancel = false, paid = false, knownSize = false } = {}) {
    const page = load(detail ? gallery(localTitle) : `${searchForm}<table class="itg">${galleryRow(123).replace('>封面</a>', '><img alt="cover"></a>')}</table>`, {
        url: detail ? 'https://exhentai.org/g/123/abcdef0123/' : 'https://exhentai.org/',
        readyState: 'complete', settings,
    });
    t.after(page.close);
    const w = page.window, requests = [], saves = [], confirmations = [];
    let aborted = 0, confirmed = false;
    Object.assign(w, { TextEncoder, TextDecoder });
    w.fetch = async (url, options) => {
        requests.push({ url, method: options.method });
        assert.equal(options.method, 'GET', '已有 ZIP 的流程不应提交归档申请');
        const pathname = new URL(url).pathname;
        if (pathname.startsWith('/g/')) {
            if (failGallery) throw new TypeError('simulated gallery failure');
            return new Response(gallery(localTitle));
        }
        assert.equal(pathname, '/archiver.php');
        if (paid) return new Response('<p>Original Archive: 10 GP</p><form><input type="hidden" name="dltype" value="org"><input type="submit" name="dlcheck" value="Download Original Archive"></form>');
        return new Response(`<p><a href="${zipURL}">Original</a></p>`);
    };
    w.GM_xmlhttpRequest = options => {
        requests.push({ url: options.url, method: options.method });
        if (options.method === 'POST') {
            assert.equal(confirmed, true, '付费申请必须晚于用户确认');
            assert.ok(confirmations[0].includes('10 GP'));
            queueMicrotask(() => options.onreadystatechange({ readyState: 2, status: 200, finalUrl: zipURL,
                responseHeaders: 'content-type: application/zip' }));
        } else if (options.method === 'GET') {
            assert.equal(options.url, zipURL);
            queueMicrotask(() => options.onreadystatechange({ readyState: 2, status: 200, finalUrl: zipURL,
                responseHeaders: 'content-type: application/zip' + (knownSize ? '\r\ncontent-length: 10485760' : '') }));
        } else {
            assert.equal(options.method, 'HEAD');
            assert.equal(options.url, zipURL);
            assert.equal(options.timeout, 3000);
            if (!holdHead) queueMicrotask(() => options.onload({ status: 200, finalUrl: zipURL, responseHeaders: 'content-length: 12345' }));
        }
        return { abort() { aborted++; } };
    };
    w.HTMLDialogElement.prototype.showModal = function () {
        confirmations.push(this.textContent);
        const button = [...this.querySelectorAll('button')].find(item => item.textContent === (cancel ? '取消下载' : '确认下载原档'));
        assert.ok(button, '原档费用和大小确认仍然显示');
        queueMicrotask(() => { confirmed = !cancel; button.click(); });
    };
    w.HTMLDialogElement.prototype.close = function () {};
    w.GM_download = options => { saves.push(options); queueMicrotask(options.onload); };
    await page.flush();
    const anchor = page.document.querySelector('a[data-ehtd-archive]');
    assert.ok(anchor);
    anchor.click();
    for (let i = 0; i < 50 && anchor.hasAttribute('aria-busy'); i++) await page.flush();
    assert.equal(anchor.hasAttribute('aria-busy'), false, '下载流程应完成并解除占位');
    assert.equal(saves.length, cancel ? 0 : 1);
    if (!cancel) assert.equal(saves[0].url, zipURL);
    assert.equal(confirmations.length, 1);
    let tab;
    w.GM_getTab(value => { tab = value; });
    return { requests, name: saves[0]?.name, confirmation: confirmations[0], history: w.GM_getValue('downloadedTorrents', []), aborted, tab };
}

test('原档：详情页采用日文题名，不重取详情，历史保留双语别名', async t => {
    const result = await download(t, { detail: true });
    assert.equal(result.name, `[EX_123_abcdef0123] ${japanese.replace('/', ' ')}.zip`);
    assert.ok(result.confirmation.includes(japanese));
    assert.equal(result.requests.some(item => new URL(item.url).pathname.startsWith('/g/')), false);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].title, japanese);
    assert.equal(result.history[0].status, undefined, '下载回调后应标记完成');
    for (const key of m.titleKeys([english, japanese])) assert.ok(result.history[0].keys.includes(key));
});

test('原档：列表页关闭历史仍读取日文题名，且不创建历史记录', async t => {
    const result = await download(t, { settings: { historyLimit: 0 } });
    assert.equal(result.name, `[EX_123_abcdef0123] ${japanese.replace('/', ' ')}.zip`);
    assert.equal(result.requests.filter(item => new URL(item.url).pathname.startsWith('/g/')).length, 1);
    assert.equal(result.history.length, 0);
});

test('原档：缺少日文题名时回退英文题名', async t => {
    const result = await download(t, { detail: true, localTitle: '   ' });
    assert.equal(result.name, `[EX_123_abcdef0123] ${english}.zip`);
    assert.equal(result.requests.some(item => new URL(item.url).pathname.startsWith('/g/')), false);
});

test('原档：详情读取失败时仍可用列表题名下载', async t => {
    const result = await download(t, { failGallery: true });
    assert.equal(result.name, '[EX_123_abcdef0123] Gallery 123.zip');
    assert.equal(result.requests.filter(item => new URL(item.url).pathname.startsWith('/g/')).length, 1);
});

test('原档：大小查询没有响应也能立即确认下载，并终止查询', async t => {
    const result = await download(t, { detail: true, holdHead: true });
    assert.ok(result.confirmation.includes('正在查询，可直接确认下载'));
    assert.equal(result.aborted, 2, '停止 ZIP 探测和未完成的大小查询');
    assert.equal(result.requests.filter(item => item.method === 'HEAD').length, 1);
});

test('原档：取消确认会停止大小查询且不保存文件和历史', async t => {
    const result = await download(t, { detail: true, holdHead: true, cancel: true });
    assert.equal(result.aborted, 2, '取消确认时不再保留大小查询');
    assert.equal(result.history.length, 0);
});

test('原档：付费申请只在确认后提交一次，开始下载时清除申请标记', async t => {
    const result = await download(t, { detail: true, paid: true });
    assert.equal(result.requests.filter(item => item.method === 'POST').length, 1);
    assert.equal(result.requests.filter(item => item.method === 'HEAD').length, 0);
    assert.equal(result.tab.ehtdCoordination151.archiveAttempts.length, 0);
    assert.equal(result.history.length, 1);
});

test('原档：取消付费确认不提交申请', async t => {
    const result = await download(t, { detail: true, paid: true, cancel: true });
    assert.equal(result.requests.filter(item => item.method === 'POST').length, 0);
    assert.equal(result.history.length, 0);
});

test('原档：ZIP 响应已有大小时直接显示，不重复 HEAD 请求', async t => {
    const result = await download(t, { detail: true, knownSize: true });
    assert.ok(result.confirmation.includes('10.0 MiB'));
    assert.equal(result.requests.filter(item => item.method === 'HEAD').length, 0);
});
