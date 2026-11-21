// ==UserScript==
// @name         YouTube 听课留言板
// @namespace    https://github.com/DARX1024/Personal-Projects
// @version      1.2.0
// @description  把观看页右侧的推荐视频换成一个只属于自己的「直播间」：随手发疑问和想法，自动记下视频时间戳和当时的字幕，课后一键复制给 Agent 总结。
// @author       DARX1024
// @match        https://www.youtube.com/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-lecture-chat/youtube-lecture-chat.user.js
// @updateURL    https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-lecture-chat/youtube-lecture-chat.user.js
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '1.2.0';
    const RECORD_PREFIX = 'video:';
    const SETTINGS_KEY = 'settings';
    // 留言附带的字幕范围：锚定时刻之前 20 秒到之后 5 秒。
    const CONTEXT_BEFORE = 20;
    const CONTEXT_AFTER = 5;
    const CAPTION_LOG_LIMIT = 400;
    const KIND_LABEL = { question: '疑问', mark: '重点', note: '想法' };
    // 拉灯开关：绳子静止长度、最多能拉下的长度、松手时超过多少算拉到底。
    const CORD_REST = 18;
    const CORD_MAX_PULL = 14;
    const CORD_TRIGGER = 8;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

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
            font-size: 16px;
            font-weight: 500;
            white-space: nowrap;
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
        .ytlc-panel[data-theme="dark"] .ytlc-bead {
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
        .ytlc-note[data-kind="question"] .ytlc-text::before { content: "❓ "; }
        .ytlc-note[data-kind="mark"] .ytlc-text::before { content: "⭐ "; }
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
        .ytlc-delete {
            flex: none;
            width: 24px;
            height: 24px;
            padding: 0;
            border: 0;
            border-radius: 12px;
            background: none;
            color: var(--ytlc-muted) !important;
            visibility: hidden;
        }
        .ytlc-note:is(:hover, :focus-within) .ytlc-delete { visibility: visible; }
        .ytlc-delete:hover { background: var(--ytlc-line); }
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
        .ytlc-hint {
            margin-top: 6px;
            color: var(--ytlc-muted);
            font-size: 12px;
        }
        .ytlc-hint kbd {
            padding: 0 4px;
            border: 1px solid var(--ytlc-line);
            border-radius: 4px;
            font: inherit;
        }
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

    function videoUrl(t) {
        const base = `https://www.youtube.com/watch?v=${videoId}`;
        return t === undefined ? base : `${base}&t=${Math.floor(t)}s`;
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
    function inferKind(text) {
        return /^[?？]|[?？]\s*$/.test(text) ? 'question' : 'note';
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

    function deleteNote(id) {
        record.notes = record.notes.filter(note => note.id !== id);
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
        for (const note of record.notes) {
            const [first, ...rest] = note.text.split('\n');
            const label = KIND_LABEL[note.kind] || '想法';
            const head = `- [${formatTime(note.t)}](${videoUrl(note.t)}) **${label}**`;
            out.push(first === label ? head : `${head} ${first}`);
            for (const line of rest) out.push(`  ${line}`);
            if (note.context?.length) out.push(`  - 字幕：${note.context.join(' / ')}`);
            for (const reply of note.replies || []) {
                if (reply.role === 'teacher') out.push(`  - AI 助教：${reply.text.replace(/\n/g, '\n    ')}`);
            }
        }
        return out.join('\n') + '\n';
    }

    // ---- 界面 ----
    const count = h('span', { className: 'ytlc-count' });
    const copyButton = h('button', { type: 'button', className: 'ytlc-tool', title: '复制为 Markdown，交给 Agent 总结' }, '复制');
    const relatedButton = h('button', { type: 'button', className: 'ytlc-tool', title: '显示或隐藏推荐视频' }, '推荐');
    const clearButton = h('button', { type: 'button', className: 'ytlc-tool', title: '清空本视频的全部留言' }, '清空');
    const cord = h('span', { className: 'ytlc-cord' });
    const chain = h('span', { className: 'ytlc-chain', 'aria-hidden': 'true' }, cord, h('span', { className: 'ytlc-bead' }));
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
    const quickMark = h('button', { type: 'button', title: '在当前时间标记重点' }, '⭐ 重点');
    const panel = h('section', { className: 'ytlc-panel', 'aria-label': '听课留言板' },
        h('div', { className: 'ytlc-head' },
            h('div', { className: 'ytlc-title' }, '课堂留言', count),
            copyButton, relatedButton, clearButton, lamp),
        list,
        h('div', { className: 'ytlc-composer' },
            h('div', { className: 'ytlc-quick' }, quickQuestion, quickMark, anchorButton),
            input,
            h('div', { className: 'ytlc-hint' },
                h('kbd', {}, 'Enter'), ' 发送 · ', h('kbd', {}, 'Shift+Enter'), ' 换行 · ', h('kbd', {}, '`'), ' 随时聚焦')));

    function render(flashId) {
        count.textContent = record?.notes.length ? String(record.notes.length) : '';
        relatedButton.setAttribute('aria-pressed', String(settings.showRelated));
        if (!record?.notes.length) {
            list.replaceChildren(h('li', { className: 'ytlc-empty' },
                '听到哪里有疑问或想法就在下面留言，时间戳和当时的字幕会自动记下。'));
            return;
        }
        let flashed = null;
        list.replaceChildren(...record.notes.map(note => {
            const body = h('div', { className: 'ytlc-body' }, h('div', { className: 'ytlc-text' }, note.text));
            if (note.context?.length) {
                body.append(h('div', { className: 'ytlc-context', title: note.context.join('\n') },
                    '字幕：' + note.context.at(-1)));
            }
            for (const reply of note.replies || []) body.append(h('div', { className: 'ytlc-reply' }, reply.text));
            if (pending.has(note.id)) body.append(h('div', { className: 'ytlc-reply' }, '助教思考中…'));
            const item = h('li', { className: 'ytlc-note', 'data-kind': note.kind },
                h('button', {
                    type: 'button',
                    className: 'ytlc-time',
                    title: '跳到这里',
                    onclick: () => seek(note.t),
                }, formatTime(note.t)),
                body,
                h('button', {
                    type: 'button',
                    className: 'ytlc-delete',
                    'aria-label': '删除这条留言',
                    onclick: () => deleteNote(note.id),
                }, '×'));
            if (note.id === flashId) flashed = item;
            return item;
        }));
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

    function setAnchor(t) {
        anchor = t;
        anchorButton.hidden = t === null;
        if (t !== null) anchorButton.textContent = `⏱ ${formatTime(t)}`;
    }

    function send() {
        const text = input.value.trim();
        if (!text) return;
        addNote(text, anchor ?? now());
        input.value = '';
        setAnchor(null);
    }

    // 留言的时间戳锚定在开始输入的那一刻，而不是按下回车的时刻：打字期间老师已经讲到后面了。
    input.addEventListener('input', () => {
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

    function applyPanelTheme() {
        const theme = panelTheme();
        panel.dataset.theme = theme;
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

    applyPanelTheme();

    document.addEventListener('keydown', event => {
        if (event.code !== 'Backquote' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (!panel.isConnected || event.target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
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
            input.value = '';
            setAnchor(null);
            render();
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
