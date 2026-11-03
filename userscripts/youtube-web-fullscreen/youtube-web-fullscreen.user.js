// ==UserScript==
// @name         YouTube 网页全屏
// @namespace    https://github.com/DARX1024/Personal-Projects
// @version      1.0.0
// @description  让 YouTube 播放器占满当前标签页，按 Esc 回到原来的观看布局。
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

    const VERSION = '1.0.0';
    const watchPlayer = ':is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) ytd-player #movie_player';
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
        .ytp-button.ytwf-button {
            position: relative;
        }
        .ytwf-icon {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            box-sizing: border-box;
            width: 20px;
            height: 16px;
            border: 2px solid currentColor;
            border-radius: 3px;
            background: linear-gradient(currentColor, currentColor) center 3px / 100% 2px no-repeat;
        }
        :fullscreen .ytwf-button {
            display: none !important;
        }
    `);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytp-button ytwf-button';
    button.title = '网页全屏';
    button.setAttribute('aria-label', '网页全屏');
    button.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('span');
    icon.className = 'ytwf-icon';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);

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
        button.title = host ? '退出网页全屏 (Esc)' : '网页全屏';
        button.setAttribute('aria-pressed', String(Boolean(host)));
        // YouTube 在 resize 时重新计算视频、字幕和进度条的像素尺寸。
        window.dispatchEvent(new Event('resize'));
    }

    button.addEventListener('click', () => {
        setWebFullscreen(activeHost ? null : button.closest('ytd-player'));
        button.closest('#movie_player').focus({ preventScroll: true });
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && activeHost) {
            event.preventDefault();
            event.stopPropagation();
            setWebFullscreen(null);
        }
    }, true);
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) setWebFullscreen(null);
    });

    function mountButton() {
        if (activeHost && !activeHost.matches(':popover-open')) setWebFullscreen(null);
        if (button.isConnected) return;
        document.querySelector(`${watchPlayer} .ytp-fullscreen-button`)?.before(button);
    }

    // YouTube 站内导航不会重载脚本，控制栏也可能晚于导航完成才出现。
    const observer = new MutationObserver(mountButton);
    function syncPage() {
        observer.disconnect();
        if (location.pathname !== '/watch') {
            setWebFullscreen(null);
            button.remove();
            return;
        }
        mountButton();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('yt-navigate-finish', syncPage);
    window.addEventListener('popstate', syncPage);
    syncPage();
})();
