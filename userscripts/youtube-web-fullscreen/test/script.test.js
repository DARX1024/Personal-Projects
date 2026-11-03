'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright-core');

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome' }); });
after(async () => { await browser?.close(); });

const player = `<ytd-player><div id="movie_player" tabindex="0">
    <div class="html5-video-container"><video></video></div>
    <div class="ytp-right-controls"><button class="ytp-size-button">剧场模式</button><button class="ytp-fullscreen-button">全屏</button></div>
</div></ytd-player>`;

async function openPage(t, pathname) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    t.after(() => page.close());
    await page.route('https://www.youtube.com/**', route => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><style>
            body { margin: 0; min-height: 200vh }
            header { position: fixed; inset: 0 0 auto; height: 55px; background: white; z-index: 100 }
            ytd-watch-flexy { display: block; margin-top: 60px; width: 640px; overflow: hidden; transform: translateZ(0) }
            ytd-player { display: block; height: 360px }
            #movie_player { width: 100%; height: 100%; position: relative }
            .ytp-right-controls { position: absolute; bottom: 0; right: 0 }
        </style><header>搜索</header><ytd-watch-flexy>${player}</ytd-watch-flexy><h1>视频标题</h1>`,
    }));
    await page.goto('https://www.youtube.com' + pathname);
    await page.evaluate(() => {
        window.GM_addStyle = css => {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.append(style);
        };
    });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'youtube-web-fullscreen.user.js') });
    return page;
}

test('网页全屏覆盖导航栏，随窗口缩放，Esc 和按钮均可恢复', async t => {
    const page = await openPage(t, '/watch?v=1');
    const movie = page.locator('#movie_player');
    const button = page.getByRole('button', { name: '网页全屏' });
    const original = await movie.boundingBox();
    await page.evaluate(() => {
        window.originalVideo = document.querySelector('video');
        // 模拟 YouTube 在窗口 resize 时更新控制栏行内宽度的行为。
        window.addEventListener('resize', () => {
            document.querySelector('.ytp-right-controls').style.width =
                document.querySelector('#movie_player').clientWidth + 'px';
        });
    });
    await button.click();
    assert.deepEqual(await movie.boundingBox(), { x: 0, y: 0, width: 1200, height: 800 });
    assert.equal(await page.locator('.ytp-right-controls').evaluate(el => el.clientWidth), 1200);
    assert.ok(await page.evaluate(() => !document.fullscreenElement &&
        document.querySelector('#movie_player').contains(document.elementFromPoint(2, 2))));
    await page.setViewportSize({ width: 900, height: 600 });
    assert.deepEqual(await movie.boundingBox(), { x: 0, y: 0, width: 900, height: 600 });
    await page.keyboard.press('Escape');
    assert.deepEqual(await movie.boundingBox(), original);
    assert.equal(await page.locator('.ytp-right-controls').evaluate(el => el.clientWidth), original.width);
    await button.click();
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.ok(await page.evaluate(() => document.querySelector('video') === window.originalVideo));
});

test('站内导航和控制栏重建后仍可切换，离开观看页解除滚动锁定', async t => {
    const page = await openPage(t, '/');
    const button = page.locator('.ytwf-button');
    assert.ok(await page.locator('.ytp-size-button').isVisible());
    assert.equal(await button.count(), 0);
    await page.evaluate(() => {
        history.pushState(null, '', '/watch?v=1');
        document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await button.click();
    await page.evaluate(() => {
        const controls = document.querySelector('.ytp-right-controls');
        controls.replaceChildren(controls.querySelector('.ytp-fullscreen-button').cloneNode(true));
    });
    await button.waitFor();
    assert.equal(await button.count(), 1);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await page.goBack();
    await button.waitFor({ state: 'detached' });
    assert.ok(await page.evaluate(() => !document.querySelector('[popover]') &&
        getComputedStyle(document.documentElement).overflow !== 'hidden'));
});

test('网页全屏占用剧场按钮的位置，提示跟随状态，减少动态效果时跳过动画', async t => {
    const page = await openPage(t, '/watch?v=1');
    const button = page.locator('.ytwf-button');
    const hint = button.locator('.ytwf-hint');
    assert.equal(await page.locator('.ytwf-button + .ytp-size-button').count(), 1);
    assert.ok(await page.locator('.ytp-size-button').isHidden());
    assert.ok(await page.getByRole('button', { name: '全屏', exact: true }).isVisible());
    await button.hover();
    await hint.waitFor();
    assert.equal(await hint.innerText(), '网页全屏');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const toggleAndCountAnimations = () => button.evaluate(el => {
        el.click();
        return el.closest('#movie_player').querySelector('.html5-video-container').getAnimations().length;
    });
    assert.equal(await toggleAndCountAnimations(), 0);
    await button.hover();
    assert.match(await hint.innerText(), /退出网页全屏\s*Esc/);
    assert.equal(await button.locator('.ytwf-arrow').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await toggleAndCountAnimations(), 1);
});
