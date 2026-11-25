// ==UserScript==
// @name         YouTube 听课留言板
// @namespace    https://github.com/DARX1024/Personal-Projects
// @version      1.7.0
// @description  把观看页右侧的推荐视频换成一个只属于自己的「直播间」：随手发疑问和想法，自动记下视频时间戳和当时的字幕，课后一键复制给 Agent 总结。
// @author       DARX1024
// @match        https://www.youtube.com/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_setClipboard
// @grant        GM_getResourceURL
// @resource     pixelFont https://cdn.jsdelivr.net/npm/@fontsource/fusion-pixel-12px-proportional-sc@5.3.0/files/fusion-pixel-12px-proportional-sc-latin-400-normal.woff2
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-lecture-chat/youtube-lecture-chat.user.js
// @updateURL    https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-lecture-chat/youtube-lecture-chat.user.js
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '1.7.0';
    const RECORD_PREFIX = 'video:';
    const SETTINGS_KEY = 'settings';
    // 留言附带的字幕范围：锚定时刻之前 20 秒到之后 5 秒。
    const CONTEXT_BEFORE = 20;
    const CONTEXT_AFTER = 5;
    const CAPTION_LOG_LIMIT = 400;
    const KIND_LABEL = { question: '疑问', mark: '重点', note: '想法' };
    const KIND_ICON = { question: '❓', mark: '⭐', note: '💡' };
    // 点击留言前的类别标记时按这个顺序切换。
    const KIND_NEXT = { question: 'note', note: 'mark', mark: 'question' };
    // 拉灯开关：绳子静止长度、最多能拉下的长度、松手时超过多少算拉到底。
    const CORD_REST = 18;
    const CORD_MAX_PULL = 14;
    const CORD_TRIGGER = 8;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    // ---- 皮肤 ----
    // 像素吊坠：每个字符是一个像素，. 为透明；on 是点亮（发光）的样子，off 是熄灭的样子。
    const SPRITES = {
        potion: {
            grid: ['...ccc...', '...kkk...', '....k....', '...kkk...', '..kRRRk..', '.kRhRRRk.', '.kRRRRRk.', '.kRRRRRk.', '..kkkkk..'],
            off: { c: '#8a6a4a', k: '#7f98a3', R: '#b23a4e', h: '#e6e6e6' },
            on: { c: '#b07a3a', k: '#bfeaff', R: '#ff2d55', h: '#ffffff' },
        },
        star: {
            grid: ['....y....', '...yyy...', 'yyyyhyyyy', '.yyyhyyy.', '..yyyyy..', '..yyyyy..', '.yyy.yyy.', '.yy...yy.'],
            off: { y: '#c9a227', h: '#efd98a' },
            on: { y: '#ffd23f', h: '#fff6c0' },
        },
        bulb: {
            grid: ['...ccc...', '..cdddc..', '..cdddc..', '..cdddc..', '...ccc...', '..oyyyo..', '.oyyhyyo.',
                'oyyyhyyyo', 'oyyyyyyyo', 'oyyyyyyyo', '.oyyyyyo.', '..ooooo..'],
            off: { c: '#4a4a52', d: '#77777f', o: '#6e6650', y: '#a89f80', h: '#c9c0a0' },
            on: { c: '#55555e', d: '#8a8a94', o: '#d08a10', y: '#ffd84a', h: '#fffbe0' },
        },
    };
    const SKINS = [
        { id: 'default', name: '简洁', sub: '铜色拉坠' },
        { id: 'rpg', name: 'RPG 对话框', sub: '血瓶吊坠', sprite: 'potion' },
        { id: 'night', name: '月夜自习', sub: '星星吊坠', sprite: 'star' },
        // 台灯开着时纸面是亮的，所以浅色时点亮、深色时熄灭；血瓶和星星则在暗处发光。
        { id: 'paper', name: '方格笔记本', sub: '台灯吊坠', sprite: 'bulb', litWhen: 'light' },
    ];
    // 像素字体 Fusion Pixel（OFL-1.1），按 12px 的整数倍显示才清晰。
    const PIXEL_FONT_URL = 'https://cdn.jsdelivr.net/npm/@fontsource/fusion-pixel-12px-proportional-sc@5.3.0/files/fusion-pixel-12px-proportional-sc-latin-400-normal.woff2';

    // ---- AI 助教接口 ----
    // 接入时实现 reply 并把 enabled 设为 true：参数是刚发出的留言（含 t、text、kind、context）
    // 和本课信息（id、title、channel、url、notes），返回回复文本，返回 null 表示不回复。
    // 回复显示在留言下方，并随留言一起导出。不要把 API key 写进脚本，用 GM_getValue 读本机配置。
    const teacher = {
        enabled: false,
        shouldReply: note => note.kind === 'question',
        async reply(note, lecture) { return null; },
    };

    const settings = { showRelated: false, ...GM_getValue(SETTINGS_KEY, {}) };
    let videoId = null;
    let record = null;
    let anchor = null;
    let captionLog = [];
    const pending = new Set();

    GM_addStyle(`
        html.ytlc-hide-related :is(ytd-watch-flexy, ytd-watch-grid) #related {
            display: none !important;
        }
        /* 留言板有自己的深浅色，与 YouTube 页面主题无关；配色取自 YouTube 的两套主题。 */
        .ytlc-panel[data-theme="light"] {
            --ytlc-fg: #0f0f0f;
            --ytlc-muted: #606060;
            --ytlc-line: rgb(0 0 0 / 10%);
            --ytlc-chip: rgb(0 0 0 / 5%);
            --ytlc-bg: #fff;
            --ytlc-accent: #065fd4;
            color-scheme: light;
        }
        .ytlc-panel[data-theme="dark"] {
            --ytlc-fg: #f1f1f1;
            --ytlc-muted: #aaa;
            --ytlc-line: rgb(255 255 255 / 20%);
            --ytlc-chip: rgb(255 255 255 / 10%);
            --ytlc-bg: #0f0f0f;
            --ytlc-accent: #3ea6ff;
            color-scheme: dark;
        }
        .ytlc-panel {
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            height: min(560px, calc(100vh - 96px));
            margin-bottom: 16px;
            border: 1px solid var(--ytlc-line);
            border-radius: 12px;
            background: var(--ytlc-bg);
            color: var(--ytlc-fg);
            font: 400 14px/20px Roboto, Arial, sans-serif;
            overflow: hidden;
        }
        html.ytlc-hide-related .ytlc-panel {
            position: sticky;
            top: calc(var(--ytd-masthead-height, 56px) + 16px);
            z-index: 1;
            height: min(760px, calc(100vh - var(--ytd-masthead-height, 56px) - 32px));
        }
        .ytlc-panel button {
            font: inherit;
            color: inherit;
            cursor: pointer;
        }
        .ytlc-head {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 10px 12px 10px 16px;
            border-bottom: 1px solid var(--ytlc-line);
        }
        .ytlc-title {
            flex: 1;
            min-width: 0;
            font-size: 16px;
            font-weight: 500;
            white-space: nowrap;
        }
        /* 标题本身就是笔记库的入口：「课堂留言 ▾」⇄「笔记库 ▴」 */
        .ytlc-title-btn {
            display: inline-flex;
            align-items: center;
            max-width: 100%;
            margin-left: -6px;
            padding: 2px 8px 2px 6px;
            border: 0;
            border-radius: 8px;
            background: none;
            font: inherit !important;
            line-height: inherit;
        }
        .ytlc-title-btn:is(:hover, :focus-visible) {
            outline: none;
            background: var(--ytlc-chip);
        }
        .ytlc-caret {
            margin-left: 4px;
            color: var(--ytlc-muted);
            font-size: 11px;
            font-weight: 400;
        }
        .ytlc-count {
            margin-left: 6px;
            color: var(--ytlc-muted);
            font-size: 13px;
            font-weight: 400;
        }
        .ytlc-tool, .ytlc-quick button {
            height: 28px;
            padding: 0 10px;
            border: 0;
            border-radius: 14px;
            background: var(--ytlc-chip);
            font-size: 13px !important;
            white-space: nowrap;
        }
        .ytlc-tool:hover, .ytlc-quick button:hover {
            background: var(--ytlc-line);
        }
        .ytlc-tool[aria-pressed="true"] {
            background: var(--ytlc-fg);
            color: var(--ytlc-bg) !important;
        }
        .ytlc-lamp {
            position: relative;
            flex: none;
            align-self: stretch;
            width: 22px;
            margin: -10px -4px -10px 0;
            padding: 0;
            border: 0;
            background: none;
            cursor: grab;
            touch-action: none;
        }
        .ytlc-lamp.ytlc-dragging { cursor: grabbing; }
        .ytlc-lamp:focus { outline: none; }
        .ytlc-chain {
            position: absolute;
            top: 0;
            left: calc(50% - 5px);
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 10px;
            transform-origin: 50% 0;
            pointer-events: none;
        }
        /* 珠链：竖向重复的小圆点。 */
        .ytlc-cord {
            width: 3px;
            height: ${CORD_REST}px;
            background: radial-gradient(circle, var(--ytlc-muted) 1.1px, transparent 1.6px) 0 1px / 3px 4px repeat-y;
            transition: height 160ms cubic-bezier(.2, 0, 0, 1);
        }
        .ytlc-lamp:hover .ytlc-cord { height: ${CORD_REST + 2}px; }
        .ytlc-dragging .ytlc-cord { transition: none; }
        /* 铜色拉坠；关灯后变成夜光拉坠，微微发亮。 */
        .ytlc-bead {
            width: 8px;
            height: 13px;
            margin-top: -1px;
            border-radius: 4px 4px 5px 5px / 4px 4px 8px 8px;
            background: linear-gradient(90deg, #9c6a24, #f2d48a 45%, #b9842f);
            box-shadow: 0 1px 2px rgb(0 0 0 / 35%);
            transition: box-shadow 300ms, background 300ms;
        }
        .ytlc-panel:not(.ytlc-pixel)[data-theme="dark"] .ytlc-bead {
            background: linear-gradient(90deg, #d8ae58, #fff3cc 45%, #e2ba68);
            box-shadow: 0 0 7px 1px rgb(255 204 118 / 55%);
        }
        .ytlc-lamp:focus-visible .ytlc-bead {
            outline: 2px solid var(--ytlc-accent);
            outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
            .ytlc-cord, .ytlc-bead { transition: none; }
        }
        .ytlc-list {
            flex: 1;
            margin: 0;
            padding: 8px 0;
            list-style: none;
            overflow-y: auto;
            overscroll-behavior: contain;
        }
        .ytlc-empty {
            padding: 24px 20px;
            color: var(--ytlc-muted);
            text-align: center;
        }
        .ytlc-note {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 6px 12px 6px 16px;
        }
        .ytlc-note:hover, .ytlc-note.ytlc-flash {
            background: var(--ytlc-chip);
        }
        .ytlc-time {
            flex: none;
            min-width: 44px;
            padding: 0 4px;
            border: 0;
            border-radius: 4px;
            background: none;
            color: var(--ytlc-accent) !important;
            font-variant-numeric: tabular-nums;
            text-align: left;
        }
        .ytlc-time:hover { text-decoration: underline; }
        .ytlc-body { flex: 1; min-width: 0; }
        .ytlc-text {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }
        /* 类别标记是按钮，点击切换疑问 / 想法 / 重点；默认皮肤显示图标，像素皮肤显示文字色块。 */
        .ytlc-tag {
            margin: 0 4px 0 -2px;
            padding: 0 2px;
            border: 0;
            border-radius: 4px;
            background: none;
            font: inherit;
            line-height: inherit;
            vertical-align: baseline;
        }
        .ytlc-tag:hover, .ytlc-tag:focus-visible {
            outline: none;
            background: var(--ytlc-line);
        }
        .ytlc-tag-label { display: none; }
        .ytlc-context {
            margin-top: 2px;
            color: var(--ytlc-muted);
            font-size: 12px;
            line-height: 16px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ytlc-reply {
            margin-top: 4px;
            padding: 6px 8px;
            border-left: 2px solid var(--ytlc-accent);
            border-radius: 0 6px 6px 0;
            background: var(--ytlc-chip);
            white-space: pre-wrap;
        }
        /* 悬停一条留言时右侧出现「编辑」「删除」 */
        .ytlc-actions {
            display: flex;
            flex: none;
            gap: 2px;
            opacity: 0;
        }
        /* 用透明度而不是 visibility 隐藏，这样不悬停时也能用 Tab 键聚焦到按钮。 */
        .ytlc-note:is(:hover, :focus-within) .ytlc-actions { opacity: 1; }
        .ytlc-editing .ytlc-actions { display: none; }
        .ytlc-delete, .ytlc-edit {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            padding: 0;
            border: 0;
            border-radius: 12px;
            background: none;
            color: var(--ytlc-muted) !important;
        }
        :is(.ytlc-delete, .ytlc-edit):is(:hover, :focus-visible) {
            outline: none;
            background: var(--ytlc-line);
            color: var(--ytlc-fg) !important;
        }
        .ytlc-edit svg { width: 16px; height: 16px; fill: currentColor; }
        .ytlc-edit .ytlc-pencil-pixel { display: none; }
        .ytlc-edit-input {
            display: block;
            box-sizing: border-box;
            width: 100%;
            min-height: 30px;
            max-height: 160px;
            margin: 4px 0 2px;
            padding: 4px 8px;
            border: 1px solid var(--ytlc-accent);
            border-radius: 6px;
            background: var(--ytlc-bg);
            color: var(--ytlc-fg);
            font: inherit;
            resize: none;
            field-sizing: content;
        }
        .ytlc-edit-input:focus { outline: none; }
        .ytlc-edit-hint {
            color: var(--ytlc-muted);
            font-size: 12px;
            line-height: 16px;
        }
        .ytlc-composer {
            padding: 8px 12px 12px;
            border-top: 1px solid var(--ytlc-line);
        }
        .ytlc-quick {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .ytlc-anchor {
            margin-left: auto;
            border: 0;
            background: none;
            color: var(--ytlc-accent) !important;
            font-size: 13px !important;
            font-variant-numeric: tabular-nums;
        }
        .ytlc-anchor[hidden] { display: none; }
        .ytlc-input {
            display: block;
            box-sizing: border-box;
            width: 100%;
            min-height: 40px;
            max-height: 140px;
            padding: 9px 12px;
            border: 1px solid var(--ytlc-line);
            border-radius: 8px;
            background: transparent;
            color: var(--ytlc-fg);
            font: inherit;
            resize: none;
            field-sizing: content;
        }
        .ytlc-input::placeholder { color: var(--ytlc-muted); }
        .ytlc-input:focus {
            outline: none;
            border-color: var(--ytlc-accent);
        }
        .ytlc-foot {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 6px;
        }
        .ytlc-hint {
            flex: 1;
            min-width: 0;
            color: var(--ytlc-muted);
            font-size: 12px;
        }
        .ytlc-hint kbd {
            padding: 0 4px;
            border: 1px solid var(--ytlc-line);
            border-radius: 4px;
            font: inherit;
        }
        /* ---- 皮肤选单 ---- */
        .ytlc-skin { position: relative; flex: none; }
        .ytlc-skin-toggle {
            padding: 2px 8px;
            border: 0;
            border-radius: 4px;
            background: none;
            color: var(--ytlc-muted) !important;
            font-size: 12px !important;
        }
        .ytlc-skin-toggle:hover, .ytlc-skin-toggle[aria-expanded="true"] {
            background: var(--ytlc-chip);
            color: var(--ytlc-fg) !important;
        }
        .ytlc-skin-menu {
            position: absolute;
            right: 0;
            bottom: calc(100% + 8px);
            z-index: 3;
            width: 216px;
            padding: 6px;
            border: 1px solid var(--ytlc-line);
            border-radius: 10px;
            background: var(--ytlc-bg);
            box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
            transform-origin: 100% 100%;
            animation: ytlc-menu-up 140ms cubic-bezier(.2, 0, 0, 1);
        }
        .ytlc-skin-menu[hidden] { display: none; }
        @keyframes ytlc-menu-up {
            from { opacity: 0; transform: translateY(6px); }
        }
        .ytlc-skin-heading {
            padding: 4px 8px 6px;
            color: var(--ytlc-muted);
            font-size: 12px;
        }
        .ytlc-skin-item {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 6px 8px;
            border: 0;
            border-radius: 6px;
            background: none;
            text-align: left;
        }
        .ytlc-skin-item:is(:hover, :focus-visible) {
            outline: none;
            background: var(--ytlc-chip);
        }
        .ytlc-skin-name { flex: 1; min-width: 0; }
        .ytlc-skin-name small {
            display: block;
            color: var(--ytlc-muted);
            font-size: 12px;
            line-height: 16px;
        }
        .ytlc-skin-item:not([data-skin="default"]) .ytlc-skin-name {
            font-family: "YTLC Pixel", monospace;
            font-size: 12px;
            line-height: 16px;
        }
        .ytlc-skin-check { width: 14px; color: var(--ytlc-accent); visibility: hidden; }
        .ytlc-skin-item[aria-checked="true"] .ytlc-skin-check { visibility: visible; }
        /* 色卡：固定展示每款皮肤的招牌配色，和当前深浅色无关。 */
        .ytlc-swatch {
            display: flex;
            align-items: center;
            justify-content: center;
            flex: none;
            width: 36px;
            height: 30px;
            border-radius: 4px;
            box-shadow: inset 0 0 0 1px rgb(128 128 128 / 35%);
        }
        .ytlc-swatch[data-skin="default"] { background: linear-gradient(135deg, #fff 50%, #0f0f0f 50%); }
        .ytlc-swatch[data-skin="default"]::after {
            content: "";
            width: 8px;
            height: 13px;
            border-radius: 4px 4px 5px 5px / 4px 4px 8px 8px;
            background: linear-gradient(90deg, #9c6a24, #f2d48a 45%, #b9842f);
        }
        .ytlc-swatch[data-skin="rpg"] { border-radius: 0; background: #10102a; box-shadow: inset 0 0 0 2px #10102a, inset 0 0 0 4px #f4f4f4; }
        .ytlc-swatch[data-skin="night"] {
            border-radius: 0;
            background: radial-gradient(circle, #fff 0 1px, transparent 1.5px) 3px 4px / 13px 11px, #1b1d3a;
        }
        .ytlc-swatch[data-skin="paper"] {
            border-radius: 0;
            background: linear-gradient(#e2d6bb 1px, transparent 1px) 0 0 / 6px 6px,
                linear-gradient(90deg, #e2d6bb 1px, transparent 1px) 0 0 / 6px 6px, #f4ecd8;
        }
        .ytlc-sprite { display: block; }
        @media (prefers-reduced-motion: reduce) {
            .ytlc-skin-menu { animation: none; }
        }

        /* ---- 像素皮肤：共用骨架 ---- */
        .ytlc-panel.ytlc-pixel {
            width: auto;
            margin: 4px 4px 24px;
            border: 0;
            border-radius: 0;
            background-color: var(--ytlc-bg);
            font: 12px/18px "YTLC Pixel", monospace;
            -webkit-font-smoothing: none;
            box-shadow: 0 -4px 0 0 var(--ytlc-frame), 0 4px 0 0 var(--ytlc-frame),
                -4px 0 0 0 var(--ytlc-frame), 4px 0 0 0 var(--ytlc-frame), 8px 8px 0 0 rgb(0 0 0 / 28%);
            scrollbar-color: var(--ytlc-muted) transparent;
        }
        .ytlc-pixel button, .ytlc-pixel .ytlc-input { font-family: "YTLC Pixel", monospace !important; }
        .ytlc-pixel .ytlc-head { border-bottom: 4px solid var(--ytlc-line); }
        .ytlc-pixel .ytlc-title { font-size: 24px; line-height: 24px; font-weight: 400; }
        .ytlc-pixel .ytlc-count { font-size: 12px; }
        .ytlc-pixel :is(.ytlc-tool, .ytlc-quick button:not(.ytlc-anchor)) {
            height: auto;
            margin: 2px;
            padding: 6px 7px 7px;
            border-radius: 0;
            background: var(--ytlc-chip);
            color: var(--ytlc-fg) !important;
            font-size: 12px !important;
            line-height: 12px;
            box-shadow: inset -2px -3px 0 0 var(--ytlc-shade), 0 0 0 2px var(--ytlc-frame);
        }
        .ytlc-pixel :is(.ytlc-tool, .ytlc-quick button:not(.ytlc-anchor)):hover { background: var(--ytlc-hl); }
        .ytlc-pixel :is(.ytlc-tool, .ytlc-quick button:not(.ytlc-anchor)):active {
            box-shadow: inset 2px 3px 0 0 var(--ytlc-shade), 0 0 0 2px var(--ytlc-frame);
        }
        .ytlc-pixel .ytlc-tool[aria-pressed="true"] { background: var(--ytlc-fg); color: var(--ytlc-bg) !important; }
        .ytlc-pixel .ytlc-note:hover, .ytlc-pixel .ytlc-note.ytlc-flash { background: var(--ytlc-hl); }
        .ytlc-pixel .ytlc-time { font-size: 12px !important; }
        .ytlc-pixel .ytlc-tag {
            display: inline-block;
            margin: 0 5px 0 0;
            padding: 2px 3px;
            border-radius: 0;
            background: var(--ytlc-tq);
            color: var(--ytlc-tag-fg) !important;
            font-size: 12px !important;
            line-height: 12px;
        }
        .ytlc-pixel .ytlc-tag:is(:hover, :focus-visible) { box-shadow: 0 0 0 2px var(--ytlc-frame); }
        .ytlc-pixel .ytlc-note[data-kind="mark"] .ytlc-tag { background: var(--ytlc-tm); }
        .ytlc-pixel .ytlc-note[data-kind="note"] .ytlc-tag { background: var(--ytlc-tn); color: var(--ytlc-tn-fg) !important; }
        .ytlc-pixel .ytlc-tag-icon { display: none; }
        .ytlc-pixel .ytlc-tag-label { display: inline; }
        .ytlc-pixel .ytlc-label-only .ytlc-words { display: none; }
        .ytlc-pixel .ytlc-context { font-size: 12px; line-height: 18px; }
        .ytlc-pixel .ytlc-reply { border-left-width: 4px; border-radius: 0; background: var(--ytlc-hl); }
        .ytlc-pixel :is(.ytlc-delete, .ytlc-edit) { border-radius: 0; }
        .ytlc-pixel .ytlc-edit .ytlc-pencil { display: none; }
        .ytlc-pixel .ytlc-edit .ytlc-pencil-pixel { display: block; }
        .ytlc-pixel .ytlc-edit-input {
            width: calc(100% - 4px);
            margin: 6px 2px 4px;
            border: 0;
            border-radius: 0;
            background: var(--ytlc-input);
            font-size: 12px !important;
            line-height: 18px;
            box-shadow: 0 0 0 2px var(--ytlc-accent);
        }
        .ytlc-pixel .ytlc-composer { border-top: 4px solid var(--ytlc-line); }
        .ytlc-pixel .ytlc-input {
            width: calc(100% - 4px);
            margin: 2px;
            border: 0;
            border-radius: 0;
            background: var(--ytlc-input);
            font-size: 12px !important;
            line-height: 18px;
            box-shadow: 0 0 0 2px var(--ytlc-frame), inset 2px 2px 0 0 var(--ytlc-shade);
        }
        .ytlc-pixel .ytlc-input:focus { box-shadow: 0 0 0 2px var(--ytlc-accent), inset 2px 2px 0 0 var(--ytlc-shade); }
        .ytlc-pixel .ytlc-anchor { padding: 0 4px; border-radius: 0; background: none; font-size: 12px !important; }
        .ytlc-pixel .ytlc-hint kbd { border-radius: 0; }
        .ytlc-pixel :is(.ytlc-skin-toggle, .ytlc-skin-item) { border-radius: 0; }
        .ytlc-pixel .ytlc-skin-menu {
            border: 0;
            border-radius: 0;
            box-shadow: 0 0 0 2px var(--ytlc-frame), 6px 6px 0 0 rgb(0 0 0 / 30%);
            animation-timing-function: steps(3);
        }
        /* 像素珠链和像素吊坠 */
        .ytlc-pixel .ytlc-cord {
            width: 2px;
            background: linear-gradient(var(--ytlc-muted) 50%, transparent 50%) 0 0 / 2px 4px repeat-y;
        }
        .ytlc-pixel .ytlc-bead {
            width: auto;
            height: auto;
            margin-top: 0;
            border-radius: 0;
            background: none;
            box-shadow: none;
        }
        .ytlc-pixel .ytlc-bead.ytlc-lit .ytlc-sprite {
            filter: drop-shadow(0 0 4px var(--ytlc-glow)) drop-shadow(0 0 2px var(--ytlc-glow));
        }

        /* ---- 像素皮肤：配色 ---- */
        .ytlc-panel[data-skin="rpg"] {
            --ytlc-glow: #ff2d55;
            margin: 10px 10px 30px;
        }
        .ytlc-panel[data-skin="rpg"][data-theme="dark"] {
            --ytlc-bg: #10102a; --ytlc-fg: #f4f4f4; --ytlc-muted: #8c8cb4; --ytlc-frame: #f4f4f4;
            --ytlc-line: #2c2c5a; --ytlc-chip: #10102a; --ytlc-shade: #2c2c5a; --ytlc-hl: #1e1e46;
            --ytlc-accent: #ffd23f; --ytlc-tq: #e8344a; --ytlc-tm: #ffd23f; --ytlc-tag-fg: #10102a; --ytlc-input: #060616;
            --ytlc-tn: #3a7bd5; --ytlc-tn-fg: #f4f4f4;
            color-scheme: dark;
        }
        .ytlc-panel[data-skin="rpg"][data-theme="light"] {
            --ytlc-bg: #f8f8f0; --ytlc-fg: #10102a; --ytlc-muted: #6a6a8c; --ytlc-frame: #10102a;
            --ytlc-line: #dcdce8; --ytlc-chip: #f8f8f0; --ytlc-shade: #c8c8d8; --ytlc-hl: #ececf4;
            --ytlc-accent: #b0262f; --ytlc-tq: #e8344a; --ytlc-tm: #e2a400; --ytlc-tag-fg: #fff; --ytlc-input: #fff;
            --ytlc-tn: #2f6fcf; --ytlc-tn-fg: #fff;
        }
        /* RPG 对话框：内外两圈的双线边框 */
        .ytlc-panel.ytlc-pixel[data-skin="rpg"] {
            box-shadow: 0 0 0 4px var(--ytlc-bg), 0 0 0 8px var(--ytlc-frame), 0 0 0 10px var(--ytlc-bg),
                10px 10px 0 0 rgb(0 0 0 / 28%);
        }
        .ytlc-panel[data-skin="rpg"] .ytlc-quick button:not(.ytlc-anchor)::before {
            content: "▶";
            margin-right: 3px;
            color: var(--ytlc-accent);
        }
        .ytlc-panel[data-skin="night"] {
            --ytlc-glow: #ffd23f;
            background-image: radial-gradient(circle, var(--ytlc-star) 0 1px, transparent 1.5px),
                radial-gradient(circle, var(--ytlc-star2) 0 1px, transparent 1.5px);
            background-size: 97px 83px, 131px 113px;
            background-position: 13px 21px, 61px 47px;
        }
        .ytlc-panel[data-skin="night"][data-theme="dark"] {
            --ytlc-bg: #1b1d3a; --ytlc-fg: #e8e6ff; --ytlc-muted: #8a8bc0; --ytlc-frame: #0c0d22;
            --ytlc-line: #2b2e5c; --ytlc-chip: #2b2e5c; --ytlc-shade: #14163a; --ytlc-hl: #25284f;
            --ytlc-accent: #f7d774; --ytlc-tq: #c96bd8; --ytlc-tm: #f7d774; --ytlc-tag-fg: #1b1d3a; --ytlc-input: #14163a;
            --ytlc-tn: #5ec2c8; --ytlc-tn-fg: #1b1d3a;
            --ytlc-star: rgb(255 255 255 / 55%); --ytlc-star2: rgb(247 215 116 / 60%);
            color-scheme: dark;
        }
        .ytlc-panel[data-skin="night"][data-theme="light"] {
            --ytlc-bg: #eef0fb; --ytlc-fg: #24264a; --ytlc-muted: #6e70a0; --ytlc-frame: #24264a;
            --ytlc-line: #d6d9f0; --ytlc-chip: #fff; --ytlc-shade: #c9cdee; --ytlc-hl: #e1e4f7;
            --ytlc-accent: #6a4fc8; --ytlc-tq: #b04fc8; --ytlc-tm: #d89a00; --ytlc-tag-fg: #fff; --ytlc-input: #fff;
            --ytlc-tn: #2f9aa0; --ytlc-tn-fg: #fff;
            --ytlc-star: #b9bde8; --ytlc-star2: #e8c86a;
        }
        .ytlc-panel[data-skin="paper"] {
            --ytlc-glow: #ffcc33;
            background-image: linear-gradient(var(--ytlc-grid) 1px, transparent 1px),
                linear-gradient(90deg, var(--ytlc-grid) 1px, transparent 1px);
            background-size: 12px 12px;
        }
        .ytlc-panel[data-skin="paper"][data-theme="light"] {
            --ytlc-bg: #f4ecd8; --ytlc-fg: #3b2f2f; --ytlc-muted: #9a8a72; --ytlc-frame: #3b2f2f;
            --ytlc-line: #e2d6bb; --ytlc-chip: #fffaf0; --ytlc-shade: #d9ccb0; --ytlc-hl: #ebe0c6;
            --ytlc-accent: #c0392b; --ytlc-tq: #c0392b; --ytlc-tm: #e2a400; --ytlc-tag-fg: #fffaf0; --ytlc-input: #fffaf0;
            --ytlc-tn: #5b8c5a; --ytlc-tn-fg: #fffaf0;
            --ytlc-grid: #e6dcc4;
        }
        .ytlc-panel[data-skin="paper"][data-theme="dark"] {
            --ytlc-bg: #2b2622; --ytlc-fg: #efe6d2; --ytlc-muted: #a39478; --ytlc-frame: #120f0d;
            --ytlc-line: #3d362f; --ytlc-chip: #3d362f; --ytlc-shade: #1e1a17; --ytlc-hl: #362f29;
            --ytlc-accent: #ff7a66; --ytlc-tq: #e0533f; --ytlc-tm: #e2a400; --ytlc-tag-fg: #2b2622; --ytlc-input: #221e1b;
            --ytlc-tn: #6fae6d; --ytlc-tn-fg: #2b2622;
            --ytlc-grid: #342e28;
            color-scheme: dark;
        }
        /* ---- 笔记库 ---- */
        .ytlc-panel[data-view="library"] :is(.ytlc-list, .ytlc-composer, .ytlc-tool) { display: none; }
        .ytlc-panel:not([data-view="library"]) .ytlc-library { display: none; }
        .ytlc-library {
            display: flex;
            flex: 1;
            flex-direction: column;
            min-height: 0;
        }
        .ytlc-lib-tools {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px 12px 8px 16px;
            border-bottom: 1px solid var(--ytlc-line);
        }
        .ytlc-search {
            box-sizing: border-box;
            width: 100%;
            height: 32px;
            padding: 0 14px;
            border: 1px solid transparent;
            border-radius: 16px;
            background: var(--ytlc-chip);
            color: var(--ytlc-fg);
            font: inherit;
            font-size: 13px;
        }
        .ytlc-search::placeholder { color: var(--ytlc-muted); }
        .ytlc-search:focus { outline: none; border-color: var(--ytlc-accent); }
        .ytlc-chips {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
        }
        .ytlc-chip {
            height: 26px;
            padding: 0 10px;
            border: 0;
            border-radius: 8px;
            background: var(--ytlc-chip);
            font-size: 13px !important;
        }
        .ytlc-chip:hover { background: var(--ytlc-line); }
        .ytlc-chip[aria-pressed="true"] { background: var(--ytlc-fg); color: var(--ytlc-bg) !important; }
        .ytlc-chip i { margin-left: 3px; font-style: normal; opacity: .65; font-size: 12px; }
        .ytlc-sort-label { margin-left: auto; color: var(--ytlc-muted); font-size: 12px; }
        .ytlc-lib-list {
            flex: 1;
            min-height: 0;
            margin: 0;
            padding: 4px 0 8px;
            list-style: none;
            overflow-y: auto;
            overscroll-behavior: contain;
        }
        .ytlc-lib-empty { padding: 24px 20px; color: var(--ytlc-muted); text-align: center; }
        .ytlc-video-row {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 12px 8px 16px;
        }
        .ytlc-video-row:hover { background: var(--ytlc-chip); }
        .ytlc-current > .ytlc-video-row { background: color-mix(in srgb, var(--ytlc-accent) 9%, transparent); }
        .ytlc-check {
            flex: none;
            width: 16px;
            height: 16px;
            margin: 3px 0 0;
            accent-color: var(--ytlc-accent);
            cursor: pointer;
        }
        .ytlc-vinfo {
            display: block;
            flex: 1;
            min-width: 0;
            padding: 0;
            border: 0;
            background: none;
            text-align: left;
        }
        .ytlc-vinfo:focus-visible { outline: 2px solid var(--ytlc-accent); outline-offset: 2px; }
        .ytlc-vtitle {
            display: -webkit-box;
            overflow: hidden;
            font-weight: 500;
            overflow-wrap: anywhere;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
        }
        .ytlc-vmeta, .ytlc-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 0 8px;
            margin-top: 2px;
            color: var(--ytlc-muted);
            font-size: 12px;
            line-height: 16px;
        }
        .ytlc-badges { margin-top: 4px; }
        .ytlc-now { color: var(--ytlc-accent); }
        .ytlc-vcaret { flex: none; margin-top: 2px; color: var(--ytlc-muted); font-size: 11px; }
        .ytlc-lib-notes {
            margin: 0;
            padding: 0 0 6px 42px;
            list-style: none;
        }
        .ytlc-group .ytlc-lib-notes { padding-left: 16px; }
        .ytlc-lib-note {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 3px 12px 3px 0;
        }
        .ytlc-lib-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .ytlc-kind { flex: none; }
        .ytlc-group-head {
            display: flex;
            align-items: baseline;
            gap: 8px;
            padding: 10px 12px 4px 16px;
            color: var(--ytlc-muted);
            font-size: 12px;
        }
        .ytlc-group-head b {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            color: var(--ytlc-fg);
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            text-overflow: ellipsis;
        }
        .ytlc-lib-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 30px;
            padding: 8px 12px 10px 16px;
            border-top: 1px solid var(--ytlc-line);
            font-size: 13px;
        }
        .ytlc-bar-btn {
            height: 28px;
            padding: 0 12px;
            border: 0;
            border-radius: 14px;
            background: var(--ytlc-chip);
            font-size: 13px !important;
            white-space: nowrap;
        }
        .ytlc-bar-btn:hover { background: var(--ytlc-line); }
        .ytlc-bar-btn.ytlc-primary { background: var(--ytlc-accent); color: var(--ytlc-bg) !important; }
        .ytlc-bar-btn:disabled { opacity: .5; cursor: default; }
        .ytlc-lib-status { min-width: 0; color: var(--ytlc-muted); font-size: 12px; }
        .ytlc-bar-links {
            display: flex;
            flex: none;
            align-items: center;
            margin-left: auto;
            color: var(--ytlc-muted);
            font-size: 12px;
        }
        .ytlc-link {
            padding: 2px 4px;
            border: 0;
            background: none;
            color: var(--ytlc-muted) !important;
            font-size: 12px !important;
        }
        .ytlc-link:hover { color: var(--ytlc-fg) !important; text-decoration: underline; }
        /* 像素皮肤下的笔记库 */
        .ytlc-pixel .ytlc-title-btn { border-radius: 0; }
        .ytlc-pixel .ytlc-caret { font-size: 12px; }
        .ytlc-pixel :is(.ytlc-lib-tools, .ytlc-lib-bar) { border-width: 4px; border-color: var(--ytlc-line); }
        .ytlc-pixel .ytlc-search {
            width: calc(100% - 4px);
            margin: 2px;
            border: 0;
            border-radius: 0;
            background: var(--ytlc-input);
            font-size: 12px;
            box-shadow: 0 0 0 2px var(--ytlc-frame), inset 2px 2px 0 0 var(--ytlc-shade);
        }
        .ytlc-pixel .ytlc-search:focus { box-shadow: 0 0 0 2px var(--ytlc-accent), inset 2px 2px 0 0 var(--ytlc-shade); }
        .ytlc-pixel :is(.ytlc-chip, .ytlc-bar-btn) {
            height: auto;
            margin: 2px;
            padding: 6px 7px 7px;
            border-radius: 0;
            background: var(--ytlc-chip);
            color: var(--ytlc-fg) !important;
            font-size: 12px !important;
            line-height: 12px;
            box-shadow: inset -2px -3px 0 0 var(--ytlc-shade), 0 0 0 2px var(--ytlc-frame);
        }
        .ytlc-pixel :is(.ytlc-chip, .ytlc-bar-btn):hover { background: var(--ytlc-hl); }
        .ytlc-pixel .ytlc-chip[aria-pressed="true"], .ytlc-pixel .ytlc-bar-btn.ytlc-primary {
            background: var(--ytlc-fg);
            color: var(--ytlc-bg) !important;
        }
        .ytlc-pixel .ytlc-vtitle, .ytlc-pixel .ytlc-group-head b { font-weight: 400; }
        .ytlc-pixel .ytlc-current > .ytlc-video-row, .ytlc-pixel .ytlc-video-row:hover { background: var(--ytlc-hl); }
        .ytlc-pixel :is(.ytlc-kind, .ytlc-badge) {
            display: inline-block;
            padding: 2px 3px;
            background: var(--ytlc-tq);
            color: var(--ytlc-tag-fg);
            font-size: 12px;
            line-height: 12px;
        }
        .ytlc-pixel :is(.ytlc-kind, .ytlc-badge)[data-kind="mark"] { background: var(--ytlc-tm); }
        .ytlc-pixel :is(.ytlc-kind, .ytlc-badge)[data-kind="note"] { background: var(--ytlc-tn); color: var(--ytlc-tn-fg); }
        .ytlc-pixel .ytlc-badges { gap: 4px; }
    `);

    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [name, value] of Object.entries(props)) {
            if (name === 'onclick') el.addEventListener('click', value);
            else if (name in el && !name.includes('-')) el[name] = value;
            else el.setAttribute(name, value);
        }
        el.append(...children);
        return el;
    }

    function makeSprite(name, state, px) {
        const sprite = SPRITES[name];
        const palette = sprite[state];
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        const width = sprite.grid[0].length;
        const height = sprite.grid.length;
        svg.setAttribute('class', 'ytlc-sprite');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', String(width * px));
        svg.setAttribute('height', String(height * px));
        svg.setAttribute('shape-rendering', 'crispEdges');
        sprite.grid.forEach((row, y) => [...row].forEach((ch, x) => {
            if (!palette[ch]) return;
            const rect = document.createElementNS(ns, 'rect');
            for (const [key, value] of Object.entries({ x, y, width: 1, height: 1, fill: palette[ch] })) {
                rect.setAttribute(key, String(value));
            }
            svg.append(rect);
        }));
        return svg;
    }

    // 铅笔图标：默认皮肤用常见的矢量铅笔，像素皮肤用 8×8 的像素铅笔，颜色都跟随文字色。
    function pencilIcon() {
        const ns = 'http://www.w3.org/2000/svg';
        const vector = document.createElementNS(ns, 'svg');
        vector.setAttribute('class', 'ytlc-pencil');
        vector.setAttribute('viewBox', '0 0 24 24');
        vector.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
        vector.append(path);
        const pixel = document.createElementNS(ns, 'svg');
        pixel.setAttribute('class', 'ytlc-pencil-pixel');
        pixel.setAttribute('viewBox', '0 0 8 8');
        pixel.setAttribute('shape-rendering', 'crispEdges');
        pixel.setAttribute('aria-hidden', 'true');
        ['.....xx.', '....x.xx', '...x.xx.', '..x.xx..', '.x.xx...', 'x.xx....', 'xxx.....', 'xx......'].forEach((row, y) =>
            [...row].forEach((ch, x) => {
                if (ch !== 'x') return;
                const rect = document.createElementNS(ns, 'rect');
                for (const [key, value] of Object.entries({ x, y, width: 1, height: 1 })) rect.setAttribute(key, String(value));
                pixel.append(rect);
            }));
        return [vector, pixel];
    }

    // ---- 播放器与页面信息 ----
    function player() {
        return document.querySelector(':is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) #movie_player')
            || document.querySelector('#movie_player');
    }

    function video() {
        return player()?.querySelector('video') ?? null;
    }

    function now() {
        const t = video()?.currentTime;
        return Number.isFinite(t) ? t : 0;
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor(total / 60) % 60;
        const secs = String(total % 60).padStart(2, '0');
        return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
    }

    function currentVideoId() {
        return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
    }

    function urlFor(id, t) {
        const base = `https://www.youtube.com/watch?v=${id}`;
        return t === undefined ? base : `${base}&t=${Math.floor(t)}s`;
    }

    function videoUrl(t) {
        return urlFor(videoId, t);
    }

    function pageInfo() {
        const text = selector => document.querySelector(selector)?.textContent.trim() || '';
        return {
            title: text('ytd-watch-metadata h1') || document.title.replace(/ - YouTube$/, '').trim(),
            channel: text('ytd-watch-metadata ytd-channel-name a') || text('ytd-watch-metadata #owner #channel-name'),
        };
    }

    // ---- 存储 ----
    function loadRecord(id) {
        return { id, title: '', channel: '', notes: [], ...GM_getValue(RECORD_PREFIX + id, {}) };
    }

    function saveRecord() {
        if (!record) return;
        const info = pageInfo();
        record.title = info.title || record.title;
        record.channel = info.channel || record.channel;
        // 记下所属播放列表，留给以后按课程分组。
        const playlist = new URLSearchParams(location.search).get('list');
        if (playlist && new URLSearchParams(location.search).get('v') === record.id) record.playlistId = playlist;
        if (record.notes.length) GM_setValue(RECORD_PREFIX + record.id, record);
        else GM_deleteValue(RECORD_PREFIX + record.id);
    }

    function saveSettings() {
        GM_setValue(SETTINGS_KEY, settings);
    }

    // ---- 字幕上下文 ----
    // 记录播放过程中屏幕上出现过的每一行字幕及其首次出现的时间，留言时取锚定时刻附近的几行。
    function captureCaptions(event) {
        const target = event.target;
        if (!(target instanceof HTMLMediaElement) || !target.closest('#movie_player')) return;
        const lines = [...target.closest('#movie_player').querySelectorAll('.ytp-caption-segment')]
            .map(el => el.textContent.trim()).filter(Boolean);
        const t = target.currentTime;
        for (const line of lines) {
            const seen = captionLog.some(entry => entry.text === line && Math.abs(entry.t - t) < 30);
            if (!seen) captionLog.push({ t, text: line });
        }
        if (captionLog.length > CAPTION_LOG_LIMIT) captionLog.splice(0, captionLog.length - CAPTION_LOG_LIMIT);
    }

    function captionsAround(t) {
        const lines = captionLog
            .filter(entry => entry.t >= t - CONTEXT_BEFORE && entry.t <= t + CONTEXT_AFTER)
            .sort((a, b) => a.t - b.t)
            .map(entry => entry.text);
        return [...new Set(lines)];
    }

    // ---- 留言 ----
    // 以问号结尾的是疑问，其余都是想法（内部仍记作 note，兼容旧数据）。
    function inferKind(text) {
        return /[?？]\s*$/.test(text) ? 'question' : 'note';
    }

    function addNote(text, t, kind = inferKind(text)) {
        if (!record) return;
        const note = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            t: Math.round(t * 10) / 10,
            text,
            kind,
            context: captionsAround(t),
            createdAt: new Date().toISOString(),
            replies: [],
        };
        record.notes.push(note);
        record.notes.sort((a, b) => a.t - b.t);
        saveRecord();
        render(note.id);
        askTeacher(note);
        return note;
    }

    async function askTeacher(note) {
        if (!teacher.enabled || !teacher.shouldReply(note)) return;
        const owner = record;
        pending.add(note.id);
        render();
        try {
            const lecture = { id: owner.id, title: owner.title, channel: owner.channel, url: videoUrl(), notes: owner.notes };
            const text = await teacher.reply(note, lecture);
            if (text) note.replies.push({ role: 'teacher', text: String(text), createdAt: new Date().toISOString() });
        } catch (error) {
            note.replies.push({ role: 'error', text: `助教请求失败：${error?.message || error}`, createdAt: new Date().toISOString() });
        } finally {
            pending.delete(note.id);
            if (owner === record) {
                saveRecord();
                render();
            } else if (owner.notes.includes(note)) {
                GM_setValue(RECORD_PREFIX + owner.id, owner);
            }
        }
    }

    // 正在补写的占位留言被删掉时，草稿留着，改回普通的时间锚点。
    function releaseFilling() {
        if (filling && !record?.notes.includes(filling)) setAnchor(input.value.trim() ? anchor : null);
    }

    // ---- 编辑单条留言：只改文字，类别和时间戳不变 ----
    let editingId = null;
    let editDraft = '';
    let focusEditor = false;

    function editor(note) {
        const field = h('textarea', {
            className: 'ytlc-edit-input',
            rows: 1,
            value: editDraft,
            'aria-label': '编辑留言',
        });
        field.addEventListener('input', () => { editDraft = field.value; });
        field.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                finishEdit(true, true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                finishEdit(false, true);
            }
        });
        // 焦点移到列表里的其他按钮（换一条编辑、切换类别等）时由那个按钮处理；移到别处则保存。
        field.addEventListener('blur', event => {
            if (!event.relatedTarget?.closest?.('.ytlc-list')) finishEdit(true, false);
        });
        const fragment = document.createDocumentFragment();
        fragment.append(field, h('div', { className: 'ytlc-edit-hint' }, 'Enter 保存 · Shift+Enter 换行 · Esc 取消'));
        return fragment;
    }

    function startEdit(id) {
        const note = record?.notes.find(item => item.id === id);
        if (!note) return;
        if (editingId && editingId !== id) finishEdit(true, false);
        editingId = id;
        // 只有标签的占位留言（如「想法」）从空白开始写。
        editDraft = note.text === KIND_LABEL[note.kind] ? '' : note.text;
        focusEditor = true;
        render();
    }

    function finishEdit(save, refocus) {
        if (!editingId) return;
        const id = editingId;
        editingId = null;
        const note = record?.notes.find(item => item.id === id);
        const text = editDraft.trim();
        if (save && note && text && text !== note.text) {
            note.text = text;
            note.editedAt = new Date().toISOString();
            saveRecord();
        }
        render(save && note ? id : undefined);
        if (refocus) list.querySelector(`[data-id="${id}"] .ytlc-edit`)?.focus({ preventScroll: true });
    }

    // 切换类别；只有标签、没写内容的留言（如占位的「想法」）文字跟着改成新类别名。
    function cycleKind(id) {
        const note = record?.notes.find(item => item.id === id);
        if (!note) return;
        const next = KIND_NEXT[note.kind] || 'note';
        if (note.text === KIND_LABEL[note.kind]) note.text = KIND_LABEL[next];
        note.kind = next;
        saveRecord();
        render(note.id);
        list.querySelector(`[data-id="${id}"] .ytlc-tag`)?.focus({ preventScroll: true });
        if (!note.replies?.length && !pending.has(note.id)) askTeacher(note);
    }

    function deleteNote(id) {
        if (editingId === id) editingId = null;
        record.notes = record.notes.filter(note => note.id !== id);
        releaseFilling();
        saveRecord();
        render();
    }

    function toMarkdown() {
        const info = pageInfo();
        const title = record.title || info.title || videoId;
        const channel = record.channel || info.channel;
        const out = [
            `# 听课留言：${title}`,
            '',
            `- 视频：${videoUrl()}`,
            ...(channel ? [`- 频道：${channel}`] : []),
            `- 导出：${new Date().toLocaleString('zh-CN', { hour12: false })}，共 ${record.notes.length} 条`,
            '',
            '> 时间戳是我产生疑问或想法的时刻；「字幕」是该时刻前后的课程字幕，用于还原上下文。',
            '',
            '## 留言',
            '',
        ];
        for (const note of record.notes) out.push(...noteLines(record, note));
        return out.join('\n') + '\n';
    }

    const CONTEXT_EXPLAINED = '> 时间戳是我产生疑问或想法的时刻；「字幕」是该时刻前后的课程字幕，用于还原上下文。';
    const exportedAt = () => new Date().toLocaleString('zh-CN', { hour12: false });

    function noteLines(rec, note) {
        const out = [];
        const [first, ...rest] = note.text.split('\n');
        const label = KIND_LABEL[note.kind] || '想法';
        const head = `- [${formatTime(note.t)}](${urlFor(rec.id, note.t)}) **${label}**`;
        out.push(first === label ? head : `${head} ${first}`);
        for (const line of rest) out.push(`  ${line}`);
        if (note.context?.length) out.push(`  - 字幕：${note.context.join(' / ')}`);
        for (const reply of note.replies || []) {
            if (reply.role === 'teacher') out.push(`  - AI 助教：${reply.text.replace(/\n/g, '\n    ')}`);
        }
        return out;
    }

    // 笔记库：多个视频合并成一份，或把某一类留言跨视频汇总。
    function collectionMarkdown(heading, sections) {
        const total = sections.reduce((sum, section) => sum + section.notes.length, 0);
        const out = [`# ${heading}`, '', `- 导出：${exportedAt()}，共 ${total} 条，来自 ${sections.length} 个视频`, '', CONTEXT_EXPLAINED, ''];
        for (const { rec, notes } of sections) {
            out.push(`## ${rec.title || rec.id}`, '', `- 视频：${urlFor(rec.id)}`);
            if (rec.channel) out.push(`- 频道：${rec.channel}`);
            out.push('');
            for (const note of notes) out.push(...noteLines(rec, note));
            out.push('');
        }
        return out.join('\n');
    }

    // ---- 界面 ----
    const count = h('span', { className: 'ytlc-count' });
    const titleLabel = h('span', {}, '课堂留言');
    const titleCaret = h('span', { className: 'ytlc-caret', 'aria-hidden': 'true' }, '▾');
    const titleButton = h('button', {
        type: 'button',
        className: 'ytlc-title-btn',
        'aria-label': '打开笔记库',
        title: '打开笔记库',
    }, titleLabel, count, titleCaret);
    const copyButton = h('button', { type: 'button', className: 'ytlc-tool', title: '复制为 Markdown，交给 Agent 总结' }, '复制');
    const relatedButton = h('button', { type: 'button', className: 'ytlc-tool', title: '显示或隐藏推荐视频' }, '推荐');
    const clearButton = h('button', { type: 'button', className: 'ytlc-tool', title: '清空本视频的全部留言' }, '清空');
    const cord = h('span', { className: 'ytlc-cord' });
    const bead = h('span', { className: 'ytlc-bead' });
    const chain = h('span', { className: 'ytlc-chain', 'aria-hidden': 'true' }, cord, bead);
    const lamp = h('button', { type: 'button', className: 'ytlc-lamp' }, chain);
    const list = h('ol', { className: 'ytlc-list', 'aria-live': 'polite' });
    const anchorButton = h('button', { type: 'button', className: 'ytlc-anchor', hidden: true, title: '点击改为当前播放时间' });
    const input = h('textarea', {
        className: 'ytlc-input',
        rows: 1,
        placeholder: '没听懂的地方、想法、追问…',
        'aria-label': '发送留言',
    });
    const quickQuestion = h('button', { type: 'button', title: '在当前时间记一个「没听懂」' }, '？没懂');
    const quickIdea = h('button', { type: 'button', title: '先在当前时间占个位，再慢慢写想法' }, '💡 想法');
    const quickMark = h('button', { type: 'button', title: '在当前时间标记重点' }, '⭐ 重点');
    const skinToggle = h('button', {
        type: 'button',
        className: 'ytlc-skin-toggle',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-label': '更换皮肤',
        title: '更换皮肤',
    }, '皮肤 ▴');
    const skinItems = SKINS.map(skin => h('button', {
        type: 'button',
        className: 'ytlc-skin-item',
        role: 'menuitemradio',
        'aria-checked': 'false',
        'data-skin': skin.id,
        tabIndex: -1,
    },
    h('span', { className: 'ytlc-swatch', 'data-skin': skin.id, 'aria-hidden': 'true' },
        ...(skin.sprite ? [makeSprite(skin.sprite, 'on', 2)] : [])),
    h('span', { className: 'ytlc-skin-name' }, skin.name, h('small', {}, skin.sub)),
    h('span', { className: 'ytlc-skin-check', 'aria-hidden': 'true' }, '✓')));
    const skinMenu = h('div', { className: 'ytlc-skin-menu', role: 'menu', 'aria-label': '皮肤', hidden: true },
        h('div', { className: 'ytlc-skin-heading', 'aria-hidden': 'true' }, '选择皮肤'), ...skinItems);
    // ---- 笔记库界面 ----
    const searchInput = h('input', {
        type: 'search',
        className: 'ytlc-search',
        placeholder: '搜索标题或留言…',
        'aria-label': '搜索笔记',
    });
    const chips = ['all', 'question', 'note', 'mark'].map(kind => h('button', {
        type: 'button',
        className: 'ytlc-chip',
        'data-kind': kind,
        'aria-pressed': String(kind === 'all'),
    }));
    const libList = h('ol', { className: 'ytlc-lib-list' });
    const libBar = h('div', { className: 'ytlc-lib-bar' });
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    const library = h('div', { className: 'ytlc-library' },
        h('div', { className: 'ytlc-lib-tools' },
            searchInput,
            h('div', { className: 'ytlc-chips' }, ...chips, h('span', { className: 'ytlc-sort-label' }, '按最近记录'))),
        libList,
        libBar,
        fileInput);

    const panel = h('section', { className: 'ytlc-panel', 'aria-label': '听课留言板' },
        h('div', { className: 'ytlc-head' },
            h('div', { className: 'ytlc-title' }, titleButton),
            copyButton, relatedButton, clearButton, lamp),
        list,
        library,
        h('div', { className: 'ytlc-composer' },
            h('div', { className: 'ytlc-quick' }, quickQuestion, quickIdea, quickMark, anchorButton),
            input,
            h('div', { className: 'ytlc-foot' },
                h('div', { className: 'ytlc-hint' },
                    h('kbd', {}, 'Enter'), ' 发送 · ', h('kbd', {}, 'Shift+Enter'), ' 换行 · ', h('kbd', {}, '`'), ' 聚焦'),
                h('div', { className: 'ytlc-skin' }, skinMenu, skinToggle))));

    function render(flashId) {
        if (view === 'notes') count.textContent = record?.notes.length ? String(record.notes.length) : '';
        relatedButton.setAttribute('aria-pressed', String(settings.showRelated));
        if (!record?.notes.length) {
            list.replaceChildren(h('li', { className: 'ytlc-empty' },
                '听到哪里有想法就在下面留言：以问号结尾记为疑问，其余记为想法。时间戳和当时的字幕会自动记下。'));
            return;
        }
        let flashed = null;
        list.replaceChildren(...record.notes.map(note => {
            const body = h('div', { className: 'ytlc-body' },
                h('div', { className: 'ytlc-text' },
                    h('button', {
                        type: 'button',
                        className: 'ytlc-tag',
                        'aria-label': `类别：${KIND_LABEL[note.kind]}，点击改为${KIND_LABEL[KIND_NEXT[note.kind]]}`,
                        title: `点击改为「${KIND_LABEL[KIND_NEXT[note.kind]]}」`,
                        onclick: () => cycleKind(note.id),
                    },
                    h('span', { className: 'ytlc-tag-icon' }, KIND_ICON[note.kind]),
                    h('span', { className: 'ytlc-tag-label' }, KIND_LABEL[note.kind])),
                    note.id === editingId ? editor(note) : h('span', { className: 'ytlc-words' }, note.text)));
            if (note.context?.length) {
                body.append(h('div', { className: 'ytlc-context', title: note.context.join('\n') },
                    '字幕：' + note.context.at(-1)));
            }
            for (const reply of note.replies || []) body.append(h('div', { className: 'ytlc-reply' }, reply.text));
            if (pending.has(note.id)) body.append(h('div', { className: 'ytlc-reply' }, '助教思考中…'));
            const labelOnly = note.text === KIND_LABEL[note.kind];
            const item = h('li', {
                className: ['ytlc-note', labelOnly && 'ytlc-label-only', note.id === editingId && 'ytlc-editing']
                    .filter(Boolean).join(' '),
                'data-kind': note.kind,
                'data-id': note.id,
            },
                h('button', {
                    type: 'button',
                    className: 'ytlc-time',
                    title: '跳到这里',
                    onclick: () => seek(note.t),
                }, formatTime(note.t)),
                body,
                h('div', { className: 'ytlc-actions' },
                    h('button', {
                        type: 'button',
                        className: 'ytlc-edit',
                        'aria-label': '编辑这条留言',
                        title: '编辑',
                        onclick: () => startEdit(note.id),
                    }, ...pencilIcon()),
                    h('button', {
                        type: 'button',
                        className: 'ytlc-delete',
                        'aria-label': '删除这条留言',
                        title: '删除',
                        onclick: () => deleteNote(note.id),
                    }, '×')));
            if (note.id === flashId) flashed = item;
            return item;
        }));
        if (focusEditor) {
            focusEditor = false;
            const field = list.querySelector('.ytlc-edit-input');
            if (field) {
                field.focus({ preventScroll: true });
                field.setSelectionRange(field.value.length, field.value.length);
                field.scrollIntoView({ block: 'nearest' });
            }
        }
        if (flashed) {
            flashed.classList.add('ytlc-flash');
            flashed.scrollIntoView({ block: 'nearest' });
            setTimeout(() => flashed.classList.remove('ytlc-flash'), 1200);
        }
    }

    function seek(t) {
        const v = video();
        if (v) v.currentTime = t;
    }

    // 点「💡 想法」后，接下来发送的文字补进那条占位留言，而不是另起一条。
    let filling = null;

    function setAnchor(t, note = null) {
        anchor = t;
        filling = t === null ? null : note;
        anchorButton.hidden = t === null;
        if (t === null) return;
        anchorButton.textContent = `${note ? '💡' : '⏱'} ${formatTime(t)}`;
        anchorButton.title = note ? '正在补写这条想法；点击改为在当前时间另起一条' : '点击改为当前播放时间';
    }

    function send() {
        const text = input.value.trim();
        if (!text) return;
        if (filling && record?.notes.includes(filling)) {
            filling.text = text;
            saveRecord();
            render(filling.id);
        } else {
            addNote(text, anchor ?? now());
        }
        input.value = '';
        setAnchor(null);
    }

    // 留言的时间戳锚定在开始输入的那一刻，而不是按下回车的时刻：打字期间老师已经讲到后面了。
    input.addEventListener('input', () => {
        if (filling) return;
        if (!input.value.trim()) setAnchor(null);
        else if (anchor === null) setAnchor(now());
    });
    input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            send();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (filling) {
                input.value = '';
                setAnchor(null);
            }
            input.blur();
            player()?.focus({ preventScroll: true });
        }
    });
    anchorButton.addEventListener('click', () => {
        setAnchor(now());
        input.focus();
    });
    quickQuestion.addEventListener('click', () => addNote('没听懂', now(), 'question'));
    quickMark.addEventListener('click', () => addNote('重点', now(), 'mark'));
    quickIdea.addEventListener('click', () => {
        const note = addNote(KIND_LABEL.note, now(), 'note');
        // 已经在写别的留言时只占位，不打断正在写的内容。
        if (!note || input.value.trim()) return;
        setAnchor(note.t, note);
        input.focus();
    });
    copyButton.addEventListener('click', () => {
        if (!record?.notes.length) return;
        GM_setClipboard(toMarkdown(), 'text');
        copyButton.textContent = '已复制';
        setTimeout(() => { copyButton.textContent = '复制'; }, 1500);
    });
    relatedButton.addEventListener('click', () => {
        settings.showRelated = !settings.showRelated;
        saveSettings();
        syncPage();
    });
    clearButton.addEventListener('click', () => {
        if (!record?.notes.length || !confirm(`清空本视频的 ${record.notes.length} 条留言？此操作无法撤销。`)) return;
        record.notes = [];
        releaseFilling();
        saveRecord();
        render();
    });

    // ---- 拉灯开关：切换留言板自己的深色 / 浅色 ----
    // 没拉过时跟随 YouTube 页面主题（<html dark>）；拉过之后留言板用自己的选择，不再跟随。
    delete settings.theme; // 1.1.0 曾用这个键切换整个 YouTube 主题，已废弃。
    const youtubeDark = () => document.documentElement.hasAttribute('dark');

    function panelTheme() {
        return settings.panelTheme || (youtubeDark() ? 'dark' : 'light');
    }

    let pixelFontLoaded = false;
    function loadPixelFont() {
        if (pixelFontLoaded) return;
        pixelFontLoaded = true;
        let url = '';
        try { url = GM_getResourceURL('pixelFont'); } catch { /* 没有 @resource 时直接从 CDN 读取 */ }
        GM_addStyle(`@font-face {
            font-family: "YTLC Pixel";
            src: url("${url || PIXEL_FONT_URL}") format("woff2");
            font-display: swap;
        }`);
    }

    function currentSkin() {
        return SKINS.find(skin => skin.id === settings.skin) || SKINS[0];
    }

    function applyPanelTheme() {
        const theme = panelTheme();
        const skin = currentSkin();
        if (skin.sprite) loadPixelFont();
        panel.dataset.theme = theme;
        panel.dataset.skin = skin.id;
        panel.classList.toggle('ytlc-pixel', Boolean(skin.sprite));
        const lit = Boolean(skin.sprite) && theme === (skin.litWhen || 'dark');
        bead.classList.toggle('ytlc-lit', lit);
        bead.replaceChildren(...(skin.sprite ? [makeSprite(skin.sprite, lit ? 'on' : 'off', 2)] : []));
        for (const item of skinItems) item.setAttribute('aria-checked', String(item.dataset.skin === skin.id));
        lamp.setAttribute('aria-label', theme === 'dark' ? '开灯' : '关灯');
        lamp.title = theme === 'dark' ? '拉一下切换为浅色留言板' : '拉一下切换为深色留言板';
    }

    function toggleTheme() {
        settings.panelTheme = panelTheme() === 'dark' ? 'light' : 'dark';
        saveSettings();
        applyPanelTheme();
    }

    new MutationObserver(applyPanelTheme)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

    // 松手后绳子回弹，拉坠左右晃几下。
    function springBack(pull) {
        cord.style.height = '';
        if (reducedMotion.matches) return;
        cord.animate([
            { height: `${CORD_REST + pull}px` },
            { height: `${CORD_REST - 2}px`, offset: 0.45 },
            { height: `${CORD_REST + 1}px`, offset: 0.75 },
            { height: `${CORD_REST}px` },
        ], { duration: 420, easing: 'ease-out' });
        chain.animate([
            { transform: 'rotate(0)' },
            { transform: 'rotate(6deg)', offset: 0.25 },
            { transform: 'rotate(-4deg)', offset: 0.5 },
            { transform: 'rotate(2deg)', offset: 0.75 },
            { transform: 'rotate(0)' },
        ], { duration: 800, easing: 'ease-out' });
    }

    // 点击或键盘触发：自动往下拉一下，拉到底时切换，再回弹。
    function pullOnce() {
        if (reducedMotion.matches) {
            toggleTheme();
            return;
        }
        const pull = CORD_TRIGGER + 4;
        cord.animate([{ height: `${CORD_REST}px` }, { height: `${CORD_REST + pull}px` }],
            { duration: 120, easing: 'cubic-bezier(.3, 0, 1, 1)' })
            .finished.then(() => {
                toggleTheme();
                springBack(pull);
            });
    }

    let drag = null;
    let ignoreClickUntil = 0;
    lamp.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        drag = { y: event.clientY, pull: 0, moved: false };
        lamp.setPointerCapture(event.pointerId);
        lamp.classList.add('ytlc-dragging');
    });
    lamp.addEventListener('pointermove', event => {
        if (!drag) return;
        const dy = event.clientY - drag.y;
        if (Math.abs(dy) > 3) drag.moved = true;
        // 越往下越拉不动，模仿绳子的阻力。
        drag.pull = Math.min(CORD_MAX_PULL, Math.max(0, dy) * 0.8);
        cord.style.height = `${CORD_REST + drag.pull}px`;
    });
    function endDrag(event) {
        if (!drag) return;
        const { pull, moved } = drag;
        drag = null;
        lamp.classList.remove('ytlc-dragging');
        if (!moved) {
            cord.style.height = '';
            return;
        }
        // 拖动后浏览器还会补一个 click，忽略它，避免切换两次。
        ignoreClickUntil = performance.now() + 500;
        if (event.type === 'pointerup' && pull >= CORD_TRIGGER) toggleTheme();
        springBack(pull);
    }
    lamp.addEventListener('pointerup', endDrag);
    lamp.addEventListener('pointercancel', endDrag);
    lamp.addEventListener('click', () => {
        if (performance.now() < ignoreClickUntil) return;
        pullOnce();
    });

    // ---- 笔记库：所有视频的留言，按最近记录排序 ----
    let view = 'notes';
    let libKind = 'all';
    let libStatus = '';
    let libStatusTimer = 0;
    const libSelected = new Set();
    const libExpanded = new Set();

    function allRecords() {
        return GM_listValues()
            .filter(key => key.startsWith(RECORD_PREFIX))
            .map(key => {
                const id = key.slice(RECORD_PREFIX.length);
                return id === record?.id ? record : loadRecord(id);
            })
            .filter(rec => rec.notes?.length);
    }

    // 最近记录时间：最后一条留言的创建或编辑时间。
    function lastActive(rec) {
        return rec.notes.reduce((latest, note) => {
            const time = [note.createdAt, note.editedAt].filter(Boolean).sort().at(-1) || '';
            return time > latest ? time : latest;
        }, '');
    }

    function formatDay(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        const now = new Date();
        const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diff = Math.round((day(now) - day(date)) / 86400000);
        if (diff === 0) return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        if (diff === 1) return '昨天';
        const md = `${date.getMonth() + 1}/${date.getDate()}`;
        return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}/${md}`;
    }

    function kindMark(kind, className, ...extra) {
        return h('span', { className, 'data-kind': kind },
            h('span', { className: 'ytlc-tag-icon' }, KIND_ICON[kind]),
            h('span', { className: 'ytlc-tag-label' }, KIND_LABEL[kind]),
            ...extra);
    }

    function libNoteItem(rec, note) {
        return h('li', { className: 'ytlc-lib-note' },
            h('button', {
                type: 'button',
                className: 'ytlc-time',
                title: '打开视频并跳到这里',
                onclick: () => openAt(rec.id, note.t),
            }, formatTime(note.t)),
            kindMark(note.kind, 'ytlc-kind'),
            h('span', { className: 'ytlc-lib-text' }, note.text === KIND_LABEL[note.kind] ? '' : note.text));
    }

    function openAt(id, t) {
        if (id === videoId) {
            seek(t);
            setView('notes');
        } else {
            location.assign(urlFor(id, t));
        }
    }

    function setLibStatus(text) {
        libStatus = text;
        clearTimeout(libStatusTimer);
        libStatusTimer = setTimeout(() => {
            libStatus = '';
            if (view === 'library') renderLibrary();
        }, 2500);
        renderLibrary();
    }

    function renderLibrary() {
        const query = searchInput.value.trim().toLowerCase();
        const hit = text => !query || (text || '').toLowerCase().includes(query);
        const noteHit = (rec, note) => hit(note.text) || hit(rec.title) || hit(rec.channel);
        const records = allRecords().sort((a, b) => lastActive(b).localeCompare(lastActive(a)));
        const ids = new Set(records.map(rec => rec.id));
        for (const id of [...libSelected]) if (!ids.has(id)) libSelected.delete(id);

        const counts = { question: 0, note: 0, mark: 0 };
        for (const rec of records) for (const note of rec.notes) if (noteHit(rec, note)) counts[note.kind] = (counts[note.kind] || 0) + 1;
        for (const chip of chips) {
            const kind = chip.dataset.kind;
            chip.setAttribute('aria-pressed', String(kind === libKind));
            chip.replaceChildren(...(kind === 'all' ? ['全部'] : [
                h('span', { className: 'ytlc-tag-icon' }, `${KIND_ICON[kind]} `), KIND_LABEL[kind], h('i', {}, String(counts[kind])),
            ]));
            if (kind !== 'all') chip.setAttribute('aria-label', `${KIND_LABEL[kind]} ${counts[kind]}`);
        }

        let items;
        let sections = [];
        if (libKind === 'all') {
            const visible = records.filter(rec => hit(rec.title) || hit(rec.channel) || rec.notes.some(note => hit(note.text)));
            count.textContent = `${visible.length} 个视频`;
            items = visible.map(rec => {
                const expanded = libExpanded.has(rec.id);
                const perKind = { question: 0, note: 0, mark: 0 };
                for (const note of rec.notes) perKind[note.kind] = (perKind[note.kind] || 0) + 1;
                const check = h('input', {
                    type: 'checkbox',
                    className: 'ytlc-check',
                    checked: libSelected.has(rec.id),
                    'aria-label': `选择「${rec.title || rec.id}」`,
                });
                check.addEventListener('change', () => {
                    if (check.checked) libSelected.add(rec.id);
                    else libSelected.delete(rec.id);
                    renderLibrary();
                });
                const meta = h('span', { className: 'ytlc-vmeta' });
                if (rec.channel) meta.append(h('span', {}, rec.channel));
                meta.append(h('span', {}, formatDay(lastActive(rec))));
                if (rec.id === videoId) meta.append(h('span', { className: 'ytlc-now' }, '正在看'));
                const info = h('button', {
                    type: 'button',
                    className: 'ytlc-vinfo',
                    'aria-expanded': String(expanded),
                    onclick: () => {
                        if (expanded) libExpanded.delete(rec.id);
                        else libExpanded.add(rec.id);
                        renderLibrary();
                    },
                },
                h('span', { className: 'ytlc-vtitle' }, rec.title || rec.id),
                meta,
                h('span', { className: 'ytlc-badges' },
                    ...['question', 'note', 'mark'].filter(kind => perKind[kind])
                        .map(kind => kindMark(kind, 'ytlc-badge', ` ${perKind[kind]}`))));
                const item = h('li', { className: rec.id === videoId ? 'ytlc-video ytlc-current' : 'ytlc-video', 'data-id': rec.id },
                    h('div', { className: 'ytlc-video-row' },
                        check, info, h('span', { className: 'ytlc-vcaret', 'aria-hidden': 'true' }, expanded ? '▾' : '▸')));
                if (expanded) item.append(h('ol', { className: 'ytlc-lib-notes' }, ...rec.notes.map(note => libNoteItem(rec, note))));
                return item;
            });
        } else {
            sections = records
                .map(rec => ({ rec, notes: rec.notes.filter(note => note.kind === libKind && noteHit(rec, note)) }))
                .filter(section => section.notes.length);
            count.textContent = `${counts[libKind]} 条${KIND_LABEL[libKind]}`;
            items = sections.map(({ rec, notes }) => h('li', { className: 'ytlc-group', 'data-id': rec.id },
                h('div', { className: 'ytlc-group-head' },
                    h('b', { title: rec.title || rec.id }, rec.title || rec.id),
                    h('span', {}, formatDay(lastActive(rec)))),
                h('ol', { className: 'ytlc-lib-notes' }, ...notes.map(note => libNoteItem(rec, note)))));
        }
        const emptyText = records.length ? '没有符合条件的笔记。' : '还没有任何笔记。在视频里发出第一条留言后，这里会列出所有记过笔记的视频。';
        libList.replaceChildren(...(items.length ? items : [h('li', { className: 'ytlc-lib-empty' }, emptyText)]));

        // 底栏：左边是针对当前视图的操作，右边是备份。
        const left = [];
        if (libStatus) {
            left.push(h('span', { className: 'ytlc-lib-status', role: 'status' }, libStatus));
        } else if (libKind === 'all') {
            if (libSelected.size) {
                left.push(h('span', {}, `已选 ${libSelected.size} 个`),
                    h('button', { type: 'button', className: 'ytlc-bar-btn ytlc-primary', onclick: () => copySelected(records) }, '合并复制'),
                    h('button', { type: 'button', className: 'ytlc-bar-btn', onclick: deleteSelected }, '删除'));
            } else {
                left.push(h('span', { className: 'ytlc-lib-status' }, '勾选视频可合并复制或删除'));
            }
        } else {
            const total = sections.reduce((sum, section) => sum + section.notes.length, 0);
            const copyKind = h('button', {
                type: 'button',
                className: 'ytlc-bar-btn ytlc-primary',
                onclick: () => {
                    GM_setClipboard(collectionMarkdown(`所有「${KIND_LABEL[libKind]}」`, sections), 'text');
                    setLibStatus(`已复制 ${total} 条${KIND_LABEL[libKind]}`);
                },
            }, `复制这 ${total} 条${KIND_LABEL[libKind]}`);
            copyKind.disabled = !total;
            left.push(copyKind);
        }
        libBar.replaceChildren(...left, h('span', { className: 'ytlc-bar-links' },
            h('button', { type: 'button', className: 'ytlc-link', title: '把所有笔记导出为 JSON 备份文件', onclick: exportAll }, '导出全部'),
            '·',
            h('button', { type: 'button', className: 'ytlc-link', title: '从 JSON 备份文件导入，已有的留言不会重复', onclick: () => fileInput.click() }, '导入')));
    }

    function copySelected(records) {
        const sections = records.filter(rec => libSelected.has(rec.id)).map(rec => ({ rec, notes: rec.notes }));
        GM_setClipboard(collectionMarkdown(`听课留言合集：${sections.length} 个视频`, sections), 'text');
        setLibStatus(`已复制 ${sections.length} 个视频的留言`);
    }

    function deleteSelected() {
        const size = libSelected.size;
        if (!size || !confirm(`删除选中的 ${size} 个视频的全部留言？此操作无法撤销。`)) return;
        for (const id of libSelected) {
            GM_deleteValue(RECORD_PREFIX + id);
            libExpanded.delete(id);
            if (id === record?.id) {
                record.notes = [];
                releaseFilling();
                render();
            }
        }
        libSelected.clear();
        setLibStatus(`已删除 ${size} 个视频的留言`);
    }

    function exportAll() {
        const records = allRecords();
        const data = { format: 'youtube-lecture-chat', version: VERSION, exportedAt: new Date().toISOString(), records };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const date = new Date();
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
        const link = h('a', { href: URL.createObjectURL(blob), download: `youtube-lecture-notes-${stamp}.json` });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
        setLibStatus(`已导出 ${records.length} 个视频`);
    }

    // 导入时按留言 id 合并：已有的留言保留不动，只补上没有的。
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (data?.format !== 'youtube-lecture-chat' || !Array.isArray(data.records)) throw new Error('不是留言板导出的备份文件');
            let videos = 0;
            let added = 0;
            for (const incoming of data.records) {
                if (typeof incoming?.id !== 'string' || !Array.isArray(incoming.notes)) continue;
                const target = incoming.id === record?.id ? record : loadRecord(incoming.id);
                const known = new Set(target.notes.map(note => note.id));
                let fresh = 0;
                for (const note of incoming.notes) {
                    if (!note?.id || known.has(note.id) || typeof note.text !== 'string' || !Number.isFinite(note.t)) continue;
                    target.notes.push({ context: [], replies: [], ...note, kind: KIND_LABEL[note.kind] ? note.kind : 'note' });
                    known.add(note.id);
                    fresh++;
                }
                if (!fresh) continue;
                target.notes.sort((a, b) => a.t - b.t);
                target.title ||= incoming.title || '';
                target.channel ||= incoming.channel || '';
                if (!target.playlistId && incoming.playlistId) target.playlistId = incoming.playlistId;
                GM_setValue(RECORD_PREFIX + target.id, target);
                videos++;
                added += fresh;
            }
            if (record) render();
            setLibStatus(added ? `已导入 ${videos} 个视频，新增 ${added} 条留言` : '没有需要导入的新留言');
        } catch (error) {
            setLibStatus(`导入失败：${error.message}`);
        }
    });

    function setView(next) {
        if (view === next) return;
        if (editingId) finishEdit(true, false);
        closeSkinMenu(false);
        view = next;
        panel.dataset.view = next;
        const toLibrary = next === 'library';
        titleLabel.textContent = toLibrary ? '笔记库' : '课堂留言';
        titleCaret.textContent = toLibrary ? '▴' : '▾';
        titleButton.setAttribute('aria-label', toLibrary ? '返回本视频留言' : '打开笔记库');
        titleButton.title = toLibrary ? '返回本视频留言' : '打开笔记库';
        if (toLibrary) renderLibrary();
        else render();
    }

    titleButton.addEventListener('click', () => setView(view === 'library' ? 'notes' : 'library'));
    searchInput.addEventListener('input', renderLibrary);
    for (const chip of chips) {
        chip.addEventListener('click', () => {
            libKind = chip.dataset.kind;
            renderLibrary();
        });
    }

    // ---- 皮肤选单：右下角向上弹出 ----
    function openSkinMenu() {
        loadPixelFont();
        skinMenu.hidden = false;
        skinToggle.setAttribute('aria-expanded', 'true');
        (skinItems.find(item => item.getAttribute('aria-checked') === 'true') || skinItems[0]).focus();
    }

    function closeSkinMenu(refocus) {
        if (skinMenu.hidden) return;
        skinMenu.hidden = true;
        skinToggle.setAttribute('aria-expanded', 'false');
        if (refocus) skinToggle.focus();
    }

    skinToggle.addEventListener('click', () => {
        if (skinMenu.hidden) openSkinMenu();
        else closeSkinMenu(false);
    });
    for (const item of skinItems) {
        item.addEventListener('click', () => {
            settings.skin = item.dataset.skin;
            saveSettings();
            applyPanelTheme();
            closeSkinMenu(true);
        });
    }
    skinMenu.addEventListener('keydown', event => {
        const index = skinItems.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            skinItems[(index + step + skinItems.length) % skinItems.length].focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeSkinMenu(true);
        } else if (event.key === 'Tab') {
            closeSkinMenu(false);
        }
    });
    document.addEventListener('pointerdown', event => {
        if (!skinMenu.hidden && !event.target.closest?.('.ytlc-skin')) closeSkinMenu(false);
    }, true);
    // 面板里的按键不交给 YouTube：方向键、空格、k/j/l 等在这里不应控制播放器。
    panel.addEventListener('keydown', event => event.stopPropagation());

    applyPanelTheme();

    document.addEventListener('keydown', event => {
        if (event.code !== 'Backquote' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (!panel.isConnected || event.target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        setView('notes');
        input.focus();
    }, true);
    // timeupdate 不冒泡，但在捕获阶段能收到，这样换了 video 元素也不用重新绑定。
    document.addEventListener('timeupdate', captureCaptions, true);

    // ---- 页面挂载 ----
    function mountPanel() {
        if (!videoId) return;
        const host = document.querySelector(':is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) #secondary-inner')
            || document.querySelector(':is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) #secondary');
        if (host && (panel.parentElement !== host || host.firstElementChild !== panel)) host.prepend(panel);
    }

    // YouTube 站内导航不重载脚本，右栏也可能晚于导航完成才出现。
    const observer = new MutationObserver(mountPanel);
    function syncPage() {
        const id = currentVideoId();
        if (id !== videoId) {
            if (record) saveRecord();
            videoId = id;
            record = id ? loadRecord(id) : null;
            captionLog = [];
            editingId = null;
            input.value = '';
            setAnchor(null);
            render();
            if (view === 'library') renderLibrary();
        }
        document.documentElement.classList.toggle('ytlc-hide-related', Boolean(id) && !settings.showRelated);
        relatedButton.setAttribute('aria-pressed', String(settings.showRelated));
        observer.disconnect();
        if (!id) {
            panel.remove();
            return;
        }
        mountPanel();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('yt-navigate-finish', syncPage);
    window.addEventListener('popstate', syncPage);
    syncPage();
})();
