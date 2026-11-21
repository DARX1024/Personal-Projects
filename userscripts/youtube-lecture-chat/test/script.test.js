'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright-core');

let browser;
// 默认使用本机 Chrome；没有 Chrome 时可用 CHROME_PATH 指定 Chromium。
before(async () => {
    browser = await chromium.launch(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : { channel: 'chrome' });
});
after(async () => { await browser?.close(); });

const watchPage = `<!doctype html><meta charset="utf-8"><title>Context Window 是什么 - YouTube</title>
<ytd-watch-flexy>
  <div id="primary">
    <ytd-player><div id="movie_player" tabindex="0">
      <div class="html5-video-container"><video></video></div>
      <div class="ytp-caption-window-container"></div>
    </div></ytd-player>
    <ytd-watch-metadata><h1>Context Window 是什么</h1>
      <ytd-channel-name><a href="#">Hung-yi Lee</a></ytd-channel-name></ytd-watch-metadata>
  </div>
  <div id="secondary"><div id="secondary-inner">
    <div id="related"><a class="rec">推荐视频</a></div>
  </div></div>
</ytd-watch-flexy>`;

async function newContext(t) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    t.after(() => context.close());
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: watchPage }));
    return context;
}

async function openPage(context, pathname) {
    const page = await context.newPage();
    await page.goto('https://www.youtube.com' + pathname);
    await page.evaluate(() => {
        window.GM_addStyle = css => document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
        window.GM_getValue = (key, fallback) => {
            const raw = localStorage.getItem('gm:' + key);
            return raw === null ? fallback : JSON.parse(raw);
        };
        window.GM_setValue = (key, value) => localStorage.setItem('gm:' + key, JSON.stringify(value));
        window.GM_deleteValue = key => localStorage.removeItem('gm:' + key);
        window.GM_setClipboard = text => { window.clipboard = text; };
        // 无片源的 video 无法播放，用可写属性模拟播放进度。
        const video = document.querySelector('video');
        let time = 0;
        Object.defineProperty(video, 'currentTime', { get: () => time, set: value => { time = value; } });
        window.play = (t, ...lines) => {
            time = t;
            document.querySelector('.ytp-caption-window-container').replaceChildren(...lines.map(text =>
                Object.assign(document.createElement('span'), { className: 'ytp-caption-segment', textContent: text })));
            video.dispatchEvent(new Event('timeupdate'));
        };
    });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'youtube-lecture-chat.user.js') });
    return page;
}

test('留言板替换推荐视频，按钮可恢复推荐并记住选择', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const panel = page.locator('#secondary-inner > .ytlc-panel:first-child');
    await panel.waitFor();
    assert.ok(await page.locator('#related').isHidden());
    await page.getByRole('button', { name: '推荐' }).click();
    assert.ok(await page.locator('#related').isVisible());
    const again = await openPage(context, '/watch?v=abc');
    assert.ok(await again.locator('#related').isVisible());
    assert.equal(await again.getByRole('button', { name: '推荐' }).getAttribute('aria-pressed'), 'true');
});

test('时间戳锚定在开始输入时，输入法组字时回车不发送，Shift+Enter 换行', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const input = page.getByRole('textbox', { name: '发送留言' });
    await page.evaluate(() => play(100));
    await input.click();
    await input.pressSequentially('为什么');
    assert.equal(await page.locator('.ytlc-anchor').innerText(), '⏱ 1:40');
    await page.evaluate(() => play(130));
    await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    assert.equal(await page.locator('.ytlc-note').count(), 0);
    await input.press('Shift+Enter');
    await input.pressSequentially('有限？');
    await input.press('Enter');
    assert.equal(await input.inputValue(), '');
    assert.ok(await page.locator('.ytlc-anchor').isHidden());
    const note = page.locator('.ytlc-note');
    assert.equal(await note.locator('.ytlc-time').innerText(), '1:40');
    assert.equal(await note.locator('.ytlc-text').innerText(), '为什么\n有限？');
    assert.equal(await note.getAttribute('data-kind'), 'question');
    // 只有空格时不发送；清空后锚点解除，下一条使用新的时间。
    await input.pressSequentially('  ');
    await input.press('Enter');
    assert.equal(await note.count(), 1);
});

