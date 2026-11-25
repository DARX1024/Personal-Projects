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
        window.GM_getResourceURL = () => 'data:font/woff2;base64,';
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

test('拉灯开关只切换留言板的深浅色：点击、键盘和下拉超过阈值都切换，拉得不够不切换，刷新后保留', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const theme = () => page.locator('.ytlc-panel').getAttribute('data-theme');
    const background = () => page.locator('.ytlc-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(await theme(), 'light');
    assert.equal(await background(), 'rgb(255, 255, 255)');
    await page.getByRole('button', { name: '关灯' }).click();
    await page.waitForFunction(() => document.querySelector('.ytlc-panel').dataset.theme === 'dark');
    assert.equal(await background(), 'rgb(15, 15, 15)');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('dark')), false);
    await page.getByRole('button', { name: '开灯' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.ytlc-panel').dataset.theme === 'light');

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
    assert.equal(await theme(), 'light');
    await pull(40);
    assert.equal(await theme(), 'dark');
    // 拖动后浏览器补发的 click 不会再切换一次。
    await page.waitForTimeout(300);
    assert.equal(await theme(), 'dark');

    const reloaded = await openPage(context, '/watch?v=abc');
    assert.equal(await reloaded.locator('.ytlc-panel').getAttribute('data-theme'), 'dark');
    assert.equal(await reloaded.evaluate(() => document.documentElement.hasAttribute('dark')), false);
});

test('没拉过开关时留言板跟随 YouTube 主题，拉过后保持自己的选择；减少动态效果时立即切换', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const theme = () => page.locator('.ytlc-panel').getAttribute('data-theme');
    await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
    await page.getByRole('button', { name: '开灯' }).waitFor();
    assert.equal(await theme(), 'dark');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '开灯' }).click();
    assert.equal(await theme(), 'light');
    assert.equal(await page.locator('.ytlc-cord').evaluate(el => el.getAnimations().length), 0);
    assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('dark')));
    await page.evaluate(() => document.documentElement.removeAttribute('dark'));
    await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
    assert.equal(await theme(), 'light');
});

test('右下角的皮肤选单向上弹出，可用键盘选择，选中后立即换皮肤并在刷新后保留', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const panel = page.locator('.ytlc-panel');
    const toggle = page.getByRole('button', { name: '更换皮肤' });
    const menu = page.getByRole('menu', { name: '皮肤' });
    assert.equal(await panel.getAttribute('data-skin'), 'default');
    // 默认皮肤不加载像素字体。
    assert.equal(await page.evaluate(() => [...document.styleSheets].some(sheet =>
        [...sheet.cssRules].some(rule => rule.cssText.startsWith('@font-face')))), false);

    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    const menuBox = await menu.boundingBox();
    const toggleBox = await toggle.boundingBox();
    assert.ok(menuBox.y + menuBox.height <= toggleBox.y, '选单在按钮上方');
    assert.ok(Math.abs(menuBox.x + menuBox.width - (toggleBox.x + toggleBox.width)) < 2, '选单与按钮右对齐');
    assert.deepEqual(await page.getByRole('menuitemradio').evaluateAll(items => items.map(item => item.dataset.skin)),
        ['default', 'rpg', 'night', 'paper']);
    assert.ok(await page.getByRole('menuitemradio', { name: /简洁/ }).evaluate(el => el === document.activeElement));

    await page.evaluate(() => {
        window.shortcuts = [];
        document.addEventListener('keydown', event => window.shortcuts.push(event.key));
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.equal(await panel.getAttribute('data-skin'), 'rpg');
    assert.ok(await menu.isHidden());
    assert.ok(await toggle.evaluate(el => el === document.activeElement));
    assert.deepEqual(await page.evaluate(() => window.shortcuts), [], '方向键不交给 YouTube');
    assert.match(await panel.evaluate(el => getComputedStyle(el).fontFamily), /YTLC Pixel/);
    assert.equal(await page.locator('.ytlc-bead svg.ytlc-sprite').count(), 1);

    await toggle.click();
    assert.equal(await page.getByRole('menuitemradio', { name: /RPG/ }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
    assert.ok(await menu.isHidden());
    await toggle.click();
    await page.locator('.ytlc-list').click();
    assert.ok(await menu.isHidden());

    await toggle.click();
    await page.getByRole('menuitemradio', { name: /方格笔记本/ }).click();
    const reloaded = await openPage(context, '/watch?v=abc');
    assert.equal(await reloaded.locator('.ytlc-panel').getAttribute('data-skin'), 'paper');
    assert.ok(await reloaded.locator('.ytlc-panel').evaluate(el => el.classList.contains('ytlc-pixel')));
});

test('像素吊坠随拉灯换成发光配色，三款皮肤的深浅色都有各自的背景', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const panel = page.locator('.ytlc-panel');
    const backgrounds = new Set();
    for (const name of [/RPG/, /月夜自习/, /方格笔记本/]) {
        await page.getByRole('button', { name: '更换皮肤' }).click();
        await page.getByRole('menuitemradio', { name }).click();
        for (let i = 0; i < 2; i++) {
            const fills = await page.locator('.ytlc-bead rect').evaluateAll(rects => rects.map(r => r.getAttribute('fill')).join());
            backgrounds.add(await panel.evaluate(el => getComputedStyle(el).backgroundColor));
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.locator('.ytlc-lamp').click();
            assert.notEqual(await page.locator('.ytlc-bead rect').evaluateAll(rects => rects.map(r => r.getAttribute('fill')).join()), fills);
        }
    }
    assert.equal(backgrounds.size, 6);
});

test('像素皮肤用标签显示疑问和重点，「重点」快捷标记不重复显示文字', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    await page.getByRole('button', { name: '⭐ 重点' }).click();
    const words = page.locator('.ytlc-note .ytlc-words');
    assert.ok(await words.isVisible());
    await page.getByRole('button', { name: '更换皮肤' }).click();
    await page.getByRole('menuitemradio', { name: /月夜自习/ }).click();
    assert.ok(await words.isHidden());
    assert.equal(await page.locator('.ytlc-note .ytlc-text').evaluate(el => getComputedStyle(el, '::before').content), '"重点"');
});

test('只看结尾问号：结尾有问号是疑问，其余（包括问号开头）都是想法', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const input = page.getByRole('textbox', { name: '发送留言' });
    for (const text of ['这一步为什么成立？', '为什么成立?  ', '?这里的符号写错了', '可以把它当成 KV cache 的压缩']) {
        await input.fill(text);
        await input.press('Enter');
    }
    assert.deepEqual(await page.locator('.ytlc-note').evaluateAll(items => items.map(item => item.dataset.kind)),
        ['question', 'question', 'note', 'note']);
    await page.getByRole('button', { name: '复制' }).click();
    assert.match(await page.evaluate(() => window.clipboard), /\*\*想法\*\* \?这里的符号写错了/);
});

