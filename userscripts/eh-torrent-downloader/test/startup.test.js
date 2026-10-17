'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, searchForm, galleryRow, detailMenu, listPath } = require('./browser-helpers');

for (const host of ['e-hentai.org', 'exhentai.org']) {
    test(`${host}：页面仍在 loading、扩展登记无响应时也显示搜索操作和原档按钮`, async t => {
        const page = load(`${searchForm}<table class="itg">${galleryRow(123)}</table>`,
            { url: `https://${host}/`, stalledTabs: true });
        t.after(page.close);
        await page.flush();
        assert.equal(page.document.readyState, 'loading');
        assert.equal(page.document.querySelectorAll('#ehtd-search-tools a').length, 2);
        assert.equal(page.document.querySelectorAll('a[data-ehtd-archive]').length, 1);
        assert.equal(page.document.querySelector('a[data-ehtd-list]').href, `https://${host}${listPath(123)}`);
        assert.equal(page.stats.resourceReads, 0);
        assert.equal(page.requests.length, 0);
    });
}

test('document-start：根节点尚未创建，随后分段插入的搜索结果仍可增强', async t => {
    const page = load('', { empty: true });
    t.after(page.close);
    await page.flush();
    const html = page.document.createElement('html');
    html.innerHTML = `<head></head><body>${searchForm}<table class="itg"><tbody></tbody></table></body>`;
    page.document.append(html);
    await page.flush();
    page.document.querySelector('tbody').insertAdjacentHTML('beforeend', galleryRow(123));
    await page.flush();
    assert.equal(page.document.querySelectorAll('#ehtd-search-tools a').length, 2);
    assert.equal(page.document.querySelectorAll('a[data-ehtd-archive]').length, 1);
    assert.equal(page.requests.length, 0);
});

test('详情页：菜单先出现即可使用，迟到的种子与原档入口也能补齐', async t => {
    const page = load('<h1 id="gn">Example</h1>', { url: 'https://exhentai.org/g/123/abcdef0123/' });
    t.after(page.close);
    await page.flush();
    page.document.body.insertAdjacentHTML('beforeend', detailMenu);
    await page.flush();
    assert.equal(page.document.querySelector('a[data-ehtd-archive]').textContent, '下载原档 ZIP');
    assert.equal(page.document.querySelectorAll('a[data-ehtd-metadata]').length, 1);
    assert.ok(page.document.querySelector('#gd5 a[data-ehtd-list]'));
    assert.ok(page.document.querySelector('#gd5 a[href*="archiver.php"]:not([data-ehtd-archive])'));
    const menus = page.menus.length;
    page.ready();
    await page.flush();
    page.window.dispatchEvent(new page.window.PageTransitionEvent('pageshow', { persisted: true }));
    await page.flush();
    assert.equal(page.document.querySelectorAll('a[data-ehtd-archive]').length, 1);
    assert.equal(page.document.querySelectorAll('a[data-ehtd-metadata]').length, 1);
    assert.equal(page.menus.length, menus);
    assert.equal(page.requests.length, 0);
});

test('动态列表：合并同批变动，按钮注入后停止扫描，换页与链接变更仍有效', async t => {
    const page = load(`${searchForm}<table class="itg"><tbody></tbody></table>`, { readyState: 'complete' });
    t.after(page.close);
    await page.flush();
    const body = page.document.querySelector('tbody');
    page.stats.queries = 0;
    // 同一批既有父节点又有后续子节点变动，不能对整行重复增强。
    for (let gid = 1; gid <= 40; gid++) {
        body.insertAdjacentHTML('beforeend', galleryRow(gid));
        body.lastElementChild.querySelector('.glink').insertAdjacentHTML('beforeend', '<span> English</span>');
    }
    await page.flush();
    const scans = page.stats.queries;
    assert.ok(scans < 800, `40 行更新发生 ${scans} 次 DOM 查询`);
    assert.equal(page.document.querySelectorAll('a[data-ehtd-archive]').length, 40);
    page.stats.queries = 0;
    await page.flush();
    assert.equal(page.stats.queries, 0, '没有页面变动时不应继续扫描');
    const row = body.firstElementChild;
    for (const link of row.querySelectorAll('a[href*="/g/"]')) link.href = '/g/999/abcdef0123/';
    row.querySelector('a[data-ehtd-list]').href = listPath(999);
    await page.flush();
    assert.equal(row.querySelectorAll('a[data-ehtd-archive]').length, 1);
    assert.equal(row.querySelector('a[data-ehtd-archive]').dataset.ehtdArchive,
        `https://exhentai.org${listPath(999)}`);
    body.innerHTML = galleryRow(777);
    await page.flush();
    assert.equal(page.document.querySelectorAll('a[data-ehtd-archive]').length, 1);
    assert.equal(page.requests.length, 0);
});

test('自动下载：等题名和页面解析完成再启动，DOMContentLoaded 与缓存恢复不重复下载', async t => {
    const page = load(detailMenu, { url: 'https://exhentai.org/g/123/abcdef0123/', auto: true });
    t.after(page.close);
    await page.flush();
    assert.equal(page.requests.length, 0);
    assert.ok(page.document.querySelector('a[data-ehtd-list]'));
    page.document.body.insertAdjacentHTML('beforeend', '<h1 id="gn">Example title</h1>');
    page.ready();
    await page.flush();
    assert.equal(page.requests.length, 1);
    assert.match(page.requests[0].url, /gallerytorrents\.php/);
    page.ready();
    page.window.dispatchEvent(new page.window.PageTransitionEvent('pageshow', { persisted: true }));
    await page.flush();
    assert.equal(page.requests.length, 1);
});

test('nhentai：已有 metadata 按钮同样不等待 DOMContentLoaded', async t => {
    const page = load('<div id="info"><div id="download-wrapper"><a id="download">Download</a></div></div>',
        { url: 'https://nhentai.net/g/42/' });
    t.after(page.close);
    await page.flush();
    assert.equal(page.document.querySelectorAll('button[data-ehtd-nh-metadata]').length, 1);
    page.ready();
    await page.flush();
    assert.equal(page.document.querySelectorAll('button[data-ehtd-nh-metadata]').length, 1);
    assert.equal(page.requests.length, 0);
});