test('留言附带字幕上下文，按视频时间排序，可跳转、删除，复制为 Markdown 并在刷新后保留', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    await page.evaluate(() => {
        play(1400, '今天讲 context window');
        play(1405, '今天讲 context window', '語言模型的輸入長度是有限的');
        play(1412, '語言模型的輸入長度是有限的');
    });
    await page.getByRole('button', { name: '？没懂' }).click();
    await page.evaluate(() => play(1500));
    await page.getByRole('button', { name: '⭐ 重点' }).click();
    await page.evaluate(() => play(60));
    const input = page.getByRole('textbox', { name: '发送留言' });
    await input.fill('开头的例子挺好');
    await input.press('Enter');
    assert.deepEqual(await page.locator('.ytlc-time').allInnerTexts(), ['1:00', '23:32', '25:00']);
    assert.equal(await page.locator('.ytlc-note').nth(1).locator('.ytlc-context').innerText(), '字幕：語言模型的輸入長度是有限的');

    await page.locator('.ytlc-time', { hasText: '23:32' }).click();
    assert.equal(await page.evaluate(() => document.querySelector('video').currentTime), 1412);

    await page.getByRole('button', { name: '复制' }).click();
    const markdown = await page.evaluate(() => window.clipboard);
    assert.match(markdown, /^# 听课留言：Context Window 是什么\n/);
    assert.match(markdown, /- 频道：Hung-yi Lee/);
    assert.match(markdown, /- \[1:00\]\(https:\/\/www\.youtube\.com\/watch\?v=abc&t=60s\) \*\*想法\*\* 开头的例子挺好/);
    assert.match(markdown, /- \[23:32\]\(.*&t=1412s\) \*\*疑问\*\* 没听懂\n  - 字幕：今天讲 context window \/ 語言模型的輸入長度是有限的\n/);
    assert.match(markdown, /&t=1500s\) \*\*重点\*\*\n/);
    assert.equal(await page.getByRole('button', { name: '已复制' }).count(), 1);

    await page.locator('.ytlc-note').first().hover();
    await page.getByRole('button', { name: '删除这条留言' }).first().click();
    const reloaded = await openPage(context, '/watch?v=abc');
    assert.deepEqual(await reloaded.locator('.ytlc-time').allInnerTexts(), ['23:32', '25:00']);
});

test('站内切换视频时留言各自独立，离开观看页移除留言板并恢复推荐', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const input = page.getByRole('textbox', { name: '发送留言' });
    await input.fill('第一讲');
    await input.press('Enter');
    const navigate = url => page.evaluate(href => {
        history.pushState(null, '', href);
        document.dispatchEvent(new Event('yt-navigate-finish'));
    }, url);
    await navigate('/watch?v=def');
    assert.equal(await page.locator('.ytlc-note').count(), 0);
    await input.fill('第二讲');
    await input.press('Enter');
    await navigate('/watch?v=abc');
    assert.deepEqual(await page.locator('.ytlc-text').allInnerTexts(), ['第一讲']);
    await navigate('/');
    assert.equal(await page.locator('.ytlc-panel').count(), 0);
    assert.ok(await page.evaluate(() => !document.documentElement.classList.contains('ytlc-hide-related')));
});

test('反引号键聚焦输入框，输入框内按键不触发 YouTube 快捷键，Esc 交还给播放器', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    await page.evaluate(() => {
        window.shortcuts = [];
        document.addEventListener('keydown', event => window.shortcuts.push(event.key));
    });
    await page.locator('#movie_player').focus();
    await page.keyboard.press('Backquote');
    const input = page.getByRole('textbox', { name: '发送留言' });
    assert.ok(await input.evaluate(el => el === document.activeElement));
    await page.keyboard.type('kjf');
    assert.equal(await input.inputValue(), 'kjf');
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.activeElement.id === 'movie_player'));
    assert.deepEqual(await page.evaluate(() => window.shortcuts), []);
});

test('拉灯开关：点击、键盘和下拉超过阈值都切换深浅色，拉得不够不切换，选择刷新后保留', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const dark = () => page.evaluate(() => document.documentElement.hasAttribute('dark'));
    await page.getByRole('button', { name: '关灯' }).click();
    await page.waitForFunction(() => document.documentElement.hasAttribute('dark'));
    const lamp = page.getByRole('button', { name: '开灯' });
    await lamp.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.documentElement.hasAttribute('dark'));

    const pull = async distance => {
        const box = await page.locator('.ytlc-lamp').boundingBox();
        const x = box.x + box.width / 2;
        await page.mouse.move(x, box.y + 30);
        await page.mouse.down();
        await page.mouse.move(x, box.y + 30 + distance, { steps: 5 });
        await page.mouse.up();
    };
    await pull(6);
    await page.waitForTimeout(200);
    assert.equal(await dark(), false);
    await pull(40);
    assert.equal(await dark(), true);
    // 拖动后浏览器补发的 click 不会再切换一次。
    await page.waitForTimeout(300);
    assert.equal(await dark(), true);

    const reloaded = await openPage(context, '/');
    assert.ok(await reloaded.evaluate(() => document.documentElement.hasAttribute('dark')));
});

test('在 YouTube 菜单里换主题后以 YouTube 为准，开关状态同步，减少动态效果时立即切换', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '关灯' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('dark') &&
        document.querySelector('.ytlc-cord').getAnimations().length === 0));
    await page.evaluate(() => document.documentElement.removeAttribute('dark'));
    await page.getByRole('button', { name: '关灯' }).waitFor();
    const reloaded = await openPage(context, '/watch?v=abc');
    assert.equal(await reloaded.evaluate(() => document.documentElement.hasAttribute('dark')), false);
});