test('「💡 想法」先在当前时间占位，接着输入的文字补进这条留言，时间戳不变', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    const input = page.getByRole('textbox', { name: '发送留言' });
    const notes = page.locator('.ytlc-note');
    await page.evaluate(() => play(600));
    await page.getByRole('button', { name: '💡 想法' }).click();
    assert.equal(await notes.count(), 1);
    assert.equal(await notes.getAttribute('data-kind'), 'note');
    assert.ok(await input.evaluate(el => el === document.activeElement));
    assert.equal(await page.locator('.ytlc-anchor').innerText(), '💡 10:00');

    await page.evaluate(() => play(640));
    await input.pressSequentially('能不能用在扩散模型上？');
    await input.press('Enter');
    assert.equal(await notes.count(), 1);
    assert.equal(await notes.locator('.ytlc-time').innerText(), '10:00');
    assert.equal(await notes.locator('.ytlc-words').innerText(), '能不能用在扩散模型上？');
    assert.equal(await notes.getAttribute('data-kind'), 'note', '点了想法按钮的留言不按问号改成疑问');
    assert.ok(await page.locator('.ytlc-anchor').isHidden());

    // 占位后不写，按 Esc 放弃补写，占位留言保留；之后的输入另起一条。
    await page.evaluate(() => play(700));
    await page.getByRole('button', { name: '💡 想法' }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => play(720));
    await input.fill('另一条');
    await input.press('Enter');
    assert.deepEqual(await page.locator('.ytlc-time').allInnerTexts(), ['10:00', '11:40', '12:00']);

    // 补写中删除占位留言：草稿保留，按普通留言发送。
    await page.evaluate(() => play(800));
    await page.getByRole('button', { name: '💡 想法' }).click();
    await input.pressSequentially('草稿');
    await notes.nth(3).hover();
    await notes.nth(3).getByRole('button', { name: '删除这条留言' }).click();
    assert.equal(await page.locator('.ytlc-anchor').innerText(), '⏱ 13:20');
    await input.press('Enter');
    assert.deepEqual(await page.locator('.ytlc-words').allInnerTexts(), ['能不能用在扩散模型上？', '想法', '另一条', '草稿']);

    // 像素皮肤：只占位未补写的留言只显示「想法」标签，不重复文字。
    await page.getByRole('button', { name: '更换皮肤' }).click();
    await page.getByRole('menuitemradio', { name: /RPG/ }).click();
    assert.ok(await page.locator('.ytlc-words', { hasText: /^想法$/ }).isHidden());
    assert.equal(await notes.nth(1).locator('.ytlc-text').evaluate(el => getComputedStyle(el, '::before').content), '"想法"');
});

test('台灯吊坠浅色时点亮、深色时熄灭，血瓶和星星深色时发光', async t => {
    const context = await newContext(t);
    const page = await openPage(context, '/watch?v=abc');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const lit = () => page.locator('.ytlc-bead').evaluate(el => el.classList.contains('ytlc-lit') &&
        getComputedStyle(el.querySelector('.ytlc-sprite')).filter !== 'none');
    const expected = { RPG: [false, true], 月夜自习: [false, true], 方格笔记本: [true, false] };
    for (const [name, [inLight, inDark]] of Object.entries(expected)) {
        await page.getByRole('button', { name: '更换皮肤' }).click();
        await page.getByRole('menuitemradio', { name: new RegExp(name) }).click();
        if (await page.locator('.ytlc-panel').getAttribute('data-theme') === 'dark') await page.locator('.ytlc-lamp').click();
        assert.equal(await lit(), inLight, `${name} 浅色`);
        await page.locator('.ytlc-lamp').click();
        assert.equal(await lit(), inDark, `${name} 深色`);
    }
});
