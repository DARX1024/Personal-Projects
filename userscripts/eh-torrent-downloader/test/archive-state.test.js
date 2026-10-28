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

async function setup(t, { detail = true, confirm = false, fetch, settings = {} } = {}) {
    const page = load(detail ? gallery : `${searchForm}<table class="itg">${galleryRow(123)}</table>`, {
        url: detail ? 'https://exhentai.org/g/123/abcdef0123/' : 'https://exhentai.org/', readyState: 'complete',
        settings: { confirmArchiveCost: confirm, ...settings },
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

test('review：已提供下载链接时，普通 Please wait 文案不应使流程停在原页', () => {
    assert.deepEqual(m.parseArchive(`<p>Please wait while your download starts.</p><a href="${zip}">Original</a>`, archiver, list),
        { next: zip, waitMs: 0 });
});

test('review：关闭窗口等无关定时器不能延迟已就绪下载或覆盖实际 30 秒轮询', () => {
    const unrelated = '<script>setTimeout("window.close()", 600000);</script>';
    assert.deepEqual(m.parseArchive(`<a href="${zip}">Original</a>${unrelated}`, archiver, list), { next: zip, waitMs: 0 });
    assert.deepEqual(m.parseArchive(processing + unrelated, pending, list), { next: pending, waitMs: 30000 });
});

test('review：详情页取消重复下载时，不应提前请求归档页', async t => {
    const page = await setup(t, { settings: { downloadedTorrents: [{ id: '123:archive:org', gid: '123',
        title: '日本語の題名', keys: [], at: Date.now() }] } });
    page.anchor.click();
    await until(page, () => page.dialogs.length === 1, '展示重复提醒');
    assert.ok(page.dialogs[0].textContent.includes('重复'));
    assert.equal(page.fetches.length, 0);
    [...page.dialogs[0].querySelectorAll('button')].find(button => button.textContent.includes('取消')).click();
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '取消后结束');
    assert.equal(page.xhrs.length, 0);
    assert.equal(page.saves.length, 0);
});

test('review：并行预读已返回限流时，即使详情页给出不同归档参数也必须停止', async t => {
    let resolveTitle;
    const page = await setup(t, { detail: false, fetch: url => new URL(url).pathname.startsWith('/g/')
        ? new Promise(resolve => { resolveTitle = resolve; })
        : new Response('Too many requests', { status: 429 }) });
    page.anchor.click();
    await until(page, () => page.fetches.length === 2, '已并行开始');
    await page.flush();
    resolveTitle(new Response(gallery.replace('token=abcdef0123', 'token=abcdef0123&or=example')));
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '限流后结束');
    assert.equal(page.fetches.length, 2, '不能在收到 429 后向新归档地址继续请求');
    assert.equal(page.xhrs.length, 0);
    assert.equal(page.saves.length, 0);
});

test('review：去掉中转延时后，循环跳转必须提前停止，避免连续请求 60 次', async t => {
    const first = 'https://exhentai.org/archive/123/example/a?start=1';
    const second = 'https://exhentai.org/archive/123/example/b?start=1';
    const page = await setup(t, { fetch: () => new Response(`<a href="${first}">Original</a>`) });
    page.window.GM_xmlhttpRequest = options => {
        page.xhrs.push({ options });
        queueMicrotask(() => options.onload({ status: 200, finalUrl: options.url, responseHeaders: 'content-type: text/html',
            responseText: `<a href="${options.url === first ? second : first}">Original</a>` }));
        return { abort() {} };
    };
    page.anchor.click();
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '循环应立即结束');
    assert.equal(page.xhrs.length, 2);
    assert.equal(page.saves.length, 0);
});

test('review：详情页给出不同归档参数时，停止未完成预读并正常显示新入口的费用', async t => {
    let previewAborted = false;
    const page = await setup(t, { detail: false, confirm: true, fetch: (url, options) => {
        if (new URL(url).pathname.startsWith('/g/')) return new Response(gallery.replace('token=abcdef0123', 'token=abcdef0123&or=example'));
        if (new URL(url).searchParams.has('or')) return new Response(form);
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
            previewAborted = true; reject(new Error('Aborted preview'));
        }, { once: true }));
    } });
    page.anchor.click();
    await until(page, () => page.dialogs.length === 1, '旧请求取消后新归档页面可用');
    assert.equal(previewAborted, true);
    assert.equal(page.fetches.length, 3);
    assert.ok(page.fetches.at(-1).url.includes('or=example'));
    assert.ok(page.dialogs[0].textContent.includes('10 GP'));
    [...page.dialogs[0].querySelectorAll('button')].find(button => button.textContent === '取消下载').click();
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '费用取消后结束');
    assert.equal(page.xhrs.length, 0);
    assert.equal(page.saves.length, 0);
});

