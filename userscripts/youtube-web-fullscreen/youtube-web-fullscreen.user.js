// ==UserScript==
// @name         YouTube 网页全屏
// @namespace    https://github.com/DARX1024/Personal-Projects
// @version      1.2.2
// @description  让 YouTube 播放器占满当前标签页，按 Esc 回到原来的观看布局；控制栏加一个 1.25 倍速快捷按钮。
// @author       DARX1024
// @match        https://www.youtube.com/*
// @noframes
// @grant        GM_addStyle
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-web-fullscreen/youtube-web-fullscreen.user.js
// @updateURL    https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-web-fullscreen/youtube-web-fullscreen.user.js
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '1.2.2';
    const FAST_RATE = 1.25;
    const watchPlayer = ':is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) ytd-player #movie_player';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let activeHost = null;

    GM_addStyle(`
        html.ytwf-active, html.ytwf-active body {
            overflow: hidden !important;
        }
        html.ytwf-active ytd-player:popover-open {
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
            max-height: none !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: #000 !important;
        }
        ${watchPlayer}:has(.ytwf-button) .ytp-size-button {
            display: none !important;
        }
        #movie_player .ytp-button:is(.ytwf-button, .ytwf-speed) {
            position: relative;
            overflow: visible;
        }
        #movie_player .ytp-button.ytwf-speed {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: top;
            width: auto;
            min-width: 48px;
            padding: 0 4px;
            color: inherit;
        }
        /* 不显示 YouTube 给 aria-pressed 按钮加的红色短条，状态只由胶囊表达。 */
        #movie_player .ytp-button.ytwf-speed::after {
            display: none !important;
        }
        /* 关闭时是白色描边胶囊，与网页全屏图标的线框一致；开启时填成深色。 */
        .ytwf-speed-chip {
            display: inline-flex;
            align-items: center;
            height: 24px;
            padding: 0 8px;
            box-sizing: border-box;
            border: 2px solid rgb(255 255 255 / 85%);
            border-radius: 12px;
            font: 600 12.5px/1 "YouTube Noto", Roboto, Arial, sans-serif;
            font-variant-numeric: tabular-nums;
            letter-spacing: .2px;
            transition: background-color 160ms ease-out, border-color 160ms ease-out;
        }
        .ytwf-speed:is(:hover, :focus-visible) .ytwf-speed-chip {
            background-color: rgb(255 255 255 / 16%);
        }
        .ytwf-speed[aria-pressed="true"] .ytwf-speed-chip {
            border-color: transparent;
            background-color: rgb(15 15 15 / 72%);
        }
        .ytwf-speed[aria-pressed="true"]:is(:hover, :focus-visible) .ytwf-speed-chip {
            background-color: rgb(15 15 15 / 85%);
        }
        .ytwf-button svg :is(rect, path) {
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .ytwf-arrow {
            transform-origin: 12px 12px;
            transition: transform 180ms cubic-bezier(.2, 0, 0, 1);
        }
        .ytwf-button:is(:hover, :focus-visible) .ytwf-arrow {
            transform: translate(1px, -1px);
        }
        .ytwf-button[aria-pressed="true"] .ytwf-arrow {
            transform: rotate(180deg);
        }
        .ytwf-button[aria-pressed="true"]:is(:hover, :focus-visible) .ytwf-arrow {
            transform: translate(-1px, 1px) rotate(180deg);
        }
        .ytwf-hint {
            position: absolute;
            left: 50%;
            bottom: calc(100% + 20px);
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 5px 9px;
            border-radius: 8px;
            background: rgb(20 20 20 / 85%);
            color: white;
            font: 500 13px/17px "YouTube Noto", Roboto, Arial, sans-serif;
            white-space: nowrap;
            pointer-events: none;
            visibility: hidden;
            opacity: 0;
            transform: translate(-50%, 3px);
            transition: opacity 160ms ease-out, transform 160ms ease-out, visibility 160ms;
        }
        :is(.ytwf-button, .ytwf-speed):is(:hover, :focus-visible) .ytwf-hint {
            visibility: visible;
            opacity: 1;
            transform: translate(-50%, 0);
        }
        .ytwf-hint kbd {
            padding: 0 3px;
            border: 1px solid rgb(255 255 255 / 55%);
            border-radius: 4px;
            font: inherit;
            line-height: 15px;
        }
        .ytwf-button[aria-pressed="false"] kbd {
            display: none;
        }
        @media (prefers-reduced-motion: reduce) {
            .ytwf-arrow, .ytwf-hint, .ytwf-speed-chip { transition: none; }
        }
        :fullscreen .ytwf-button {
            display: none !important;
        }
    `);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytp-button ytwf-button';
    button.setAttribute('aria-label', '网页全屏');
    button.setAttribute('aria-pressed', 'false');
    // 直接使用 SVG 子节点，让 YouTube 和相邻按钮共用同一套尺寸与间距。
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '24');
    icon.setAttribute('height', '24');
    icon.setAttribute('aria-hidden', 'true');
    const frame = document.createElementNS(svgNamespace, 'rect');
    frame.setAttribute('x', '2');
    frame.setAttribute('y', '4');
    frame.setAttribute('width', '20');
    frame.setAttribute('height', '16');
    frame.setAttribute('rx', '2');
    const arrow = document.createElementNS(svgNamespace, 'path');
    arrow.setAttribute('class', 'ytwf-arrow');
    arrow.setAttribute('d', 'M9 15l6-6m-5 0h5v5');
    icon.append(frame, arrow);

    const hint = document.createElement('span');
    hint.className = 'ytwf-hint';
    hint.setAttribute('aria-hidden', 'true');
    const hintText = document.createTextNode('网页全屏');
    const key = document.createElement('kbd');
    key.textContent = 'Esc';
    hint.append(hintText, key);
    button.append(icon, hint);

    const speedButton = document.createElement('button');
    speedButton.type = 'button';
    speedButton.className = 'ytp-button ytwf-speed';
    speedButton.setAttribute('aria-label', `${FAST_RATE} 倍速`);
    speedButton.setAttribute('aria-pressed', 'false');
    const speedLabel = document.createElement('span');
    speedLabel.className = 'ytwf-speed-chip';
    speedLabel.setAttribute('aria-hidden', 'true');
    speedLabel.textContent = `${FAST_RATE}×`;
    const speedHint = document.createElement('span');
    speedHint.className = 'ytwf-hint';
    speedHint.setAttribute('aria-hidden', 'true');
    speedButton.append(speedLabel, speedHint);

    function speedVideo() {
        return speedButton.closest('#movie_player')?.querySelector('video');
    }

    function syncSpeed() {
        const fast = speedVideo()?.playbackRate === FAST_RATE;
        speedButton.setAttribute('aria-pressed', String(fast));
        speedHint.textContent = fast ? '恢复 1 倍速' : `${FAST_RATE} 倍速`;
    }

    // 已是 1.25 倍速时恢复 1 倍速，其他速度一律切到 1.25 倍速。
    speedButton.addEventListener('click', () => {
        const movie = speedButton.closest('#movie_player');
        const video = speedVideo();
        if (!video) return;
        const rate = video.playbackRate === FAST_RATE ? 1 : FAST_RATE;
        // 优先走播放器接口，让设置菜单里的速度同步；脚本沙盒拿不到接口时直接改 video。
        const player = movie.wrappedJSObject || movie;
        if (typeof player.setPlaybackRate === 'function') player.setPlaybackRate(rate);
        if (video.playbackRate !== rate) video.playbackRate = rate;
        syncSpeed();
    });
    // ratechange 不冒泡，在捕获阶段统一监听，设置菜单和快捷键改速时也能同步按钮状态。
    document.addEventListener('ratechange', event => {
        if (event.target === speedVideo()) syncSpeed();
    }, true);

    function setWebFullscreen(host) {
        if (host === activeHost) return;
        activeHost?.removeAttribute('popover');
        activeHost = host;
        if (host) {
            // 将原播放器提到页面顶层，保留视频、字幕和控制栏的 DOM 关系。
            host.popover = 'manual';
            host.showPopover();
        }
        document.documentElement.classList.toggle('ytwf-active', Boolean(host));
        hintText.data = host ? '退出网页全屏' : '网页全屏';
        button.setAttribute('aria-pressed', String(Boolean(host)));
        // YouTube 在 resize 时重新计算视频、字幕和进度条的像素尺寸。
        window.dispatchEvent(new Event('resize'));
    }

    function toggleWebFullscreen() {
        const host = activeHost || button.closest('ytd-player');
        const movie = host.querySelector('#movie_player');
        setWebFullscreen(activeHost ? null : host);
        movie?.focus({ preventScroll: true });
        if (!reducedMotion.matches) {
            movie?.querySelector('.html5-video-container')?.animate([
                { opacity: 0.8, transform: activeHost ? 'scale(.985)' : 'scale(1.015)' },
                { opacity: 1, transform: 'none' },
            ], { duration: 200, easing: 'cubic-bezier(.05, 0, 0, 1)' });
        }
    }
    button.addEventListener('click', toggleWebFullscreen);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && activeHost) {
            event.preventDefault();
            event.stopPropagation();
            toggleWebFullscreen();
        }
    }, true);
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) setWebFullscreen(null);
    });

    function mountButton() {
        if (activeHost && !activeHost.matches(':popover-open')) setWebFullscreen(null);
        if (!button.isConnected) {
            document.querySelector(`${watchPlayer} :is(.ytp-size-button, .ytp-fullscreen-button)`)?.before(button);
        }
        if (!speedButton.isConnected) {
            // 放在「自动播放」开关左侧；找不到开关时退到字幕或设置按钮左侧。
            const anchor = ['[data-tooltip-target-id="ytp-autonav-toggle-button"]',
                '.ytp-button:has(> .ytp-autonav-toggle-button-container)',
                '.ytp-subtitles-button', '.ytp-settings-button']
                .map(selector => document.querySelector(`${watchPlayer} ${selector}`))
                .find(Boolean);
            anchor?.before(speedButton);
            if (speedButton.isConnected) syncSpeed();
        }
    }

    // YouTube 站内导航不会重载脚本，控制栏也可能晚于导航完成才出现。
    const observer = new MutationObserver(mountButton);
    function syncPage() {
        observer.disconnect();
        if (location.pathname !== '/watch') {
            setWebFullscreen(null);
            button.remove();
            speedButton.remove();
            return;
        }
        mountButton();
        syncSpeed();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('yt-navigate-finish', syncPage);
    window.addEventListener('popstate', syncPage);
    syncPage();
})();