test('review：等待文案未识别时，文件地址仍保留 gotonext 和 meta refresh 的网站延时', () => {
    const queued = processing.replace('The file is already being processed. Please contact staff if it is not ready within a few minutes.', 'Your archive is queued.');
    assert.equal(m.parseArchive(queued, pending, list).waitMs, 30000);
    assert.equal(m.parseArchive('<meta http-equiv="refresh" content="30"><p>Queued.</p><a href="?start=1">Click Here To Start Downloading</a>', pending, list).waitMs, 30000);
});

test('review：gotonext 定时器的常见写法都按网站延时等待', () => {
    for (const timer of ['setTimeout("gotonext();", 30000)', "setTimeout('gotonext()', 30000)", 'setTimeout(gotonext, 30000)',
        'setTimeout(function(){ gotonext(); }, 30000)', 'setTimeout(() => gotonext(), 30000)', 'setTimeout(() => { gotonext(); }, 30000)']) {
        assert.equal(m.parseArchive(processing.replace('setTimeout("gotonext()", 30000)', timer), pending, list).waitMs, 30000, timer);
    }
    assert.equal(m.parseArchive(processing.replace('setTimeout("gotonext()", 30000)', 'setTimeout(function(){ window.close(); }, 600000)'), pending, list).waitMs, 3000);
});

test('review：准备页按网站给出的短延时继续，不再强制补足 1 秒', () => {
    const locating = (timer) => `<p>Locating archive server and preparing file for download...</p>
<p id="continue"><a href="https://test.hath.network/archive/example/job?autostart=1">Click here</a></p>
<script>function gotonext() { document.location = "https://test.hath.network/archive/example/job?autostart=1"; } ${timer}</script>`;
    assert.equal(m.parseArchive(locating('setTimeout("gotonext()", 0);'), archiver, list).waitMs, 0);
    assert.equal(m.parseArchive(locating('setTimeout("gotonext()", 500);'), archiver, list).waitMs, 500);
    assert.equal(m.parseArchive(locating(''), archiver, list).waitMs, 3000, '无网站延时时仍用 3 秒默认值');
});

test('review：准备页指向下载服务器 autostart 时直接改为 start=1；站内处理页地址不改', () => {
    const page = `<p>Locating archive server and preparing file for download...</p>
<p id="continue"><a href="https://test.hath.network/archive/example/job?autostart=1">Click here</a></p>
<script>function gotonext() { document.location = "https://test.hath.network/archive/example/job?autostart=1"; } setTimeout("gotonext()", 1);</script>`;
    assert.deepEqual(m.parseArchive(page, archiver, list), { next: 'https://test.hath.network/archive/example/job?start=1', waitMs: 1 });
    assert.equal(new URL(m.parseArchive(processing, pending, list).next).searchParams.has('start'), false);
});

async function shortDelayFlow(t, reply) {
    const page = await setup(t, { fetch: () => new Response(reply('https://exhentai.org/archiver.php?gid=123&token=abcdef0123')) });
    page.window.GM_xmlhttpRequest = options => {
        page.xhrs.push({ options });
        queueMicrotask(() => options.onload({ status: 200, finalUrl: options.url, responseHeaders: 'content-type: text/html', responseText: reply(options.url) }));
        return { abort() {} };
    };
    page.anchor.click();
    return page;
}

test('review：页面指向自身且网站延时极短时，仍至少隔 3 秒检查', async t => {
    const self = 'https://test.hath.network/archive/example/job?start=1';
    const html = `<p>Please wait</p><p id="continue"><a href="${self}">Click</a></p><script>setTimeout("gotonext()", 1);</script>`;
    const page = await shortDelayFlow(t, () => html);
    await until(page, () => page.polls().some(item => item.ms === 3000) && page.xhrs.length === 1, '同址检查前等待 3 秒');
    assert.equal(page.xhrs.length, 1);
});

test('review：两个页面以极短延时互跳时，循环检测仍能停止', async t => {
    const a = 'https://test.hath.network/archive/example/a?start=1', b = 'https://test.hath.network/archive/example/b?start=1';
    const page = await shortDelayFlow(t, url => `<p>Please wait</p><p id="continue"><a href="${url === a ? b : a}">Click</a></p><script>setTimeout("gotonext()", 1);</script>`);
    await until(page, () => !page.anchor.hasAttribute('aria-busy'), '循环应很快结束');
    assert.ok(page.xhrs.length <= 3, `请求了 ${page.xhrs.length} 次`);
    assert.equal(page.saves.length, 0);
});
