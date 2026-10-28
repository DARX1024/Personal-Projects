// ==UserScript==
// @name         EH / EX 种子择优下载
// @namespace    local.mangah.eh-torrent-downloader
// @version      1.9.8.2
// @description  EH / EX 下载、批量和去重；nhentai 仅增加下载 metadata，导出中文 ComicInfo.xml。
// @match        *://e-hentai.org/*
// @match        *://exhentai.org/*
// @match        *://nhentai.net/*
// @match        *://www.nhentai.net/*
// @match        *://nhentai.xxx/*
// @match        *://www.nhentai.xxx/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_info
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @grant        GM_addValueChangeListener
// @grant        GM_getResourceText
// @connect      e-hentai.org
// @connect      exhentai.org
// @connect      ehtracker.org
// @connect      hath.network
// @connect      api.e-hentai.org
// @resource     metadataDictionary https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/eh-torrent-downloader/metadata-dictionary.json
// @downloadURL  https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/eh-torrent-downloader/eh-torrent-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/eh-torrent-downloader/eh-torrent-downloader.user.js
// ==/UserScript==

(() => {
    'use strict';

    const SITES = new Set(['e-hentai.org', 'exhentai.org']);
    const NH_SITES = new Set(['nhentai.net', 'www.nhentai.net', 'nhentai.xxx', 'www.nhentai.xxx']);
    const FILE_HOSTS = new Set([...SITES, 'ehtracker.org']);
    const LABELS = {
        downloads: ['Downloads', 'Downloaded', 'Completed', 'Download Count', '完成', '已完成', '完成次数', '完成次數', '下载量', '下载数', '下載數', '下载次数', '下載次數'],
        posted: ['Posted', 'Added', '发布于', '發佈於', '发表于', '發表於', '发布时间', '發佈時間', '发表时间', '發表時間', '上传时间', '上傳時間'],
        size: ['Size', 'File Size', '大小', '文件大小', '檔案大小'],
    };
    const AUTO_KEY = 'autoOnGallery';
    const SAVE_AS_KEY = 'saveAs';
    const BATCH_INTERVAL_KEY = 'batchDownloadInterval';
    const BATCH_INTERVAL_DEFAULT = { min: 0.25, max: 0.5 };
    const HISTORY_KEY = 'downloadedTorrents';
    const HISTORY_LIMIT = 100;
    const HISTORY_LIMIT_KEY = 'historyLimit';
    const ARCHIVE_CONFIRM_KEY = 'confirmArchiveCost';
    const TITLE_LIMIT = 512;
    const VERSION = '1.9.8.2';
    const HISTORY_REV_KEY = 'downloadHistoryRevision';
    const TAB_STATE_KEY = 'ehtdCoordination151';
    const CLAIM_TTL = 180000;
    const MUTEX_TTL = 15000;

    const METADATA_API = 'https://api.e-hentai.org/api.php';
    // metadata-dictionary.json: generated from the same offline dictionary as MangaMetadata.
    // Labels: EhTagTranslation/Database, CC BY-NC-SA 3.0; https://github.com/EhTagTranslation/Database
    // Snapshot commit: 0eaf24ee6ffea4a744f7d597e8471d9d365b883e
    // 词库经 @resource 随脚本安装；只在导出 metadata 时解析，平时打开页面不承担解析开销。
    let metadataDictionaryCache = null;
    const METADATA_LANGUAGES = { chinese: 'zh', japanese: 'ja', english: 'en', korean: 'ko',
        french: 'fr', spanish: 'es', german: 'de', russian: 'ru', portuguese: 'pt', thai: 'th',
        vietnamese: 'vi', indonesian: 'id', italian: 'it', polish: 'pl', arabic: 'ar', dutch: 'nl',
        hungarian: 'hu', ukrainian: 'uk', turkish: 'tr', speechless: 'zxx' };
    let metadataBusy = false;
    let metadataFlatLabels;

    function decodeHTML(value) {
        // Decode API HTML entities while retaining literal angle brackets as text.
        const text = document.createElement('textarea');
        text.innerHTML = String(value || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return text.value;
    }

    function metadataText(value) {
        return normalize(decodeHTML(value).normalize('NFKC'));
    }

    function metadataTitle(value) {
        let title = metadataText(value).replace(/\.(?:zip|cbz|rar|cbr|7z|cb7|pdf|epub)$/i, '').trim()
            .replace(/^\s*\([^)]*\)\s*(?=\[)/, '');
        const part = /^(?:前[編篇]|中[編篇]|後[編篇]|[上中下](?:巻|卷|編|篇)|[上中下])$/;
        title = title.replace(/\[[^\]]*\]|【[^】]*】/g, (block, offset) => {
            const label = block.slice(1, -1).trim();
            return /第?\d+\s*(?:巻|卷|話|话|章)|(?:vol(?:ume)?|chapter)\.?\s*\d+/i.test(label)
                || (title.slice(0, offset).trim() && part.test(label)) ? ` ${label} ` : ' ';
        }).split('|')[0].trim();
        for (;;) {
            const tail = title.match(/\s*\(([^()]*)\)\s*$/);
            if (!tail || tail.index === 0 || part.test(tail[1].trim())) break;
            title = title.slice(0, tail.index).trim();
        }
        return normalize(title);
    }

    function metadataNumber(title) {
        // Same conservative numbering rules as series_identity.split_title.
        const monthly = title.match(/^(.+?)\s*((?:19|20)\d{2})\s*(?:年|[-./])\s*(0?[1-9]|1[0-2])\s*(?:月(?:号|號)?)?$/);
        if (monthly) return `${monthly[2]}.${monthly[3].padStart(2, '0')}`;
        for (const hit of title.matchAll(/\d+(?:\.\d+)?/g)) {
            const tail = title.slice(hit.index + hit[0].length);
            const family = title.slice(0, hit.index).trim().replace(/(?:vol(?:ume)?\.?|#|第)\s*$/i, '')
                .replace(/[ \-~～〜—–+_/#]+$/, '');
            if (family.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
            if (/^(?:\d{2}|(?:19|20)\d{2})$/.test(hit[0]) && /^\s*(?:SS|FW|AW)(?=$|[\s()\[\]{}:：_+~～〜—–-])/i.test(tail)
                || /^\s*[-–—~～〜/+&_,，、]\s*\d/.test(tail)
                || /^(?:19|20)\d{2}(?:\.\d{1,2})?$/.test(hit[0]) && /^\s*(?:[年月./-]|$)/.test(tail)) return '';
            if (/^\s*(?:[ヶケか箇个個]?月|週間|週|日|年|時間|時|分|秒|歳|才|人)(?=$|\s|間|後|前|目|の|を|で|に|も|が|と|は|[。、!?])/.test(tail)
                || /^[\s-]*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?)\b/i.test(tail)) continue;
            return hit[0].replace(/^0+(?=\d)/, '');
        }
        return '';
    }

    function metadataCredits(value) {
        let title = metadataText(value);
        const artists = [], groups = [], generic = [];
        const event = /^(?:c\d{2,3}|comiket\s*\d+|comic1\s*[☆★*]?\s*\d+|コミケ\s*\d+|エアコミケ\s*\d*|コミティア\s*\d+|例大祭\s*\d*|サンクリ\s*\d+)$/i;
        const noise = /汉化|漢化|翻訳|翻譯|翻译|中国語|中国语|中文|官方|日语社|無修正|无修正|無碼|无码|^(?:(?:chinese|english|japanese|korean|spanish|french|german|russian|portuguese|thai|vietnamese|indonesian)(?:\s+translation)?|translated|translation|digital(?:\s+edition)?|dl(?:\s+ver(?:sion)?)?|full\s*colou?r|uncensored|decensored|censored|complete|ongoing|incomplete|pixiv|fanbox|patreon|fanbox _ patreon|fanbox patreon|r18|r18g)$/i;
        for (;;) {
            const round = title.match(/^\(([^()]*)\)\s*/);
            if (round && (event.test(round[1].trim()) || /^(?:成年コミック|一般コミック|同人誌|同人CG集)$/i.test(round[1].trim()))) {
                title = title.slice(round[0].length); continue;
            }
            const block = title.match(/^\[([^\[\]]*)\]\s*/);
            if (!block) break;
            const name = block[1].trim();
            const paired = name.match(/^(.+?)\s*\((.+?)\)\s*$/);
            if (!event.test(name) && paired) {
                groups.push(paired[1].trim()); artists.push(...paired[2].split(/[,、&＋+]/).map(n => n.trim()).filter(Boolean));
            } else if (!event.test(name) && !noise.test(name) && name) generic.push(name);
            title = title.slice(block[0].length);
        }
        return { artists, groups, generic };
    }

    function metadataDictionary() {
        if (metadataDictionaryCache) return metadataDictionaryCache;
        let dictionary;
        try { dictionary = JSON.parse(GM_getResourceText('metadataDictionary')); } catch { /* 下方统一报错。 */ }
        if (!dictionary || typeof dictionary.namespaces !== 'object' || typeof dictionary.entries !== 'object' || typeof dictionary.overrides !== 'object') {
            throw new Error('metadata 中文词库未能载入，请在 Tampermonkey 中更新或重新安装脚本。');
        }
        return (metadataDictionaryCache = dictionary);
    }

    function metadataLabels(keys) {
        const dictionary = metadataDictionary();
        const rows = keys.map(key => {
            const split = key.indexOf(':'), namespace = key.slice(0, split), name = key.slice(split + 1);
            let label = key;
            if (namespace === 'tag') {
                // NH has no gender namespaces. Translate only unanimous dictionary labels;
                // retain the original tag key instead of inventing an EH namespace.
                if (!metadataFlatLabels) {
                    metadataFlatLabels = new Map();
                    for (const [key, translated] of Object.entries(dictionary.entries)) {
                        if (!/^(?:male|female|mixed|other|location):/.test(key)) continue;
                        const name = key.slice(key.indexOf(':') + 1);
                        if (!metadataFlatLabels.has(name)) metadataFlatLabels.set(name, new Set());
                        metadataFlatLabels.get(name).add(translated);
                    }
                }
                const translations = metadataFlatLabels.get(name);
                if (translations?.size === 1) label = '标签：' + [...translations][0];
            } else if (split > 0 && ['circle', 'event', 'platform'].includes(namespace)) {
                label = { circle: '社团', event: '展会', platform: '平台' }[namespace] + '：' + name;
            } else if (split > 0 && Object.hasOwn(dictionary.namespaces, namespace)) {
                if (['artist', 'group', 'cosplayer'].includes(namespace) && !Object.hasOwn(dictionary.overrides, key)) {
                    label = dictionary.namespaces[namespace] + '：' + name;
                } else if (Object.hasOwn(dictionary.entries, key)) label = dictionary.namespaces[namespace] + '：' + dictionary.entries[key];
            }
            return { key, label };
        });
        const counts = new Map();
        for (const row of rows) counts.set(row.label, (counts.get(row.label) || 0) + 1);
        return rows.map(row => row.label + (counts.get(row.label) > 1 ? ` [${row.key}]` : ''));
    }

    function metadataFields(gallery) {
        const unique = values => [...new Set(values.map(n => n.trim()).filter(Boolean))];
        const names = namespace => unique(gallery.tags.filter(t => t.startsWith(namespace + ':')).map(t => t.slice(namespace.length + 1))).sort();
        let artists = names('artist'), groups = names('group');
        const signed = [gallery.title_jpn, gallery.title].filter(Boolean).map(metadataCredits)
            .find(c => c.artists.length || c.groups.length || c.generic.length);
        if (signed) {
            if (!artists.length) artists = unique(signed.artists);
            if (!groups.length) groups = unique(signed.groups);
            if (!artists.length && !groups.length) {
                if (signed.generic.some(n => /anthology|アンソロジー|合同誌|合刊/i.test(n))) groups = ['【合刊】'];
                else artists = unique(signed.generic);
            }
        }
        const title = metadataTitle(gallery.title || gallery.title_jpn);
        if (!title) throw new Error('来源题名无法生成有效 Title，请人工处理。');
        const languages = names('language').filter(n => Object.hasOwn(METADATA_LANGUAGES, n));
        let language = '';
        const hints = { chinese: /汉化|漢化|中国翻訳|中国翻譯|中国翻译|中国語|中国语|中國語|中國语|中文|\bchinese\b|\bchn\b/i,
            english: /\benglish\b|英語|英语/i, japanese: /\bjapanese\b|日本語|日语原版/i, korean: /\bkorean\b|韓国語|韩语/i };
        const languageHint = value => {
            const annotations = [...metadataText(value).matchAll(/\[([^\[\]]*)\]/g)].map(m => m[1]).join(' ');
            for (const [name, pattern] of Object.entries(hints)) if (pattern.test(annotations)) return METADATA_LANGUAGES[name];
            for (const name of ['spanish', 'french', 'german', 'russian', 'portuguese', 'thai', 'vietnamese', 'indonesian']) {
                if (new RegExp(`\\b${name}\\b`, 'i').test(annotations)) return METADATA_LANGUAGES[name];
            }
            return '';
        };
        language = languageHint(gallery.title || gallery.title_jpn) || METADATA_LANGUAGES[languages[0]]
            || languageHint(gallery.title_jpn) || (!languages.length && /[\u3040-\u30ff]/.test(gallery.title_jpn || '') ? 'ja' : '');
        if (!language) throw new Error('来源语言不明确，无法生成 LanguageISO，请人工处理。');
        const tags = unique(gallery.tags.filter(t => !/^language:|(?:^|:)(?:uncensored|decensored|censored|mosaic censorship|full censorship|rewrite|colorized)$/i.test(t))).sort();
        const keys = unique([...tags, ...artists.map(n => 'artist:' + n), ...groups.map(n => 'group:' + n)]);
        return { Title: title, Number: metadataNumber(title), Penciller: artists.join(', '), MangaGroups: groups.join(', '),
            LanguageISO: language, PageCount: /^[1-9]\d*$/.test(String(gallery.filecount || '')) ? String(gallery.filecount) : '',
            Web: gallery.web || `https://e-hentai.org/g/${gallery.gid}/${gallery.token.toLowerCase()}/`, Tags: metadataLabels(keys).join(', '),
            MangaTagKeys: keys.join(', '), MangaSourceTitle: gallery.title || '', MangaSourceTitleJpn: gallery.title_jpn || '' };
    }

    function metadataXML(gallery) {
        const doc = document.implementation.createDocument('', 'ComicInfo');
        for (const [name, value] of Object.entries(metadataFields(gallery))) {
            if (!value) continue;
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)) throw new Error('metadata 字段含有 XML 无法保存的字符，请人工处理。');
            const node = doc.createElement(name); node.textContent = value;
            doc.documentElement.append(doc.createTextNode('\n  '), node);
        }
        doc.documentElement.append(doc.createTextNode('\n'));
        return '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(doc) + '\n';
    }

    async function readEHMetadata(list) {
        const source = new URL(list), gid = Number(source.searchParams.get('gid')), token = source.searchParams.get('t').toLowerCase();
        const response = await request(METADATA_API, false, location.href, { metadata: true, stage: '读取 metadata',
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ method: 'gdata', gidlist: [[gid, token]], namespace: 1 }) });
        if (typeof response.responseText !== 'string' || response.responseText.length > 2 * 1024 * 1024) throw new Error('metadata 响应为空或超过大小限制。');
        let payload;
        try { payload = JSON.parse(response.responseText); } catch { throw new Error('metadata API 未返回有效 JSON，请检查登录或稍后重试。'); }
        const records = payload?.gmetadata;
        if (!Array.isArray(records) || records.length !== 1 || !records[0] || typeof records[0] !== 'object') throw new Error('metadata API 未提供当前画廊的数据。');
        const gallery = records[0];
        if (gallery.error) throw new Error(`metadata API：${String(gallery.error).slice(0, 300)}`);
        if (Number(gallery.gid) !== gid || typeof gallery.token !== 'string' || gallery.token.toLowerCase() !== token) throw new Error('metadata 的 gid/token 与当前画廊不对应，已停止保存。');
        if (![gallery.title, gallery.title_jpn].some(t => typeof t === 'string' && t.trim())
            || [gallery.title, gallery.title_jpn].some(t => t != null && typeof t !== 'string')
            || !Array.isArray(gallery.tags) || gallery.tags.some(t => typeof t !== 'string')) throw new Error('metadata API 缺少有效题名或标签。');
        // API 不返回画廊地址；按当前站点生成，EX 独有画廊在 EH 上无法打开。
        return { ...gallery, web: galleryURLForList(list) };
    }

    // gdata 每次最多查询 25 本画廊。
    const GDATA_CHUNK = 25;

    function gdataList(lists) {
        return lists.map(list => {
            const url = new URL(list);
            return [Number(url.searchParams.get('gid')), url.searchParams.get('t').toLowerCase()];
        });
    }

    // 只采用 gid 与 token 都和请求一致的记录；返回 gid → { titles, torrentcount }。
    function galleryInfoFromAPI(responseText, gidlist) {
        const result = new Map();
        if (typeof responseText !== 'string' || responseText.length > 2 * 1024 * 1024) return result;
        let records;
        try { records = JSON.parse(responseText)?.gmetadata; } catch { return result; }
        if (!Array.isArray(records)) return result;
        for (const record of records) {
            if (!record || typeof record !== 'object' || record.error || typeof record.token !== 'string') continue;
            const gid = Number(record.gid);
            if (!gidlist.some(([id, token]) => id === gid && token === record.token.toLowerCase())) continue;
            const titles = [record.title, record.title_jpn].filter(t => typeof t === 'string' && t.trim())
                .map(t => normalize(decodeHTML(t))).filter(Boolean);
            const count = Number(record.torrentcount);
            result.set(String(gid), { titles, torrentcount: Number.isSafeInteger(count) && count >= 0 ? count : null });
        }
        return result;
    }

    async function readEHGalleries(lists) {
        const result = new Map();
        for (let index = 0; index < lists.length; index += GDATA_CHUNK) {
            const gidlist = gdataList(lists.slice(index, index + GDATA_CHUNK));
            const response = await request(METADATA_API, false, location.href, { metadata: true, stage: '批量读取画廊信息',
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ method: 'gdata', gidlist }) });
            for (const [gid, info] of galleryInfoFromAPI(response.responseText, gidlist)) result.set(gid, info);
        }
        return result;
    }

    async function downloadMetadata(anchor) {
        if (metadataBusy) return;
        const list = galleryListURL(location.href), nhURL = nhGalleryURL(location.href);
        if (!list && !nhURL) return;
        metadataBusy = true;
        anchor.setAttribute('aria-busy', 'true');
        if (anchor.tagName === 'BUTTON') anchor.disabled = true;
        anchor.textContent = 'metadata 获取中…';
        try {
            const gallery = nhURL ? nhMetadataFromPage(document, nhURL) : await readEHMetadata(list);
            const xml = metadataXML(gallery);
            anchor.textContent = 'metadata 保存中…';
            await save(xml, 'ComicInfo.xml', false, 'metadata', 'application/xml;charset=utf-8');
            notify('已下载 ComicInfo.xml，放到漫画压缩包根目录即可。', null, false, 'metadata');
        } catch (error) { notifyError(error, null, 'metadata'); }
        finally {
            metadataBusy = false; anchor.removeAttribute('aria-busy'); anchor.textContent = '下载 metadata';
            if (anchor.tagName === 'BUTTON') anchor.disabled = false;
        }
    }

    function nhGalleryURL(value) {
        const url = asURL(value);
        const match = url?.pathname.match(/^\/g\/([1-9]\d*)\/?$/);
        return match && NH_SITES.has(url.hostname) ? `${url.origin}/g/${match[1]}/` : null;
    }

    function nhMetadataFromPage(doc, value) {
        const web = nhGalleryURL(value);
        if (!web) throw new Error('无法识别当前 nhentai 详情页。');
        const source = new URL(web), gid = source.pathname.split('/')[2];
        const info = doc.querySelector('#info') || doc.querySelector('.gallery_top .info');
        if (!info) throw new Error('未识别到详情资料，请等待页面载入后重试。');
        const identifier = normalize(info.querySelector('#gallery_id, #c_gallery_id')?.textContent).replace(/^#\s*/, '');
        if (identifier !== gid) throw new Error('页面资料与当前画廊 ID 不对应，请等待页面载入或刷新后重试。');
        const title = normalize(info.querySelector('h1')?.textContent);
        const title_jpn = normalize(info.querySelector('h2')?.textContent);
        if (!title && !title_jpn) throw new Error('页面缺少有效题名，已停止保存。');
        const tagsRoot = info.querySelector('#tags') || info.querySelector('ul');
        if (!tagsRoot) throw new Error('页面标签尚未载入或结构发生变化，已停止保存。');
        const tags = [], namespaces = { parody: 'parody', character: 'character', tag: 'tag', artist: 'artist',
            group: 'group', language: 'language', category: 'reclass' };
        for (const anchor of tagsRoot.querySelectorAll('a[href]')) {
            const url = asURL(anchor.getAttribute('href'), web);
            const match = url?.pathname.match(/^\/(parody|character|tag|artist|group|language|category)\/[^/]+\/?$/);
            if (!match || url.origin !== source.origin) continue;
            const name = normalize(anchor.querySelector('.name, .tag_name')?.textContent).normalize('NFKC').toLowerCase();
            if (!name || /[,\u0000-\u001f]/.test(name)) throw new Error('页面标签为空或含有无法保存的字符，已停止保存。');
            tags.push(namespaces[match[1]] + ':' + name);
        }
        if (!tags.length) throw new Error('未读取到有效标签，请等待页面载入或刷新后重试。');
        let filecount = '';
        const xxxPages = tagsRoot.querySelector('.tag_name.pages');
        if (xxxPages) filecount = normalize(xxxPages.textContent);
        else {
            for (const row of tagsRoot.querySelectorAll('.tag-container')) {
                const label = normalize([...row.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' '));
                if (/^Pages\s*:/i.test(label)) { filecount = normalize(row.querySelector('.name')?.textContent); break; }
            }
        }
        if (!/^[1-9]\d*$/.test(filecount)) throw new Error('无法读取当前画廊页数，已停止保存。');
        return { gid, web, title, title_jpn, filecount, tags: [...new Set(tags)] };
    }

    function prepareNHMetadataLink() {
        const web = nhGalleryURL(location.href);
        const info = document.querySelector('#info') || document.querySelector('.gallery_top .info');
        const download = info?.querySelector('#download, #dl_lg');
        const slot = download?.closest('#download-wrapper') || download;
        let button = document.querySelector('button[data-ehtd-nh-metadata]');
        if (!web || !slot) { button?.remove(); return; }
        if (!button) {
            button = element('button', '下载 metadata'); button.type = 'button';
            button.className = download.className;
            button.dataset.ehtdNhMetadata = 'true';
            button.style.cssText = 'margin-inline-start:5px;white-space:nowrap;vertical-align:middle;';
            button.title = '下载 ComicInfo.xml：复用入库流程的题名清理和中文词库；保留本站来源、原题名和标签键。放入压缩包根目录即可。';
            button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); downloadMetadata(button); });
        }
        if (slot.nextElementSibling !== button) slot.after(button);
    }

    function startNHMetadata() {
        prepareNHMetadataLink();
        let scheduled = false;
        new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            queueMicrotask(() => { scheduled = false; prepareNHMetadataLink(); });
        }).observe(document, { childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ['href', 'id'] });
        window.addEventListener('popstate', prepareNHMetadataLink);
        GM_registerMenuCommand('切换：下载弹出另存为', () => {
            const enabled = !GM_getValue(SAVE_AS_KEY, false);
            GM_setValue(SAVE_AS_KEY, enabled);
            notify(enabled ? 'metadata 下载已开启另存为。' : 'metadata 使用浏览器的默认下载目录。');
        });
        GM_registerMenuCommand(`查看脚本版本（${VERSION}）`, () => notify(`当前脚本版本：${VERSION}`));
    }

    function prepareMetadataLink() {
        const list = galleryListURL(location.href);
        if (!list) return;
        const source = new URL(list);
        const torrent = [...document.querySelectorAll('#gd5 a[data-ehtd-list]')].find(a => {
            const candidate = new URL(a.dataset.ehtdList);
            return candidate.searchParams.get('gid') === source.searchParams.get('gid')
                && candidate.searchParams.get('t').toLowerCase() === source.searchParams.get('t').toLowerCase();
        });
        const slot = torrent?.closest('#gd5 .g2');
        if (!slot) return;
        let item = document.querySelector('[data-ehtd-metadata-slot]');
        if (!item) {
            item = document.createElement('p'); item.className = slot.className; item.dataset.ehtdMetadataSlot = 'true';
            // Retain the site's arrow and text styles without copying native event handlers.
            const arrow = slot.querySelector('img');
            if (arrow) {
                const icon = document.createElement('img'); icon.src = arrow.src; icon.alt = '';
                item.append(icon, document.createTextNode(' '));
            } else item.append(document.createTextNode('› '));
            const link = element('a', '下载 metadata', item); link.href = '#'; link.dataset.ehtdMetadata = 'true';
            link.title = '下载 ComicInfo.xml：题名、作者、社团、语言和中文标签与入库流程一致；页数采用当前画廊页数。放入压缩包根目录即可。';
            link.addEventListener('click', event => { event.preventDefault(); downloadMetadata(link); });
        }
        if (slot.nextElementSibling !== item) slot.after(item);
    }

    function normalize(value) {
        return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function asURL(value, base) {
        try {
            const url = new URL(value, base);
            return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
        } catch {
            return null;
        }
    }

    function listURL(value, base) {
        const url = asURL(value, base);
        if (!url || !SITES.has(url.hostname) || url.pathname !== '/gallerytorrents.php') return null;
        const gid = url.searchParams.get('gid');
        const token = url.searchParams.get('t');
        if (!/^[1-9]\d*$/.test(gid ?? '') || !/^[a-f\d]{10}$/i.test(token ?? '')) return null;
        return `${url.origin}/gallerytorrents.php?gid=${gid}&t=${token}`;
    }

    function linkListURL(anchor, base) {
        const direct = listURL(anchor.getAttribute('href'), base);
        if (direct) return direct;
        // 只读取 popUp 参数中的 URL，不执行页面的 onclick 代码。
        const source = (anchor.getAttribute('onclick') ?? '').replace(/&amp;/g, '&');
        const match = source.match(/['"]((?:https?:\/\/[^'"\s]+)?\/?gallerytorrents\.php\?[^'"]+)['"]/i);
        return match ? listURL(match[1], base) : null;
    }

    function galleryListURL(value) {
        const url = asURL(value);
        const match = url?.pathname.match(/^\/g\/([1-9]\d*)\/([a-f\d]{10})\/?$/i);
        return match && SITES.has(url.hostname)
            ? `${url.origin}/gallerytorrents.php?gid=${match[1]}&t=${match[2]}` : null;
    }

    function galleryURLForList(value) {
        const url = new URL(value);
        return `${url.origin}/g/${url.searchParams.get('gid')}/${url.searchParams.get('t')}/`;
    }

    function archiveURL(value, base, list) {
        const url = asURL(value, base);
        if (!url || !SITES.has(url.hostname) || url.pathname !== '/archiver.php') return null;
        const gid = url.searchParams.get('gid');
        const token = url.searchParams.get('token');
        if (!/^[1-9]\d*$/.test(gid ?? '') || !/^[a-f\d]{10}$/i.test(token ?? '')) return null;
        if (list) {
            const expected = new URL(list);
            if (url.origin !== expected.origin || gid !== expected.searchParams.get('gid')
                || token.toLowerCase() !== expected.searchParams.get('t').toLowerCase()) return null;
        }
        return url.href;
    }

    function linkArchiveURL(link, base, list) {
        const direct = archiveURL(link.getAttribute('href'), base, list);
        if (direct) return direct;
        const source = (link.getAttribute('onclick') ?? '').replace(/&amp;/g, '&');
        const match = source.match(/['"]((?:https?:\/\/[^'"\s]+)?\/?archiver\.php\?[^'"]+)['"]/i);
        return match ? archiveURL(match[1], base, list) : null;
    }

    function archiveFromPage(doc, list, base) {
        for (const link of doc.querySelectorAll('a[href*="archiver.php"], a[onclick*="archiver.php"]')) {
            const url = linkArchiveURL(link, base, list);
            if (url) return url;
        }
        return null;
    }

    function archiveFileURL(value, base) {
        const url = asURL(value, base);
        if (!url || !(SITES.has(url.hostname) || url.hostname === 'hath.network' || url.hostname.endsWith('.hath.network'))) return null;
        if (!/\.zip$/i.test(url.pathname) && !/^\/archive\/[^/]+\/.+/i.test(url.pathname)) return null;
        // 这里只生成候选请求地址；即使带 start=1，也可能返回准备中的 HTML。
        if (!/\.zip$/i.test(url.pathname) || url.searchParams.has('autostart')) {
            url.searchParams.delete('autostart');
            url.searchParams.set('start', '1');
        }
        url.hash = '';
        return url.href;
    }

    function archivePageURL(value, base, list) {
        const page = archiveURL(value, base, list);
        if (page) return page;
        const url = asURL(value, base);
        if (!url || !archiveFileURL(url.href)) return null;
        if (SITES.has(url.hostname) && list) {
            const expected = new URL(list);
            const gid = url.pathname.match(/^\/archive\/([1-9]\d*)\//)?.[1];
            if (url.origin !== expected.origin || (gid && gid !== expected.searchParams.get('gid'))) return null;
        }
        url.hash = '';
        return url.href;
    }

    function archiveResponseIsFile(headers = '') {
        return /^content-type:\s*application\/(?:zip|x-zip-compressed|octet-stream)(?:[ \t]*;|[ \t]*\r?$)/im.test(headers);
    }

    function sourcePrefix(list, gid) {
        const valid = listURL(list);
        if (!valid) throw new Error('无法识别下载来源的 gid 和 gallery token。');
        const source = new URL(valid);
        if (source.searchParams.get('gid') !== String(gid)) throw new Error('下载来源与画廊 ID 不一致。');
        const site = source.hostname === 'exhentai.org' ? 'EX' : 'EH';
        return `[${site}_${gid}_${source.searchParams.get('t').toLowerCase()}]`;
    }

    // 多数文件系统限制单个文件名 255 字节；中日文每字 3 字节，按字符数截断会超限。
    // 再为浏览器的 .crdownload / .crswap 临时后缀和重名编号预留空间。
    const FILENAME_BYTES = 230;

    function clipBytes(value, limit) {
        const encoder = new TextEncoder();
        let bytes = 0, result = '';
        for (const char of value) {
            bytes += encoder.encode(char).length;
            if (bytes > limit) break;
            result += char;
        }
        return result;
    }

    function archiveFilename(title, gid, source = null) {
        const prefix = `${source ? sourcePrefix(source, gid) : gid + ' -'} `;
        const budget = FILENAME_BYTES - new TextEncoder().encode(`${prefix}.zip`).length;
        const name = clipBytes(normalize(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '').slice(0, 160), budget).replace(/[. ]+$/g, '');
        return `${prefix}${name || 'Original'}.zip`;
    }

    function parseArchive(source, base, list) {
        if (typeof source !== 'string' || source.length > 1024 * 1024) throw new Error('未识别到归档页面，请打开原归档下载入口。');
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const previewDoc = doc.cloneNode(true);
        previewDoc.querySelectorAll('script, style').forEach(node => node.remove());
        const pageText = normalize(previewDoc.body.textContent);
        if (/insufficient (?:funds|credits|GP)|do not have enough|not enough (?:GP|credits)|余额不足|点数不足|额度不足/i.test(pageText)) {
            throw new Error('网站提示归档下载余额或额度不足，请打开原归档入口查看。');
        }
        // 首次申请只提交原档表单。隐藏字段沿用网站值，不提交重采样或 H@H 客户端选项。
        for (const form of doc.querySelectorAll('form')) {
            const original = form.querySelector('input[name="dltype"][value="org"]');
            if (original?.disabled) continue;
            const buttons = [...form.querySelectorAll('input[type="submit"], button')];
            const submit = buttons.find(button => !button.disabled && button.name === 'dlcheck'
                && /original|原档|原檔|原始/i.test(button.value || button.textContent));
            if (!submit) continue;
            const action = archiveURL(form.getAttribute('action') || base, base, list);
            if (!action) continue;
            const data = new URLSearchParams();
            for (const input of form.querySelectorAll('input[type="hidden"][name]')) {
                if (!input.disabled && !['dltype', 'dlcheck'].includes(input.name)) data.append(input.name, input.value);
            }
            data.set('dltype', 'org');
            data.set('dlcheck', submit.value || normalize(submit.textContent));
            // 保留网站实际显示的费用、余额及额度；不自行推算或把无法识别的费用当作免费。
            return { form: { url: action, data: data.toString() }, preview: `${pageText.slice(0, 2400)} ${submit.value || normalize(submit.textContent)}` };
        }
        // 只读取跳转地址和数字延时，绝不执行归档页面内的 JavaScript。
        const scripts = [...doc.querySelectorAll('script')];
        const redirects = scripts.flatMap(script =>
            [...script.textContent.matchAll(/(?:(?:document|window)\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/gi),
                ...script.textContent.matchAll(/(?:(?:document|window)\.)?location\.(?:replace|assign)\(\s*['"]([^'"]+)['"]\s*\)/gi)].map(match => match[1]));
        // 站点使用 gotonext 继续归档；其他定时器（例如关窗）不属于下载等待。
        // 兼容 "gotonext()"、"gotonext();"、gotonext、function(){ gotonext(); }、() => gotonext() 等写法。
        const delays = scripts.flatMap(script => [...script.textContent.matchAll(/setTimeout\s*\(\s*(?:(["'])\s*gotonext\(\)\s*;?\s*\1|gotonext|function\s*\(\s*\)\s*\{\s*gotonext\(\)\s*;?\s*\}|\(\s*\)\s*=>\s*(?:\{\s*gotonext\(\)\s*;?\s*\}|gotonext\(\)))\s*,\s*(\d+)\s*\)/gi)]
            .map(match => Number(match[2])));
        for (const meta of doc.querySelectorAll('meta[http-equiv]')) {
            if (meta.getAttribute('http-equiv').toLowerCase() !== 'refresh') continue;
            const content = meta.getAttribute('content') || '';
            const delay = content.match(/^\s*(\d+(?:\.\d+)?)/);
            if (delay) delays.push(Number(delay[1]) * 1000);
            const match = content.match(/url\s*=\s*['"]?([^'"]+)/i);
            if (match) redirects.push(match[1].trim());
        }
        const waiting = /preparing|creating|locating|processing|being processed|please wait|正在(?:准备|生成|建立|寻找)|准备中|生成中/i.test(pageText);
        // 网站明确给出的延时始终保留；按等待文案推断的 3 秒只用于没有文件地址的情况。
        const explicitWait = delays.length ? Math.max(...delays) : 0;
        const waitMs = delays.length ? explicitWait : waiting ? 3000 : 0;
        const continuation = [...doc.querySelectorAll('#continue a[href]')].map(link => link.getAttribute('href'));
        if (waiting) {
            for (const value of [...continuation, ...redirects]) {
                const next = archivePageURL(value.replace(/&amp;/g, '&'), base, list);
                if (!next) continue;
                // 下载服务器的 autostart 中转页只给出 ?start=1 链接；直接请求 start=1，仍须收到 ZIP 文件头才保存。
                const host = new URL(next).hostname;
                if ((host === 'hath.network' || host.endsWith('.hath.network')) && new URL(next).searchParams.has('autostart')) {
                    return { next: archiveFileURL(next), waitMs };
                }
                return { next, waitMs };
            }
        }
        const files = [];
        for (const link of doc.querySelectorAll('a[href]')) {
            const label = normalize(link.textContent + ' ' + (link.closest('p')?.textContent || ''));
            if (/resampl|1280x|重采样|縮小|缩小/i.test(label)) continue;
            const page = archivePageURL(link.getAttribute('href'), base, list);
            const file = page && archiveFileURL(page);
            if (file) files.push({ file, original: /original|原档|原檔|原始/i.test(label) });
        }
        const explicit = files.filter(item => item.original);
        const candidates = [...new Set((explicit.length ? explicit : files).map(item => item.file))];
        if (candidates.length === 1) return { next: candidates[0], waitMs: explicitWait };
        if (candidates.length > 1) throw new Error('归档页面存在多个无法区分的下载地址，请打开原入口选择 Original 原档。');
        for (const link of doc.querySelectorAll('#continue a[href], #db a[href]')) {
            const next = archivePageURL(link.getAttribute('href'), base, list);
            if (next) return { next, waitMs };
        }
        for (const value of redirects) {
            const decoded = value.replace(/&amp;/g, '&');
            const next = archivePageURL(decoded, base, list);
            if (next) return { next, waitMs };
        }
        if (waiting) {
            const next = archivePageURL(base, base, list);
            if (next) return { next, waitMs };
        }
        throw new Error('未识别到 Original 原档表单或 ZIP 地址，可能需要登录、验证，或网站页面已变化。请打开原归档入口。');
    }

    function titleFromPage(doc, url, pageURL) {
        if (galleryListURL(pageURL) === url) return normalize(doc.querySelector('#gn')?.textContent || doc.querySelector('#gj')?.textContent);
        let fallback = '';
        for (const link of doc.querySelectorAll('a[href*="/g/"]')) {
            if (galleryListURL(asURL(link.getAttribute('href'), pageURL)?.href) !== url) continue;
            const label = link.querySelector('.glink, .glname');
            const title = normalize((label ?? link).textContent);
            if (label && title) return title;
            fallback ||= title;
        }
        return fallback;
    }

    function titlesFromPage(doc, url, pageURL) {
        if (galleryListURL(pageURL) === url) {
            return [...doc.querySelectorAll('#gn, #gj')].map(node => normalize(node.textContent)).filter(Boolean);
        }
        const title = titleFromPage(doc, url, pageURL);
        return title ? [title] : [];
    }

    function archiveTitleFromPage(doc) {
        return normalize(doc.querySelector('#gj')?.textContent) || normalize(doc.querySelector('#gn')?.textContent);
    }

    function mainTitle(value) {
        let title = normalize(value).normalize('NFKC').replace(/\.torrent$/i, '');
        const volume = /^(?:\d+(?:[.-]\d+)*|[ivxlcdm]+|(?:vol(?:ume)?|ch(?:apter)?|part|book)\.?\s*(?:\d+(?:[.-]\d+)*|[ivxlcdm]+)|第?\s*\d+\s*(?:巻|卷|册|冊|部|話|话|章)|(?:上|中|下)(?:巻|卷|册|冊|編|篇))$/i;
        const annotation = /^(?:chinese|english|japanese|korean|spanish|french|german|russian|digital|decensored|uncensored|censored|dl\s*(?:版|ver)|中国翻訳|中文|無修正|无修正|修正版|v\d+(?:\.\d+)*)$/i;
        for (;;) {
            const prefix = title.match(/^(?:\[([^\]]*)\]|\(([^)]*)\)|【([^】]*)】)\s*/);
            if (!prefix || volume.test(normalize(prefix[1] ?? prefix[2] ?? prefix[3]))) break;
            title = title.slice(prefix[0].length);
        }
        title = title.replace(/\[([^\]]*)\]|【([^】]*)】/g, (_, square, corner) => {
            const label = normalize(square ?? corner);
            return volume.test(label) || (!annotation.test(label) && !/汉化|漢化|翻訳|翻译|翻譯|scanlation|translation/i.test(label)) ? ` ${label} ` : ' ';
        }).split('|')[0];
        return normalize(title);
    }

    function romajiTitle(value) {
        const title = mainTitle(value);
        if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(title)
            || !/\p{Script=Latin}{2}/u.test(title) || /^[a-f\d]{40}$/i.test(title)
            || /^(?:(?:personalized|redistributable|download)(?:\s+torrent)?|torrent download)$/i.test(title)) return '';
        return title;
    }

    function normalizedTitleKey(title) {
        return normalize(title.normalize('NFKC').toLowerCase().replace(/[’']/g, '')
            .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2')
            .replace(/[^\p{L}\p{M}\d]+/gu, ' '));
    }

    function romajiKey(value) {
        if (normalize(value).length >= TITLE_LIMIT) return '';
        return normalizedTitleKey(romajiTitle(value).normalize('NFKD').replace(/\p{M}/gu, ''));
    }

    function titleKeys(titles) {
        const keys = new Set();
        for (const value of titles) {
            if (typeof value !== 'string' || normalize(value).length >= TITLE_LIMIT) continue;
            const title = mainTitle(value);
            const key = romajiKey(value) || (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(title)
                ? normalizedTitleKey(title) : '');
            if (key) keys.add(key);
        }
        return [...keys].slice(0, 4);
    }

    function historyGalleryID(id) {
        return String(id).match(/^([1-9]\d*):/)?.[1] ?? '';
    }

    function historyTorrentHash(id) {
        return String(id).match(/(?:^|[:/])([a-f\d]{40})(?:$|[.?/])/i)?.[1].toLowerCase() ?? '';
    }

    function historyLimit() {
        let value = HISTORY_LIMIT;
        try { if (typeof GM_getValue === 'function') value = GM_getValue(HISTORY_LIMIT_KEY, HISTORY_LIMIT); }
        catch { /* 暂时无法读取设置时使用默认值。 */ }
        return Number.isSafeInteger(value) && value >= 0 ? value : HISTORY_LIMIT;
    }

    // 仅识别旧版本从完整题名生成的别名，移除删掉卷号后产生的宽泛键。
    // 站点提供的其他语言别名保留，不根据题名猜译名。
    function legacyTitleKey(value) {
        let title = normalize(value).normalize('NFKC').replace(/\.torrent$/i, '');
        const volume = /^(?:\d+(?:[.-]\d+)*|(?:vol(?:ume)?|ch(?:apter)?|part|book)\.?\s*\d+)$/i;
        for (;;) {
            const prefix = title.match(/^(?:\[([^\]]*)\]|\(([^)]*)\)|【([^】]*)】)\s*/);
            if (!prefix || volume.test(normalize(prefix[1] ?? prefix[2] ?? prefix[3]))) break;
            title = title.slice(prefix[0].length);
        }
        title = title.replace(/\[([^\]]*)\]|【([^】]*)】/g, (_, square, corner) => {
            const label = normalize(square ?? corner);
            return volume.test(label) ? ` ${label} ` : ' ';
        }).split('|')[0];
        return titleKeys([title])[0] || '';
    }

    function normalizeHistory(value) {
        const limit = historyLimit();
        if (!Array.isArray(value) || limit === 0) return [];
        const result = [];
        for (const item of value) {
            const entry = typeof item === 'string' ? { id: item, title: '', at: null } : item;
            if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 300) continue;
            const title = normalize(typeof entry.title === 'string' ? entry.title : '').slice(0, TITLE_LIMIT);
            const currentKeys = titleKeys([title]);
            const legacyKey = legacyTitleKey(title);
            const keys = [...new Set([...currentKeys, ...(Array.isArray(entry.keys) ? entry.keys : [])
                .filter(key => typeof key === 'string' && key.length > 0 && key.length < TITLE_LIMIT
                    && (key !== legacyKey || currentKeys.includes(key)))])].slice(0, 4);
            result.push({
                id: entry.id,
                gid: /^[1-9]\d*$/.test(entry.gid ?? '') ? String(entry.gid) : historyGalleryID(entry.id),
                title, keys,
                at: Number.isFinite(entry.at) && entry.at > 0 ? entry.at : null,
                ...(entry.status === 'started' ? { status: 'started' } : {}),
                ...(typeof entry.job === 'string' && /^[a-z\d-]{1,100}$/i.test(entry.job) ? { job: entry.job } : {}),
                ...(galleryListURL(entry.sourceURL) && historyGalleryID(entry.id) === new URL(galleryListURL(entry.sourceURL)).searchParams.get('gid')
                    ? { sourceURL: galleryURLForList(galleryListURL(entry.sourceURL)) } : {}),
            });
            if (result.length === limit) break;
        }
        return result;
    }

    function duplicateDownloads(history, id, title, aliases = []) {
        const keys = new Set([...titleKeys([title]), ...aliases]);
        const gid = historyGalleryID(id);
        const hash = historyTorrentHash(id);
        return normalizeHistory(history).filter(item => item.id === id || (gid && item.gid === gid)
            || (hash && historyTorrentHash(item.id) === hash) || item.keys.some(key => keys.has(key)));
    }

    function pushDownload(history, entry) {
        return normalizeHistory([entry, ...normalizeHistory(history)]);
    }

    function fileURL(value, base) {
        const url = asURL(value, base);
        if (!url || !FILE_HOSTS.has(url.hostname)) return null;
        if (!/\.torrent$/i.test(url.pathname) && !/^\/get\/\d+\/[a-f\d]{40}\/?$/i.test(url.pathname)) return null;
        return url.href;
    }

    function torrentID(url) {
        const parsed = new URL(url);
        return parsed.pathname.match(/[a-f\d]{40}/i)?.[0].toLowerCase() ?? `${parsed.origin}${parsed.pathname}`;
    }

    function integer(value) {
        const text = normalize(value);
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
        const result = Number(text.replace(/,/g, ''));
        return Number.isSafeInteger(result) ? result : null;
    }

    function postedTime(value, currentYear = new Date().getUTCFullYear()) {
        const text = normalize(value);
        const full = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(?:UTC|Z))?$/i);
        const short = full ? null : text.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!full && !short) return null;
        const parts = (full ? full.slice(1) : [currentYear, ...short.slice(1)]).map((part, index) => Number(part ?? (index === 5 ? 0 : NaN)));
        const time = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
        const date = new Date(time);
        const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
        return actual.every((part, index) => part === parts[index]) ? time : null;
    }

    function field(block, aliases) {
        const labels = aliases.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const pattern = new RegExp(`^(?:${labels})\\s*[:：]?\\s*(.*)$`, 'i');
        // 每个格子独立读取，避免把标题、评论或其他种子的数字当成统计值。
        const cells = [...block.querySelectorAll('td, th')];
        for (const cell of cells) {
            const match = normalize(cell.textContent).match(pattern);
            if (!match) continue;
            if (match[1]) return match[1];
            const next = cell.nextElementSibling;
            if (next?.matches('td, th')) return normalize(next.textContent);
        }
        return null;
    }

    function torrentLinks(block, base) {
        return [...block.querySelectorAll('a[href]')]
            .map(anchor => ({ anchor, url: fileURL(anchor.getAttribute('href'), base) }))
            .filter(item => item.url);
    }

    function parseTorrents(html, base) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const root = doc.querySelector('#torrentinfo') ?? doc.body;
        const labels = [...root.querySelectorAll('p, h2, h3, b, strong')];
        const noCurrent = labels.some(node => /^(?:There are no (?:current|up-to-date) torrents for this gallery[.!]?|(?:当前|當前)(?:图库|圖庫|画廊|畫廊)(?:没有|沒有)(?:最新|当前|當前)的(?:种子|種子)[。！!]?)$/i.test(normalize(node.textContent)));
        const sections = labels.map(node => ({ node, text: normalize(node.textContent) }))
            .filter(section => /^(?:Outdated|Obsolete|Current|Up-to-date)\s+Torrents?\s*[:：]?$|^(?:过时|過時|旧版|舊版|当前|當前|最新)(?:种子|種子)\s*[:：]?$/i.test(section.text));
        const isOutdated = node => {
            let outdated = noCurrent;
            for (const section of sections) {
                // 浏览器 DOM 顺序：分组标题后面的条目属于这一组。
                if (section.node.compareDocumentPosition(node) & 4) {
                    outdated = /^(?:Outdated|Obsolete|过时|過時|旧版|舊版)/i.test(section.text);
                }
            }
            return outdated;
        };
        const links = torrentLinks(root, base);
        const records = new Map();
        const issues = [];
        for (const { anchor, url } of links) {
            const id = torrentID(url);
            if (records.has(id)) continue; // 个性化和公开链接可能指向同一个种子。
            let block = anchor.closest('table') ?? anchor.parentElement;
            // 兼容多个种子共用一张表的布局；不跨种子读取字段。
            if (new Set(torrentLinks(block, base).map(item => torrentID(item.url))).size > 1) {
                block = anchor.closest('tr') ?? anchor.parentElement;
            }
            const posted = field(block, LABELS.posted);
            records.set(id, {
                id, url,
                name: normalize(anchor.textContent) || `${id}.torrent`,
                downloads: integer(field(block, LABELS.downloads)),
                posted,
                timestamp: postedTime(posted),
                size: field(block, LABELS.size) ?? '—',
                outdated: isOutdated(anchor),
            });
        }
        // 某个种子块无法识别链接时，不能仅在已识别的部分中自动择优。
        for (const table of root.querySelectorAll('form table')) {
            if ((field(table, LABELS.posted) !== null || field(table, LABELS.downloads) !== null)
                && !torrentLinks(table, base).length) {
                issues.push('有种子信息块未能识别下载链接');
            }
        }
        return { records: [...records.values()], issues, hasTorrentInfo: !!doc.querySelector('#torrentinfo') };
    }

    // 网站的限流 / 临时封禁提示页很短；只检查短响应，避免正文或评论里的字样误判。
    const RATE_LIMIT_PATTERN = /temporarily banned|excessive pageloads|opening pages too fast|heavy load on the server/i;

    function rateLimitError(text) {
        if (typeof text !== 'string' || text.length > 4096 || !RATE_LIMIT_PATTERN.test(text)) return null;
        const error = new Error('网站提示请求过快或 IP 已被临时封禁，请稍后再试，并调大批量下载间隔。');
        error.code = 'RATE_LIMIT';
        return error;
    }

    function chooseTorrent(records, issues = []) {
        if (issues.length) return { manual: true, reason: issues.join('；') };
        if (!records.length) return { manual: true, reason: '没有识别到可下载的种子，请查看原种子列表。' };
        // 网站按图库版本标记过时种子；不同上传者的发布时间不代表图库更新。
        const current = records.filter(item => !item.outdated);
        if (!current.length) {
            return { manual: true, reason: '当前图库没有最新的种子：现有种子均为过时版本，可能缺少后续更新内容，请人工选择或使用原档下载。' };
        }
        if (current.length === 1) return { manual: false, best: current[0] };
        if (current.some(item => item.downloads === null)) {
            return { manual: true, reason: '当前版本种子的下载量不完整，需要人工判断。' };
        }
        const ranked = [...current].sort((a, b) => b.downloads - a.downloads
            || (b.timestamp ?? -1) - (a.timestamp ?? -1) || a.id.localeCompare(b.id));
        return { manual: false, best: ranked[0] };
    }

    function filename(record, gid, source = null) {
        const name = normalize(record.name).replace(/\.torrent$/i, '')
            .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '') || 'torrent';
        const prefix = source ? sourcePrefix(source, gid) + ' ' : gid + '-';
        const suffix = `-${record.id.slice(0, 8).replace(/[^a-z\d]/gi, '_')}.torrent`;
        const budget = FILENAME_BYTES - new TextEncoder().encode(prefix + suffix).length;
        return `${prefix}${clipBytes(Array.from(name).slice(0, 120).join(''), budget)}${suffix}`;
    }

    function validateTorrent(buffer) {
        const bytes = new Uint8Array(buffer);
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('种子文件为空或超过 20 MiB。');
        let offset = 0;
        let hasInfo = false;
        const invalid = () => { throw new Error('服务器返回的内容不是有效的 .torrent 文件，请检查登录或原下载链接。'); };
        const byteString = () => {
            const start = offset;
            while (bytes[offset] >= 48 && bytes[offset] <= 57) offset++;
            if (offset === start || bytes[offset++] !== 58 || (offset - start > 2 && bytes[start] === 48)) invalid();
            let length = 0;
            for (let index = start; index < offset - 1; index++) length = length * 10 + bytes[index] - 48;
            if (!Number.isSafeInteger(length) || offset + length > bytes.length) invalid();
            const text = bytes.subarray(offset, offset + length);
            offset += length;
            return text;
        };
        const skip = (depth = 0) => {
            if (depth > 100 || offset >= bytes.length) invalid();
            const marker = bytes[offset];
            if (marker >= 48 && marker <= 57) { byteString(); return; }
            if (marker === 105) {
                const start = ++offset;
                while (offset < bytes.length && bytes[offset] !== 101) offset++;
                const text = new TextDecoder().decode(bytes.subarray(start, offset));
                if (!/^(?:0|-?[1-9]\d*)$/.test(text) || offset >= bytes.length) invalid();
                offset++;
                return;
            }
            if (marker !== 100 && marker !== 108) invalid();
            offset++;
            while (offset < bytes.length && bytes[offset] !== 101) {
                if (marker === 100) {
                    const key = byteString();
                    if (depth === 0 && new TextDecoder().decode(key) === 'info' && bytes[offset] === 100) hasInfo = true;
                }
                skip(depth + 1);
            }
            if (bytes[offset++] !== 101) invalid();
        };
        if (bytes[0] !== 100) invalid();
        skip();
        if (offset !== bytes.length || !hasInfo) invalid();
        return bytes;
    }

    // 同一份选择/校验逻辑可在 Node 中离线测试；浏览器运行时不导出全局变量。
    // 油猴环境一定有 GM_info；页面意外定义全局 module 时不会误判为 Node。
    if (typeof GM_info === 'undefined' && typeof module === 'object' && module.exports) {
        metadataDictionaryCache = require('./metadata-dictionary.json');
        module.exports = { listURL, linkListURL, galleryListURL, fileURL, integer, postedTime, parseTorrents, chooseTorrent, filename, validateTorrent,
            titleFromPage, titlesFromPage, romajiTitle, romajiKey, titleKeys, normalizeHistory, duplicateDownloads, pushDownload,
            archiveURL, linkArchiveURL, archiveFromPage, archiveFileURL, sourcePrefix, archiveFilename, parseArchive };
        Object.assign(module.exports, { galleryInfoFromAPI, gdataList, rateLimitError, clipBytes, metadataDictionary, metadataTitle, metadataNumber, metadataLabels, metadataFields, metadataXML,
            nhGalleryURL, nhMetadataFromPage });
        return;
    }

    let ui;
    const pending = new Map();
    let batchRun = null;
    let batchPanel = null;
    const archiveAttempts = new Set();
    const pageOwner = crypto.randomUUID();
    let pageInitialization = null;
    let pageActive = true;
    let coordinationQueue = Promise.resolve();
    let historyMirror = null;
    const pageTasks = new Map();
    const localTab = {};
    let coordinationRetryAt = 0;
    const idleDismissals = new WeakMap();

    function redactErrorText(value) {
        return String(value).replace(/https?:\/\/[^\s"'<>]+/gi, value => {
            try {
                const url = new URL(value);
                if (url.username || url.password) { url.username = '[redacted]'; url.password = ''; }
                if (url.hostname === 'hath.network' || url.hostname.endsWith('.hath.network')) {
                    url.pathname = '/[download-path-redacted]';
                } else {
                    url.pathname = url.pathname.replace(/(\/g\/[1-9]\d*\/)[a-f\d]{10}/gi, '$1[gallery-token-redacted]');
                }
                for (const key of [...url.searchParams.keys()]) {
                    if (!['gid', 'start'].includes(key.toLowerCase()) || !/^\d+$/.test(url.searchParams.get(key))) {
                        url.searchParams.set(key, '[redacted]');
                    }
                }
                url.hash = '';
                return url.href;
            } catch { return '[URL redacted]'; }
        }).replace(/(["'](?:set-cookie|cookies?|authorization|password|secret|(?:access[_-]?)?token|ticket)["']\s*:\s*)(["'])(?:\\.|[^\\])*?\2/gi,
            '$1"[redacted]"')
            .replace(/\b(set-cookie|cookies?|authorization|password|secret|(?:access[_-]?)?token|ticket)\s*[:=]\s*[^\r\n]+/gi, '$1=[redacted]');
    }

    function safeErrorValue(value, depth = 0, seen = new WeakSet(), budget = { remaining: 16000 }) {
        if (budget.remaining <= 0) return '[size limit]';
        budget.remaining -= 16;
        if (value === undefined) return '[undefined]';
        if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (typeof value === 'string') {
            const text = redactErrorText(value).slice(0, Math.max(0, Math.min(8000, budget.remaining)));
            budget.remaining -= text.length;
            return text;
        }
        if (typeof value === 'function') return '[function]';
        if (typeof value !== 'object') return redactErrorText(String(value));
        if (seen.has(value)) return '[circular]';
        if (depth >= 6) return '[depth limit]';
        seen.add(value);
        if (value instanceof Blob) return { type: value.type, size: value.size, kind: 'Blob' };
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { kind: 'binary', byteLength: value.byteLength };
        try {
            if (Array.isArray(value)) {
                const items = [];
                for (const item of value.slice(0, 40)) {
                    if (budget.remaining <= 0) { items.push('[size limit]'); break; }
                    items.push(safeErrorValue(item, depth + 1, seen, budget));
                }
                return items;
            }
            const result = Object.create(null);
            const keys = [...new Set([...Object.getOwnPropertyNames(value),
                ...['name', 'message', 'stack', 'error', 'code', 'details'].filter(key => key in value)])];
            for (const key of keys.slice(0, 50)) {
                if (budget.remaining <= 0) { result.omitted = '[size limit]'; break; }
                budget.remaining -= key.length;
                if (/cookie|authorization|password|credential|secret|token|ticket/i.test(key)) { result[key] = '[redacted]'; continue; }
                try { result[key] = safeErrorValue(value[key], depth + 1, seen, budget); }
                catch { result[key] = '[unreadable property]'; }
            }
            if (keys.length > 50) result.omittedProperties = keys.length - 50;
            return result;
        } catch { return '[uninspectable object]'; }
    }

    function saveErrorDetails(stage, value, name) {
        const info = typeof GM_info === 'undefined' ? {} : GM_info;
        try {
            return JSON.stringify({ version: VERSION, stage, filename: name,
                tampermonkeyVersion: info.version, downloadMode: info.downloadMode,
                error: safeErrorValue(value) }, null, 2).slice(0, 24000);
        } catch { return '无法读取错误详情。'; }
    }

    function coordinationError(message) {
        const error = new Error(message);
        error.code = 'COORDINATION';
        return error;
    }

    function inactivePageError() {
        const error = new Error('页面已离开。');
        error.cancelled = true;
        return error;
    }

    function tabCall(fn, ...args) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(coordinationError('跨标签页检查暂时不可用。')), 3000);
            try { fn(...args, value => { clearTimeout(timer); resolve(value); }); }
            catch { clearTimeout(timer); reject(coordinationError('跨标签页检查暂时不可用。')); }
        });
    }

    function tabState(tab) {
        return tab[TAB_STATE_KEY] ||= { tasks: [] };
    }

    async function writeTab(tab) {
        if (tab !== localTab) await tabCall(GM_saveTab, tab);
    }

    function initializePageState() {
        if (pageInitialization) return pageInitialization;
        const work = (async () => {
            if ([typeof GM_getTab, typeof GM_saveTab, typeof GM_getTabs].some(type => type !== 'function')) {
                throw coordinationError('跨标签页检查暂时不可用。');
            }
            const tab = await tabCall(GM_getTab);
            if (!pageActive) throw inactivePageError();
            const state = tabState(tab);
            // 新文档回收旧占位；缓存恢复时保留本页仍在运行的任务。
            state.tasks = [...pageTasks.values()].map(task => ({ ...task, expires: Date.now() + CLAIM_TTL }));
            delete state.mutex;
            state.documentOwner = pageOwner;
            for (const gid of state.archiveAttempts || []) if (/^[1-9]\d*$/.test(gid)) archiveAttempts.add(gid);
            state.archiveAttempts = [...archiveAttempts];
            await writeTab(tab);
        })();
        pageInitialization = work;
        work.catch(() => { if (pageInitialization === work) pageInitialization = null; });
        return work;
    }

    function liveTasks(tabs) {
        return Object.values(tabs).flatMap(tab => tab[TAB_STATE_KEY]?.tasks || [])
            .filter(task => task && task.expires > Date.now());
    }

    // 跨页检查是辅助功能；扩展暂时没有响应时继续使用本页任务和历史。
    // 真正有另一标签页在下载的冲突仍保留，不把它当作接口故障。
    function coordinate(operation) {
        const locally = () => {
            const state = tabState(localTab);
            state.documentOwner = pageOwner;
            state.tasks = [...pageTasks.values()];
            state.archiveAttempts = [...archiveAttempts];
            return operation(localTab, { [pageOwner]: localTab });
        };
        const work = coordinationQueue.then(async () => {
            if (!pageActive) throw inactivePageError();
            if (Date.now() < coordinationRetryAt) return locally();
            try {
                await initializePageState();
                if (!pageActive) throw inactivePageError();
                const tab = await tabCall(GM_getTab);
                const state = tabState(tab);
                if (state.documentOwner !== pageOwner) throw new Error('旧页面任务已失效，请在当前页面重新操作。');
                const deadline = Date.now() + MUTEX_TTL;
                state.mutex = { owner: pageOwner, choosing: true, ticket: 0, expires: deadline };
                let completed = false;
                try {
                    await writeTab(tab);
                    let tabs = await tabCall(GM_getTabs);
                    state.mutex.ticket = 1 + Math.max(0, ...Object.values(tabs).map(value => value[TAB_STATE_KEY]?.mutex)
                        .filter(lock => lock?.expires > Date.now()).map(lock => lock.ticket || 0));
                    state.mutex.choosing = false;
                    await writeTab(tab);
                    for (;;) {
                        tabs = await tabCall(GM_getTabs);
                        const blocked = Object.values(tabs).some(value => {
                            const lock = value[TAB_STATE_KEY]?.mutex;
                            return lock && lock.owner !== pageOwner && lock.expires > Date.now()
                                && (lock.choosing || lock.ticket < state.mutex.ticket
                                    || (lock.ticket === state.mutex.ticket && lock.owner < pageOwner));
                        });
                        if (!blocked) break;
                        if (Date.now() >= deadline - 500) throw coordinationError('跨标签页检查繁忙。');
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    if (Date.now() >= deadline - 500) throw coordinationError('跨标签页检查已过期。');
                    const result = await operation(tab, tabs);
                    completed = true;
                    return result;
                } finally {
                    delete state.mutex;
                    // 一次保存同时发布操作结果并释放锁，成功回调后其他页面才可接手。
                    // 操作已失败时，清理失败不能覆盖原本的报错。
                    if (completed) await writeTab(tab);
                    else await writeTab(tab).catch(() => {});
                }
            } catch (error) {
                if (error.code !== 'COORDINATION') throw error;
                pageInitialization = null;
                coordinationRetryAt = Date.now() + 30000;
                return locally();
            }
        });
        coordinationQueue = work.catch(() => {});
        return work;
    }

    function sharedHistory(tabs) {
        let revision = 0;
        let entries = historyMirror || [];
        try {
            revision = Number(GM_getValue(HISTORY_REV_KEY, 0)) || 0;
            entries = historyMirror ?? GM_getValue(HISTORY_KEY, []);
        } catch { /* 存储暂时不可用时使用当前页面的历史。 */ }
        for (const tab of Object.values(tabs)) {
            const snapshot = tab[TAB_STATE_KEY]?.history;
            if (snapshot?.revision >= revision) { revision = snapshot.revision; entries = snapshot.entries; }
        }
        return { revision, entries: normalizeHistory(entries) };
    }

    // 在已持有的跨页锁内更新历史，由 coordinate 与任务状态一起发布。
    function changeHistory(tab, tabs, change) {
        const current = sharedHistory(tabs);
        const entries = normalizeHistory(change(current.entries));
        const revision = current.revision + 1;
        historyMirror = entries;
        try {
            GM_setValue(HISTORY_KEY, entries);
            GM_setValue(HISTORY_REV_KEY, revision);
        } catch { /* 历史写入失败不阻断下载，本页仍保留记录。 */ }
        tabState(tab).history = { revision, entries };
        return entries;
    }

    function updateHistory(change) {
        return coordinate((tab, tabs) => changeHistory(tab, tabs, change));
    }

    async function reserveTask(url, titles, quiet = false) {
        const gid = new URL(url).searchParams.get('gid');
        const key = crypto.randomUUID();
        const task = { key, gid, owner: pageOwner, phase: 'preparing', id: `${gid}:pending`, title: titles[0] || `Gallery ${gid}`,
            keys: historyLimit() ? titleKeys(titles) : [], at: Date.now(), expires: Date.now() + CLAIM_TTL };
        const accepted = await coordinate((tab, tabs) => {
            if (liveTasks(tabs).some(other => other.gid === gid)) return false;
            const state = tabState(tab);
            state.tasks = (state.tasks || []).filter(other => other.expires > Date.now());
            state.tasks.push(task);
            return true;
        });
        if (!accepted) { if (!quiet) notify(`画廊 ${gid} 已有标签页正在准备或下载，本次没有重复启动。`); return null; }
        pageTasks.set(key, task);
        const ownedTask = (tab, tabs) => {
            const state = tabState(tab);
            if (liveTasks(tabs).some(other => other.key !== key && other.gid === gid)) {
                const error = new Error('另一标签页已接手此画廊，本次没有重复启动。');
                error.code = 'TASK_CONFLICT';
                throw error;
            }
            let stored = (state.tasks || []).find(other => other.key === key);
            // 后台休眠或缓存恢复可能使占位过期，没有实际冲突就自动续接。
            if (!stored) { stored = { ...task }; (state.tasks ||= []).push(stored); }
            if (stored.owner !== pageOwner) throw new Error('当前任务已由其他页面接手。');
            stored.expires = Date.now() + CLAIM_TTL;
            Object.assign(task, stored);
            return stored;
        };
        const editTask = change => coordinate((tab, tabs) => {
            const stored = ownedTask(tab, tabs);
            change(stored, tab);
            Object.assign(task, stored);
            return true;
        });
        const heartbeat = setInterval(() => editTask(stored => { stored.expires = Date.now() + CLAIM_TTL; }).catch(() => {}), 60000);
        return {
            key,
            submittingArchive: () => editTask((stored, tab) => {
                archiveAttempts.add(gid);
                const state = tabState(tab);
                state.archiveAttempts = [...new Set([...(state.archiveAttempts || []), gid])];
                stored.phase = 'submitted';
            }),
            notify: (text, link, persistent = false) => notify(text, link, persistent, key),
            async matches(id, title, keys) {
                if (historyLimit() === 0) return [];
                return coordinate((tab, tabs) => {
                    const stored = ownedTask(tab, tabs);
                    Object.assign(stored, { id, title, keys, expires: Date.now() + CLAIM_TTL });
                    Object.assign(task, stored);
                    const others = historyLimit() ? liveTasks(tabs).filter(other => other.key !== key) : [];
                    const history = sharedHistory(tabs).entries;
                    const active = others.filter(other => !history.some(entry => entry.job === other.key))
                        .map(other => ({ ...other, status: 'started', job: other.key }));
                    const matches = [...duplicateDownloads(history, id, title, keys),
                        ...active.flatMap(other => duplicateDownloads([other], id, title, keys))];
                    return matches;
                });
            },
            async started(entry) {
                await coordinate((tab, tabs) => {
                    const stored = ownedTask(tab, tabs);
                    stored.phase = 'downloading';
                    Object.assign(task, stored);
                    if (entry.id === `${gid}:archive:org`) {
                        archiveAttempts.delete(gid);
                        tabState(tab).archiveAttempts = (tabState(tab).archiveAttempts || []).filter(value => value !== gid);
                    }
                    if (historyLimit() > 0) {
                        try { changeHistory(tab, tabs, history => pushDownload(history, { ...entry, job: key, status: 'started', at: Date.now() })); }
                        catch { /* 历史不可用时仍保留正在下载的任务占位。 */ }
                    }
                });
            },
            async completed() {
                if (historyLimit() === 0) return;
                await updateHistory(history => history.map(entry => {
                    if (entry.job !== key) return entry;
                    const { status, ...completed } = entry;
                    return completed;
                })).catch(() => {});
            },
            async failed() {
                if (historyLimit() === 0) return;
                await updateHistory(history => history.filter(entry => entry.job !== key)).catch(() => {});
            },
            async release() {
                clearInterval(heartbeat);
                pageTasks.delete(key);
                await coordinate(tab => {
                    tabState(tab).tasks = (tabState(tab).tasks || []).filter(other => other.key !== key);
                }).catch(() => {});
            },
        };
    }

    function element(tag, text, parent) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (parent) parent.append(node);
        return node;
    }

    function getUI() {
        if (ui) return ui;
        const host = element('div');
        host.id = 'ehtd-ui';
        // document-start 时根节点可能尚未创建：先在离线节点上准备提示，根节点出现后再挂载。
        const mount = () => (document.body ?? document.documentElement).append(host);
        if (document.documentElement) mount();
        else new MutationObserver((_, observer) => {
            if (!document.documentElement) return;
            observer.disconnect(); mount();
        }).observe(document, { childList: true });
        const shadow = host.attachShadow({ mode: 'open' });
        element('style', `
            :host { all: initial; font: 14px/1.6 system-ui, sans-serif; }
            .toasts { position: fixed; z-index: 2147483647; right: 18px; bottom: 18px;
                max-width: min(420px, 85vw); max-height: 75vh; overflow-y: auto; }
            .notice { margin-top: 8px; padding: 12px 16px; border-radius: 10px;
                background: #202632; color: #f5f7fa; box-shadow: 0 4px 20px #0005; }
            .notice:empty { display: none; } .notice a { color: #abd2ff; }
            .notice.error { opacity: 1; transition: opacity 0.5s ease; }
            .notice.error.fading { opacity: 0; }
            .error-actions { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; margin-top: 10px; }
            .error-actions > button, .error-actions > .action { margin: 0; padding: 7px 10px; white-space: nowrap; }
            .error-details { max-height: 200px; overflow-y: auto; white-space: pre-wrap;
                overflow-wrap: anywhere; margin: 8px 0; font: 12px/1.5 monospace; }
            .error summary { margin-top: 6px; color: #c6d1de; cursor: pointer; }
            @media (prefers-reduced-motion: reduce) { .notice.error { transition: none; } }
            dialog { box-sizing: border-box; width: min(920px, 94vw); max-height: 85vh;
                padding: 22px; overflow: auto; background: #202632; color: #f5f7fa;
                border: 1px solid #586270; border-radius: 12px; font: inherit; }
            dialog::backdrop { background: #0009; } h2 { margin: 0 0 10px; font-size: 20px; }
            p { margin: 8px 0 14px; } .scroll { overflow-x: auto; }
            table { width: 100%; border-collapse: collapse; font: inherit; }
            th, td { padding: 10px 8px; border-bottom: 1px solid #46505e; text-align: left; }
            td:first-child { min-width: 180px; overflow-wrap: anywhere; }
            td:last-child, th:last-child { white-space: nowrap; }
            button, .action { display: inline-block; margin: 8px 8px 0 0; padding: 7px 12px;
                border: 1px solid #708196; border-radius: 6px; background: #344156;
                color: #fff; cursor: pointer; font: inherit; text-decoration: none; }
            button:focus-visible, a:focus-visible { outline: 2px solid #9acbff; }
            dialog.interval-settings { width: min(520px, 94vw); }
            .interval-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
            .interval-fields input { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 8px 10px;
                border: 1px solid #708196; border-radius: 6px; background: #151b25; color: #fff; font: inherit; }
            .interval-fields input:focus-visible { outline: 2px solid #9acbff; }
            .hint { color: #c6d1de; font-size: 12px; } .bad { color: #ffd18a; }
        `, shadow);
        const toasts = element('div', undefined, shadow);
        toasts.className = 'toasts';
        const notice = element('div', undefined, toasts);
        notice.className = 'notice';
        notice.setAttribute('role', 'status');
        ui = { shadow, notice, toasts, errors: new Map(), timer: null };
        return ui;
    }

    function originalLink(parent, url, text = null) {
        text ??= new URL(url, location.href).pathname === '/archiver.php' ? '打开原归档下载' : '打开原种子列表';
        const link = element('a', text, parent);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'action';
        return link;
    }

    function clearTaskNotice(taskKey) {
        if (!ui || ui.notice.dataset.ehtdTask !== taskKey) return;
        clearTimeout(ui.timer);
        ui.notice.replaceChildren();
    }

    function notify(text, url, persistent = false, taskKey = '') {
        const state = getUI();
        clearTimeout(state.timer);
        state.notice.replaceChildren();
        state.notice.dataset.ehtdTask = taskKey;
        element('span', text, state.notice);
        if (url) { element('br', undefined, state.notice); originalLink(state.notice, url); }
        if (!persistent) state.timer = setTimeout(() => state.notice.replaceChildren(), 8000);
    }

    function dismissWhenIdle(notice, remove) {
        idleDismissals.get(notice)?.();
        let timer = null;
        let fading = null;
        let hovered = notice.matches?.(':hover') || false;
        let windowFocused = document.hasFocus?.() !== false;
        let disposed = false;
        const selected = () => {
            const root = notice.getRootNode?.();
            const selection = root?.getSelection?.() || window.getSelection?.();
            return selection && !selection.isCollapsed
                && (notice.contains?.(selection.anchorNode) || notice.contains?.(selection.focusNode));
        };
        const focused = () => {
            const active = notice.getRootNode?.().activeElement;
            // 鼠标点过链接/详情后留下的焦点不应一直暂停；键盘焦点仍受保护。
            return notice.contains?.(active) && active.matches?.(':focus-visible');
        };
        const interacting = () => windowFocused && document.visibilityState !== 'hidden'
            && (hovered || focused() || selected());
        const pause = () => {
            clearTimeout(timer); clearTimeout(fading);
            timer = null; fading = null;
            notice.classList?.remove('fading');
        };
        const arm = () => {
            pause();
            if (disposed || interacting()) return;
            timer = setTimeout(() => {
                if (interacting()) { arm(); return; }
                notice.classList?.add('fading');
                fading = setTimeout(() => { dispose(); remove(); }, 500);
            }, 3000);
        };
        const enter = () => { hovered = true; arm(); };
        const leave = () => { hovered = false; arm(); };
        const blur = () => { pause(); timer = setTimeout(arm, 0); };
        const windowBlur = () => { windowFocused = false; hovered = false; arm(); };
        const windowFocus = () => {
            windowFocused = true; hovered = notice.matches?.(':hover') || false; arm();
        };
        const visibility = () => {
            windowFocused = document.hasFocus?.() !== false;
            if (document.visibilityState === 'hidden') hovered = false;
            arm();
        };
        const dispose = () => {
            if (disposed) return;
            disposed = true; pause();
            for (const [event, callback] of listeners) notice.removeEventListener?.(event, callback);
            document.removeEventListener?.('selectionchange', arm);
            document.removeEventListener?.('visibilitychange', visibility);
            window.removeEventListener?.('blur', windowBlur);
            window.removeEventListener?.('focus', windowFocus);
            idleDismissals.delete(notice);
        };
        const listeners = [['pointerenter', enter], ['pointerleave', leave], ['focusin', arm], ['focusout', blur]];
        for (const [event, callback] of listeners) notice.addEventListener(event, callback);
        document.addEventListener?.('selectionchange', arm);
        document.addEventListener?.('visibilitychange', visibility);
        window.addEventListener?.('blur', windowBlur);
        window.addEventListener?.('focus', windowFocus);
        idleDismissals.set(notice, dispose);
        arm();
    }

    function notifyError(error, fallback, taskKey) {
        if (error.cancelled || error.code === 'ABORT') return;
        const state = getUI();
        if (state.notice.dataset.ehtdTask === taskKey) {
            clearTimeout(state.timer); state.notice.replaceChildren();
        }
        let notice = state.errors.get(taskKey);
        if (!notice) {
            notice = element('div', undefined, state.toasts);
            notice.className = 'notice error'; notice.setAttribute('role', 'status');
            notice.dataset.ehtdError = taskKey; state.errors.set(taskKey, notice);
        }
        notice.replaceChildren();
        element('span', error.message, notice);
        if (error.details) {
            const detail = element('details', undefined, notice);
            element('summary', '错误详情', detail);
            element('pre', error.details, detail).className = 'error-details';
        }
        const actions = element('div', undefined, notice);
        actions.className = 'error-actions';
        if (fallback) originalLink(actions, fallback,
            new URL(fallback, location.href).pathname === '/archiver.php' ? '打开原档下载' : null);
        const close = element('button', '关闭此提示', actions);
        close.type = 'button';
        const remove = () => { notice.remove(); state.errors.delete(taskKey); };
        close.addEventListener('click', () => { idleDismissals.get(notice)?.(); remove(); });
        dismissWhenIdle(notice, remove);
    }

    function pickManually(records, url, decision, context = null) {
        return new Promise(resolve => {
            const dialog = element('dialog', undefined, getUI().shadow);
            const title = element('h2', '需要人工判断', dialog);
            title.id = 'ehtd-dialog-title';
            dialog.setAttribute('aria-labelledby', title.id);
            if (context) element('p', context.title, dialog);
            element('p', decision.reason, dialog).className = 'bad';
            const scroll = element('div', undefined, dialog);
            scroll.className = 'scroll';
            const table = element('table', undefined, scroll);
            const header = element('tr', undefined, element('thead', undefined, table));
            for (const text of ['种子名称', '版本状态', '下载量', '发布时间（网站原值）', '大小', '操作']) element('th', text, header);
            const body = element('tbody', undefined, table);
            const ranked = [...records].sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1) || (b.timestamp ?? -1) - (a.timestamp ?? -1));
            let chosen = null;
            for (const record of ranked) {
                const row = element('tr', undefined, body);
                element('td', record.name, row);
                element('td', record.outdated ? '过时' : '当前版本', row).className = record.outdated ? 'bad' : '';
                element('td', record.downloads === null ? '未识别' : record.downloads.toLocaleString(), row);
                element('td', record.posted ?? '未识别', row);
                element('td', record.size, row);
                const button = element('button', '下载此种子', element('td', undefined, row));
                button.type = 'button';
                button.addEventListener('click', () => { chosen = record; dialog.close(); });
            }
            element('p', '过时种子可能缺少图库更新内容。点击下载按钮才会下载所选文件。', dialog).className = 'hint';
            originalLink(dialog, url);
            const cancel = element('button', context ? '跳过这本' : '取消', dialog);
            cancel.type = 'button';
            cancel.addEventListener('click', () => dialog.close());
            if (context) {
                const stop = element('button', '停止后续选择', dialog);
                stop.type = 'button';
                stop.addEventListener('click', () => { context.stop(); dialog.close(); });
            }
            dialog.addEventListener('close', () => { dialog.remove(); resolve(chosen); }, { once: true });
            dialog.showModal();
        });
    }

    function historyTable(parent, entries) {
        const scroll = element('div', undefined, parent);
        scroll.className = 'scroll';
        const table = element('table', undefined, scroll);
        const header = element('tr', undefined, element('thead', undefined, table));
        for (const text of ['此前下载的漫画', '记录时间', '状态']) element('th', text, header);
        const body = element('tbody', undefined, table);
        for (const entry of entries) {
            const row = element('tr', undefined, body);
            element('td', entry.title || '旧版记录：同一画廊或种子', row);
            element('td', entry.at ? new Date(entry.at).toLocaleString() : '旧版未记录时间', row);
            element('td', entry.status === 'started' ? '已发起／准备中（未确认完成）' : entry.at ? '保存完成' : '旧版记录', row);
        }
    }

    function confirmDuplicate(matches, titleText, url) {
        return new Promise(resolve => {
            getUI().notice.replaceChildren();
            const dialog = element('dialog', undefined, getUI().shadow);
            const heading = element('h2', '重复下载提醒', dialog);
            heading.id = 'ehtd-duplicate-title';
            dialog.setAttribute('aria-labelledby', heading.id);
            element('p', `最近 ${historyLimit()} 笔下载记录及当前任务中发现 ${matches.length} 条匹配记录，已暂停下载。`, dialog).className = 'bad';
            element('p', `当前漫画：${titleText}`, dialog);
            historyTable(dialog, matches);
            element('p', '同一画廊、同一种子或相同题名别名都会提醒。题名包含卷号，罗马音和日文标题按画廊提供的对应关系匹配。', dialog).className = 'hint';
            let proceed = false;
            const cancel = element('button', '取消下载', dialog);
            cancel.type = 'button';
            cancel.autofocus = true;
            cancel.addEventListener('click', () => dialog.close());
            const download = element('button', '仍然下载', dialog);
            download.type = 'button';
            download.addEventListener('click', () => { proceed = true; dialog.close(); });
            originalLink(dialog, url);
            dialog.addEventListener('close', () => { dialog.remove(); resolve(proceed); }, { once: true });
            dialog.showModal();
        });
    }

    function batchInterval() {
        const value = GM_getValue(BATCH_INTERVAL_KEY, BATCH_INTERVAL_DEFAULT);
        return Number.isFinite(value?.min) && value.min >= 0 && Number.isFinite(value?.max) && value.max >= value.min
            ? value : BATCH_INTERVAL_DEFAULT;
    }

    function showBatchIntervalSettings() {
        const existing = getUI().shadow.querySelector('dialog.interval-settings');
        if (existing?.open) { existing.querySelector('input')?.focus(); return; }
        existing?.remove();
        const dialog = element('dialog', undefined, getUI().shadow);
        dialog.className = 'interval-settings';
        const title = element('h2', '批量下载间隔', dialog);
        title.id = 'ehtd-interval-title';
        dialog.setAttribute('aria-labelledby', title.id);
        element('p', '完成一个任务后，在最小值和最大值之间随机等待，再继续下一个。单位为秒，可填小数。', dialog);
        const form = element('form', undefined, dialog);
        form.noValidate = true;
        const fields = element('div', undefined, form);
        fields.className = 'interval-fields';
        const current = batchInterval();
        const inputs = ['min', 'max'].map((key, index) => {
            const label = element('label', index ? '最大值（秒）' : '最小值（秒）', fields);
            const input = element('input', undefined, label);
            input.type = 'number'; input.min = '0'; input.step = 'any'; input.required = true;
            input.name = `batch-${key}-seconds`; input.value = String(current[key]);
            return input;
        });
        element('p', '默认 0.25～0.5 秒；遇到网站限流或临时封禁会自动停止整批。两值相同则固定等待；都为 0 则不额外等待，仍逐个下载。', form).className = 'hint';
        const message = element('p', undefined, form);
        message.className = 'bad'; message.setAttribute('role', 'alert');
        const save = element('button', '保存', form);
        save.type = 'submit';
        const cancel = element('button', '取消', form);
        cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
        form.addEventListener('submit', event => {
            event.preventDefault();
            const [min, max] = inputs.map(input => input.value.trim() === '' ? NaN : Number(input.value));
            if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
                message.textContent = '请输入不小于 0 的有效秒数。'; return;
            }
            if (max < min) { message.textContent = '最大值不能小于最小值。'; return; }
            GM_setValue(BATCH_INTERVAL_KEY, { min, max });
            dialog.close();
            notify(`批量下载间隔已保存为 ${min}～${max} 秒，从下一次等待起生效。`);
        });
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.showModal();
    }

    function showHistory() {
        const dialog = element('dialog', undefined, getUI().shadow);
        element('h2', `下载历史 · v${VERSION}`, dialog);
        const entries = normalizeHistory(historyMirror ?? GM_getValue(HISTORY_KEY, []));
        element('p', historyLimit() === 0 ? '重复下载提醒已关闭，不记录下载历史。'
            : `当前保存 ${entries.length} 笔下载记录，最新发起的在最前，最多保存 ${historyLimit()} 笔。完成后更新状态；切页后保留“未确认完成”，请以浏览器下载列表为准。`, dialog);
        historyTable(dialog, entries);
        const close = element('button', '关闭', dialog);
        close.type = 'button';
        close.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.showModal();
    }

    function confirmArchive(preview, titleText, url, retry = false, file = null, headers = '') {
        return new Promise(resolve => {
            getUI().notice.replaceChildren();
            const dialog = element('dialog', undefined, getUI().shadow);
            element('h2', retry ? '重新申请原档' : '原档下载：费用与大小', dialog);
            element('p', titleText, dialog);
            element('p', file ? '将下载已生成的 Original 原档 ZIP，可直接确认下载。'
                : '将下载 Original 原档 ZIP。以下是网站显示的文件大小、GP / Credits 费用与额度；请核对原档对应信息。', dialog);
            const details = element('p', preview, dialog);
            details.style.cssText = 'padding:12px;background:#151b24;border-radius:6px;overflow-wrap:anywhere;';
            const knownBytes = Number(headers.match(/^content-length:\s*(\d+)/im)?.[1]);
            const knownSize = Number.isFinite(knownBytes) && knownBytes > 0;
            const size = file ? element('p', knownSize ? `文件大小：${(knownBytes / 1048576).toFixed(1)} MiB。`
                : '文件大小：正在查询，可直接确认下载。', dialog) : null;
            size?.setAttribute('aria-live', 'polite');
            const controller = file && !knownSize ? new AbortController() : null;
            let settled = false;
            const finish = proceed => {
                if (settled) return;
                settled = true;
                controller?.abort();
                dialog.close();
                dialog.remove();
                resolve(proceed);
            };
            const cancel = element('button', '取消下载', dialog);
            cancel.type = 'button'; cancel.autofocus = true;
            cancel.addEventListener('click', () => finish(false));
            const download = element('button', retry ? '重新申请原档' : '确认下载原档', dialog);
            download.type = 'button';
            download.addEventListener('click', () => finish(true));
            originalLink(dialog, url);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            dialog.addEventListener('close', () => finish(false), { once: true });
            dialog.showModal();
            if (file && !knownSize) {
                // 仅补充已有 ZIP 的大小；不阻塞确认，不重试，关窗后终止查询。
                request(file, false, url, { archive: true, method: 'HEAD', stage: '读取 ZIP 大小',
                    timeoutMs: 3000, retry: false, signal: controller.signal }).then(head => {
                    if (settled) return;
                    const bytes = Number(head.responseHeaders?.match(/^content-length:\s*(\d+)/im)?.[1]);
                    size.textContent = Number.isFinite(bytes) && bytes > 0 ? `文件大小：${(bytes / 1048576).toFixed(1)} MiB。`
                        : '文件大小暂时无法读取，请以网站原下载页面为准。';
                }).catch(() => {
                    if (!settled) size.textContent = '文件大小暂时无法读取，请以网站原下载页面为准。';
                });
            }
        });
    }

    async function pageRequest(url, referer, options) {
        const target = asURL(url);
        if (!target || target.origin !== location.origin || !SITES.has(target.hostname)) throw new Error('页面请求地址必须属于当前 EH / EX 站点。');
        const stage = options.stage || '读取原档页面';
        const timeout = options.timeoutMs ?? (options.data === undefined ? 60000 : 180000);
        const controller = new AbortController();
        const abort = () => controller.abort();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
        try {
            if (options.signal?.aborted) controller.abort();
            else options.signal?.addEventListener('abort', abort, { once: true });
            // 同源归档页面沿用当前标签页的会话；不读取或复制 Cookie，也不依赖扩展后台 XHR。
            const response = await fetch(target.href, {
                method: options.data === undefined ? 'GET' : 'POST', mode: 'same-origin', credentials: 'include',
                cache: 'no-store', signal: controller.signal,
                referrer: asURL(referer)?.origin === location.origin ? referer : location.href,
                ...(options.data === undefined ? {} : { body: options.data, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
            });
            if (!response.ok) {
                const error = new Error(`服务器返回 HTTP ${response.status}。`);
                error.status = response.status;
                throw error;
            }
            const final = asURL(response.url || url);
            if (!final || final.origin !== location.origin) throw new Error('请求跳转到了其他站点，请打开原归档入口查看。');
            const headers = [...response.headers].map(([key, value]) => `${key}: ${value}`).join('\r\n');
            if (options.archive && archiveResponseIsFile(headers)) {
                const file = archiveFileURL(final.href);
                controller.abort();
                if (!file) throw new Error('服务器已返回 ZIP，但无法取得有效直链。已停止读取大文件，请打开原归档入口下载。');
                return { archiveFile: final.href, responseHeaders: headers };
            }
            const reader = response.body?.getReader();
            if (!reader) throw new Error('服务器没有返回可读取的归档页面。');
            const decoder = new TextDecoder('utf-8');
            let length = 0;
            let text = '';
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                length += chunk.value.byteLength;
                if (length > 1024 * 1024) {
                    controller.abort();
                    throw new Error('归档页面响应超过大小限制，已停止读取。请打开原归档入口下载。');
                }
                text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
            return { status: response.status, finalUrl: final.href, responseText: text, responseHeaders: headers };
        } catch (error) {
            const failure = new Error(timedOut ? `“${stage}”等待 ${timeout / 1000} 秒超时。`
                : `“${stage}”失败：${error.message || '浏览器未返回页面。'}`);
            failure.code = options.signal?.aborted ? 'ABORT' : timedOut ? 'TIMEOUT' : error instanceof TypeError ? 'NETWORK' : 'RESPONSE';
            failure.status = error.status;
            throw failure;
        } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
    }

    async function request(url, binary = false, referer = location.href, options = {}) {
        const canRetry = options.retry !== false && options.data === undefined
            && (!options.method || /^(GET|HEAD)$/i.test(options.method));
        for (let attempt = 0; ; attempt++) {
            try {
                const response = await requestOnce(url, binary, referer, options);
                const body = binary ? response.response : response.responseText;
                const limited = rateLimitError(binary && Object.prototype.toString.call(body) === '[object ArrayBuffer]' && body.byteLength <= 4096
                    ? new TextDecoder().decode(body) : body);
                if (limited) throw limited;
                return response;
            } catch (error) {
                if (error.status === 429) error.code = 'RATE_LIMIT';
                const transient = ['NETWORK', 'TIMEOUT'].includes(error.code)
                    || error.status === 408 || error.status >= 500;
                if (!canRetry || attempt > 0 || !transient) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    function requestOnce(url, binary = false, referer = location.href, options = {}) {
        if (options.page && !binary && asURL(url)?.origin === location.origin) return pageRequest(url, referer, options);
        return new Promise((resolve, reject) => {
            let handle;
            let finished = false;
            const timeout = options.timeoutMs ?? 30000;
            const stage = options.stage;
            const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
            const fail = (message, code = 'RESPONSE', status) => {
                if (finished) return;
                finished = true; cleanup();
                const error = new Error(stage ? `“${stage}”失败：${message}` : message);
                error.code = code; error.status = status; reject(error);
            };
            const abort = () => { fail('请求已取消。', 'ABORT'); handle?.abort(); };
            const timer = setTimeout(() => { fail(`等待 ${timeout / 1000} 秒超时。`, 'TIMEOUT'); handle?.abort(); }, timeout + 5000);
            const finish = response => { finished = true; cleanup(); resolve(response); };
            // 文件响应头已提供可信归档地址时停止读取，随后交给浏览器原生下载。
            const streamArchive = response => {
                if (!options.archive || options.method === 'HEAD' || response.status < 200 || response.status >= 300) return false;
                const file = archiveFileURL(response.finalUrl || url);
                // 地址形似 /archive/ 不能证明响应是文件；HTML 必须继续解析和等待。
                if (!archiveResponseIsFile(response.responseHeaders)) return false;
                if (!file) {
                    fail('服务器已返回 ZIP，但无法取得有效直链。已停止读取大文件，请打开原归档入口下载。');
                    handle?.abort();
                    return true;
                }
                finish({ archiveFile: asURL(response.finalUrl || url).href, responseHeaders: response.responseHeaders });
                handle?.abort();
                return true;
            };
            try {
                if (options.signal?.aborted) { abort(); return; }
                options.signal?.addEventListener('abort', abort, { once: true });
                handle = GM_xmlhttpRequest({
                    method: options.method || (options.data === undefined ? 'GET' : 'POST'), url, timeout, anonymous: false,
                    headers: { Referer: referer, ...(options.data === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }), ...options.headers },
                    ...(options.data === undefined ? {} : { data: options.data }),
                    ...(binary ? { responseType: 'arraybuffer' } : { overrideMimeType: options.metadata ? 'application/json; charset=UTF-8' : 'text/html; charset=UTF-8' }),
                    onreadystatechange(response) { if (!finished && response.readyState >= 2) streamArchive(response); },
                    onprogress(progress) {
                        if (options.archive && !finished && progress.loaded > 1024 * 1024) {
                            fail('归档页面响应超过大小限制，已停止读取。请打开原归档入口下载。');
                            handle?.abort();
                        }
                    },
                    onload(response) {
                        if (finished || streamArchive(response)) return;
                        clearTimeout(timer);
                        const final = asURL(response.finalUrl || url);
                        if (response.status < 200 || response.status >= 300) return fail(`服务器返回 HTTP ${response.status}，请检查登录或稍后重试。`, 'RESPONSE', response.status);
                        if (!final || (options.metadata ? final.href !== METADATA_API : !(binary ? FILE_HOSTS : SITES).has(final.hostname)
                            && !(options.archive && archiveFileURL(final.href)))) return fail('请求跳转到登录页或未知地址，请在浏览器中检查原下载入口。');
                        finish(response);
                    },
                    onerror: () => fail('网络请求失败，请检查浏览器网络和站点登录状态。', 'NETWORK'),
                    ontimeout: () => fail(`等待 ${timeout / 1000} 秒超时。`, 'TIMEOUT'),
                    onabort: () => fail('请求已取消。', 'ABORT'),
                });
            } catch (error) {
                finished = true; cleanup();
                reject(extensionDisconnected(error) ? new Error('油猴连接已失效，请刷新当前页面后再下载。') : error);
            }
        });
    }

    function extensionDisconnected(error) {
        return /extension context invalidated|port (?:is |was )?(?:not reachable|disconnected|closed)|receiving end does not exist|通信端口.*(?:断开|关闭)/i
            .test(error?.message || String(error));
    }

    function requireBrowserDownload() {
        if (typeof GM_download !== 'function' || typeof GM_info === 'undefined' || GM_info.downloadMode !== 'browser') {
            throw new Error('原档自定义文件名需要 Browser API：请在 Tampermonkey 设置中将下载模式设为 Browser API，并允许下载权限及 zip 扩展名。设置完成后重试。');
        }
    }

    function save(source, name, archive = false, taskKey = '', mime = 'application/x-bittorrent') {
        return new Promise((resolve, reject) => {
            const reasons = {
                not_enabled: '请在 Tampermonkey 设置中启用下载功能（下载模式选择 Browser API）。',
                not_whitelisted: `请在 Tampermonkey 设置的下载扩展名白名单中加入 ${name.split('.').pop()}。`,
                not_permitted: '请授予 Tampermonkey 浏览器下载权限。',
                not_supported: '请使用支持下载功能的浏览器，并更新 Tampermonkey 至 5.4.6226 或更新版本。',
                not_succeeded: '下载失败或已取消，请检查浏览器下载列表。',
            };
            const saveAs = GM_getValue(SAVE_AS_KEY, false);
            const fail = (message, stage, value) => {
                const error = new Error(message);
                const reason = JSON.stringify(safeErrorValue(value));
                if (/\b(?:USER_CANCELED|USER_CANCELLED|user_cancelled|user_canceled)\b/i.test(reason)) {
                    error.message = '已取消下载。';
                    error.cancelled = true;
                }
                error.details = saveErrorDetails(stage, value, name);
                reject(error);
            };
            if ((archive || saveAs) && GM_info.downloadMode !== 'browser') {
                fail('请在 Tampermonkey 设置中将下载模式设为 Browser API。', 'configuration_error', { downloadMode: GM_info.downloadMode });
                return;
            }
            try {
                // ZIP 只传直链；不附加 Referer，由浏览器管理保存和进度。
                // 每个画廊独立等待回调，不阻塞其他画廊；成功路径不弹出提示。
                clearTaskNotice(taskKey);
                GM_download({
                    url: archive ? source : new Blob([source], { type: mime }),
                    name, saveAs, conflictAction: 'uniquify',
                    onload: resolve,
                    onerror: (...args) => {
                        const error = args[0];
                        let reason = '';
                        try { reason = typeof error?.error === 'string' ? reasons[error.error] : ''; } catch { /* 错误原值仍由详情处理器检查。 */ }
                        fail(reason || '保存失败，请展开错误详情查看具体原因。', 'onerror', args);
                    },
                    ontimeout: (...args) => fail('保存文件超时，请展开错误详情。', 'ontimeout', args),
                });
            } catch (error) {
                fail(extensionDisconnected(error) ? '油猴连接已失效，请刷新当前页面后再下载。'
                    : `保存调用抛出异常：${redactErrorText(error?.message || String(error))}。`, 'exception', error);
            }
        });
    }

    async function processDownload(url, pageTitles, onDetailPage, lease, options = {}) {
        if (!options.batch) lease.notify('正在读取种子下载量和发布时间…');
        const gid = new URL(url).searchParams.get('gid');
        const knownTitles = [...pageTitles, ...(options.titles || [])];
        // 批量时已用 API 取得题名：同一画廊或相同题名在请求种子列表前就跳过。
        if (options.batch && !options.prepared && options.titles?.length) {
            const title = knownTitles.find(value => romajiKey(value)) || knownTitles[0];
            if ((await lease.matches(`${gid}:pending`, title, titleKeys(knownTitles))).length) {
                return { status: 'duplicate', reason: '下载历史或当前任务中已有匹配', noRequest: true };
            }
        }
        // 点击下载时题名与种子列表并行读取；批量仍按原节奏，历史检查仍早于种子文件请求。
        const needsTitles = historyLimit() > 0 && !options.titles?.length && (!onDetailPage || !knownTitles.length);
        const titleController = new AbortController();
        const readTitles = () => request(galleryURLForList(url), false, location.href, { timeoutMs: 8000, retry: false, signal: titleController.signal })
            .then(gallery => ({ titles: titlesFromPage(new DOMParser().parseFromString(gallery.responseText, 'text/html'), url, galleryURLForList(url)) }))
            .catch(error => ({ error }));
        const extraTitles = needsTitles && !options.batch ? readTitles() : null;
        let parsed;
        try {
            parsed = options.prepared || parseTorrents((await request(url)).responseText, url);
            if (!parsed.hasTorrentInfo && !parsed.records.length) throw new Error('未识别到种子列表，可能尚未登录、遇到验证或页面结构发生变化。');
        } catch (error) { titleController.abort(); throw error; }
        // 列表页的种子数量可能已经过时，以刚取得的完整种子列表为准。
        if (!parsed.records.length && !parsed.issues.length) {
            titleController.abort();
            if (!options.batch) lease.notify('此画廊当前没有可下载的种子。', url);
            return { status: 'empty', reason: '当前没有可下载的种子' };
        }
        const decision = chooseTorrent(parsed.records, parsed.issues);
        let selected = options.selected || decision.best;
        if (decision.manual && !options.selected) {
            if (options.batch) return { status: 'manual', prepared: parsed, decision, reason: decision.reason };
            getUI().notice.replaceChildren();
            selected = await pickManually(parsed.records, url, decision);
            if (!selected) { titleController.abort(); return { status: 'skipped', reason: '已取消选择' }; }
        }
        const historyID = `${gid}:${selected.id}`;
        if (!options.batch) lease.notify('正在核对题名和下载记录…');
        const extra = await (extraTitles || (needsTitles ? readTitles() : { titles: [] }));
        if (extra.error?.code === 'RATE_LIMIT') throw extra.error;
        // 详情不可用时仍可用画廊 ID、种子 ID 和已有题名检查。
        let titles = [...knownTitles, ...(extra.titles || [])];
        if (!titles.length) titles = [selected.name];
        const title = titles.find(value => romajiKey(value)) || titles[0];
        const keys = titleKeys(titles);
        const matches = await lease.matches(historyID, title, keys);
        if (matches.length && options.batch) return { status: 'duplicate', reason: '下载历史或当前任务中已有匹配' };
        if (matches.length && !await confirmDuplicate(matches, title, url)) {
            lease.notify('已取消重复下载。');
            return { status: 'skipped', reason: '已取消重复下载' };
        }
        if (!options.batch) lease.notify(`正在下载种子：${selected.name}`);
        const file = await request(selected.url, true, url);
        const bytes = validateTorrent(file.response);
        await lease.started({ id: historyID, gid, title, keys, sourceURL: galleryURLForList(url) });
        try {
            const name = filename(selected, gid, url);
            if (options.batch) await saveTorrentToDirectory(bytes, name, options.batch.directory);
            else await save(bytes, name, false, lease.key);
        } catch (error) {
            await lease.failed();
            if (options.batch && ['NotAllowedError', 'SecurityError'].includes(error.name)) stopBatch(options.batch);
            throw error;
        }
        await lease.completed();
        clearTaskNotice(lease.key);
        return { status: 'done' };
    }

    // 调试时间线只记录地址类型和关键参数，不输出画廊 token、归档密钥或下载路径。
    function archiveDebugURL(value) {
        const url = asURL(value);
        if (!url) return String(value).slice(0, 40);
        const host = url.hostname === 'hath.network' || url.hostname.endsWith('.hath.network') ? 'hath' : url.hostname;
        const path = /^\/archive\//.test(url.pathname) ? '/archive/…' : url.pathname.replace(/\/g\/(\d+)\/[^/]+/, '/g/$1/…');
        const query = [...url.searchParams.keys()].map(key => ['start', 'autostart', 'gid'].includes(key) ? `${key}=${url.searchParams.get(key)}` : key);
        return `${host}${path}${query.length ? '?' + query.join('&') : ''}`;
    }

    function archiveDebugResponse(response) {
        if (response.archiveFile) return 'ZIP 文件头';
        const type = /^content-type:\s*([^;\r\n]+)/im.exec(response.responseHeaders || '')?.[1] || '?';
        return `${type}, ${(response.responseText || '').length} 字符, 最终 ${archiveDebugURL(response.finalUrl || '')}`;
    }

    async function processArchive(list, pageTitles, lease) {
        // 在申请可能付费的归档之前检查下载模式，避免配置错误后才发现无法保存。
        requireBrowserDownload();
        // 调试版：在控制台输出每一步耗时，结束时汇总一次，便于定位等待花在哪里。
        const traceStart = performance.now(), trace = [];
        let userMs = 0;
        const mark = (step, detail = '') => {
            const entry = `${String(Math.round(performance.now() - traceStart)).padStart(6)} ms  ${step}${detail ? '  ' + detail : ''}`;
            trace.push(entry);
            console.debug('[EHTD 原档调试]', entry);
        };
        const timed = async (step, url, promise) => {
            const begin = performance.now();
            mark(`→ ${step}`, archiveDebugURL(url));
            try {
                const response = await promise;
                mark(`← ${step} ${Math.round(performance.now() - begin)} ms`, archiveDebugResponse(response));
                return response;
            } catch (error) {
                mark(`× ${step} ${Math.round(performance.now() - begin)} ms`, `${error.code || ''} ${redactErrorText(error.message)}`);
                throw error;
            }
        };
        const asked = async promise => {
            const begin = performance.now();
            try { return await promise; } finally { userMs += performance.now() - begin; }
        };
        const galleryURL = galleryURLForList(list);
        const gid = new URL(list).searchParams.get('gid');
        let url = `${new URL(list).origin}/archiver.php?gid=${gid}&token=${new URL(list).searchParams.get('t')}`;
        let titles = [...pageTitles];
        // 原档按站点提供的日文题名命名；两种题名仍一起用于历史去重。
        // 详情页已有题名和入口时直接复用，列表页则独立于历史开关补齐题名。
        let title = galleryListURL(location.href) === list ? archiveTitleFromPage(document) : '';
        if (title) url = archiveFromPage(document, list, location.href) || url;
        // 只读费用页与补齐题名并行；付费 POST 和保存仍等待去重、费用确认。
        const previewURL = url, previewController = title ? null : new AbortController();
        mark('开始', `${title ? '详情页' : '列表页'}，入口 ${archiveDebugURL(url)}`);
        const preview = previewController ? timed('预读费用页', previewURL, request(previewURL, false, galleryURL, { archive: true, page: true,
            stage: '读取归档费用', timeoutMs: 60000, signal: previewController.signal }))
            .then(response => ({ response }), error => ({ error })) : null;
        try {
            if (!title) {
                lease.notify('正在读取画廊题名和原档入口…');
                try {
                    const gallery = await timed('读取画廊题名', galleryURL, request(galleryURL, false, location.href, { page: true, stage: '读取画廊题名', timeoutMs: 8000, retry: false }));
                    const doc = new DOMParser().parseFromString(gallery.responseText, 'text/html');
                    url = archiveFromPage(doc, list, galleryURL) || url;
                    titles = [...titlesFromPage(doc, list, galleryURL), ...titles];
                    title = archiveTitleFromPage(doc);
                } catch (error) {
                    if (error.code === 'RATE_LIMIT') throw error;
                    /* 题名请求失败不阻断归档：仍可按画廊 ID 和列表标题去重。 */
                }
            }
            title ||= titles[0] || `Gallery ${gid}`;
            const keys = titleKeys(titles);
            const historyID = `${gid}:archive:org`;
            const matches = await lease.matches(historyID, title, keys);
            mark('去重检查完成', `${matches.length} 条匹配`);
            if (matches.length && !await asked(confirmDuplicate(matches, title, url))) {
                lease.notify('已取消重复下载。');
                return;
            }
            lease.notify('正在读取原档费用与文件大小…', undefined, true);
            let response;
            if (preview && url === previewURL) {
                const initial = await preview;
                mark('使用预读结果');
                if (initial.error) throw initial.error;
                response = initial.response;
            } else {
                previewController?.abort();
                // 详情给出不同归档参数时可放弃预读，但不能忽略已收到的限流。
                const initial = preview && await preview;
                if (initial?.error?.code === 'RATE_LIMIT') throw initial.error;
                response = await timed('读取费用页', url, request(url, false, galleryURL, { archive: true, page: true, stage: '读取归档费用', timeoutMs: 60000 }));
            }
            let submitted = archiveAttempts.has(gid);
            let waitedMs = 0;
            const immediateHops = new Set();
            for (let attempt = 0; attempt < 60; attempt++) {
                const result = response.archiveFile ? { file: response.archiveFile }
                    : parseArchive(response.responseText, response.finalUrl || url, list);
                mark(`解析第 ${attempt + 1} 页`, result.file ? '已取得 ZIP 地址' : result.form ? '申请表单'
                    : `下一跳 ${archiveDebugURL(result.next)}，网站延时 ${result.waitMs} ms`);
                if (result.file) {
                    if (!archivePageURL(result.file, url, list)) throw new Error('原档响应地址与当前画廊不符，请打开原归档入口。');
                    if (!submitted && GM_getValue(ARCHIVE_CONFIRM_KEY, true)) {
                        if (!await asked(confirmArchive('网站已提供 ZIP 地址，此次不提交新的归档申请。', title, url, false, result.file, response.responseHeaders))) {
                            lease.notify('已取消原档下载。');
                            return;
                        }
                    }
                    await lease.started({ id: historyID, gid, title, keys, sourceURL: galleryURL });
                    mark('交给浏览器下载', archiveDebugURL(result.file));
                    try { await save(result.file, archiveFilename(title, gid, list), true, lease.key); }
                    catch (error) { await lease.failed(); throw error; }
                    mark('浏览器下载完成');
                    await lease.completed();
                    clearTaskNotice(lease.key);
                    return;
                }
                if (result.form) {
                    const preview = submitted
                        ? `上次申请没有取得下载地址，网站仍显示申请表单。重新申请可能再次扣除网站显示的费用。 ${result.preview}`
                        : result.preview;
                    if ((submitted || GM_getValue(ARCHIVE_CONFIRM_KEY, true)) && !await asked(confirmArchive(preview, title, url, submitted))) {
                        lease.notify('已取消原档下载，未提交归档申请。');
                        return;
                    }
                    await lease.submittingArchive();
                    submitted = true;
                    lease.notify('已确认，正在提交 Original 原档申请；取得 ZIP 地址后才开始保存。', undefined, true);
                    try {
                        // 申请可能 HTTP 跳转到 Hath；同源 fetch 无法接收跨域跳转。
                        // 使用扩展请求只提交一次，在已验证的文件响应头阶段停止读取并交给浏览器。
                        response = await timed('提交原档申请', result.form.url, request(result.form.url, false, url, { data: result.form.data, archive: true, stage: '申请 Original 原档', timeoutMs: 180000 }));
                    } catch (error) {
                        if (!['TIMEOUT', 'NETWORK'].includes(error.code)) throw error;
                        lease.notify('原档申请未收到响应，正在检查服务器是否已准备完成；不会再次提交申请…', url, true);
                        try {
                            response = await timed('检查申请结果', url, request(url, false, galleryURL, { archive: true, stage: '检查原档申请结果', timeoutMs: 60000 }));
                        } catch (check) {
                            throw new Error(`${error.message} ${check.message} 再点下载可检查结果；网站仍显示申请表单时，可选择重新申请。`);
                        }
                    }
                    continue;
                }
                if (!result.next) throw new Error('未识别到有效的原档准备地址，请打开原归档入口。');
                const current = response.finalUrl || url;
                // 同址轮询至少隔 3 秒；不足 1 秒的中转视为立即跳转，参与循环检测。
                const waitMs = result.next === current ? Math.max(3000, result.waitMs || 0) : result.waitMs || 0;
                if (waitedMs + waitMs > 180000) break;
                if (waitMs >= 1000) immediateHops.clear();
                else {
                    if (immediateHops.has(result.next)) throw new Error('归档页面出现循环跳转，已停止请求，请打开原归档入口。');
                    immediateHops.add(result.next);
                }
                // 短于 3 秒的中转只显示一条进度，长等待才显示倒计时。
                lease.notify(waitMs >= 3000 ? `网站正在准备原档，${Math.ceil(waitMs / 1000)} 秒后检查…` : '正在准备原档下载…', url, true);
                if (waitMs) { mark(`等待 ${waitMs} ms`); await new Promise(resolve => setTimeout(resolve, waitMs)); }
                waitedMs += waitMs;
                response = await timed('请求下一跳', result.next, request(result.next, false, current, { archive: true, stage: '等待原档准备', timeoutMs: 60000 }));
            }
            throw new Error('原档准备超过等待时间，请打开原归档入口查看进度；脚本不会再次提交付费申请。');
        } catch (error) {
            mark('出错', `${error.code || ''} ${redactErrorText(error.message)}`);
            throw error;
        } finally {
            previewController?.abort();
            const total = performance.now() - traceStart;
            console.info(`[EHTD 原档调试] 画廊 ${gid}：总计 ${Math.round(total)} ms，其中等待用户确认 ${Math.round(userMs)} ms，`
                + `脚本与网络 ${Math.round(total - userMs)} ms。复制以下时间线即可：\n${trace.join('\n')}`);
        }
    }

    function enqueue(url, anchor = null, archive = false, options = {}) {
        const key = new URL(url).searchParams.get('gid');
        if (pending.has(key)) return options.batch ? Promise.resolve({ status: 'busy', reason: '已有下载任务' }) : pending.get(key);
        if (anchor) { anchor.style.opacity = '0.55'; anchor.setAttribute('aria-busy', 'true'); }
        const titles = titlesFromPage(document, url, location.href);
        const onDetailPage = galleryListURL(location.href) === url;
        const fallback = archive ? `${new URL(url).origin}/archiver.php?gid=${key}&token=${new URL(url).searchParams.get('t')}` : url;
        // 不同画廊并行准备、并行保存；同一画廊在准备和保存期间合并重复点击。
        let lease;
        const job = Promise.resolve().then(async () => {
            if (archive) requireBrowserDownload();
            lease = await reserveTask(url, titles, Boolean(options.batch));
            if (!lease) return { status: 'busy', reason: '其他标签页正在下载' };
            return archive ? processArchive(url, titles, lease) : processDownload(url, titles, onDetailPage, lease, options);
        }).catch(error => {
            // 继续请求会延长封禁，整批立即停止。
            if (options.batch && error.code === 'RATE_LIMIT') stopBatch(options.batch);
            if (options.batch) return { status: error.code === 'TASK_CONFLICT' ? 'busy'
                : error.cancelled || error.code === 'ABORT' ? 'skipped' : 'failed', reason: redactErrorText(error.message) };
            if (error.cancelled || error.code === 'ABORT') return;
            if (error.code === 'TASK_CONFLICT') { notify(error.message); return; }
            notifyError({ message: `画廊 ${key}：${error.message}`, details: error.details },
                fallback, lease?.key || `gallery-${key}`);
        })
            .finally(async () => {
                try { if (lease) await lease.release(); }
                catch { /* 清理失败不改变这次下载的结果。 */ }
                pending.delete(key);
                if (anchor) { anchor.style.opacity = ''; anchor.removeAttribute('aria-busy'); }
            });
        pending.set(key, job);
        return job;
    }

    async function saveTorrentToDirectory(bytes, name, directory) {
        const stem = name.replace(/\.torrent$/i, '');
        let target = name;
        for (let suffix = 0; ; suffix++) {
            target = suffix ? `${stem} (${suffix}).torrent` : name;
            try { await directory.getFileHandle(target); }
            catch (error) {
                if (error.name === 'NotFoundError') break;
                if (error.name === 'TypeMismatchError') continue;
                throw error;
            }
        }
        const file = await directory.getFileHandle(target, { create: true });
        let writable;
        try {
            writable = await file.createWritable();
            await writable.write(bytes);
            // close 完成才算保存成功；同名文件加编号，保留已有文件。
            await writable.close();
        } catch (error) {
            try { await writable?.abort(); } catch { /* 保留原来的写入错误。 */ }
            // target 已确认不存在；仅清理本次新建但保存失败的文件。
            try { await directory.removeEntry(target); } catch { /* 清理失败仍报告原来的保存错误。 */ }
            throw error;
        }
    }

    function batchTargets() {
        const found = new Map();
        for (const anchor of document.querySelectorAll('.itg a[href*="gallerytorrents.php"], .itg a[onclick*="gallerytorrents.php"]')) {
            const url = linkListURL(anchor, location.href);
            if (!url) continue;
            const gid = new URL(url).searchParams.get('gid');
            if (found.has(gid)) continue;
            found.set(gid, { url, anchor, title: titleFromPage(document, url, location.href) || `画廊 ${gid}`, status: 'queued' });
        }
        return [...found.values()];
    }

    function batchCounts(state) {
        const count = status => state.items.filter(item => item.status === status).length;
        return `已检查 ${state.items.length - count('queued')} / ${state.items.length} · 已保存 ${count('done')} · 待选择 ${count('manual')} · 已跳过 ${count('duplicate') + count('empty') + count('busy') + count('skipped')} · 失败 ${count('failed')}`;
    }

    function stopBatch(state) {
        state.stopped = true;
        state.cancelWait?.();
    }

    function waitForBatchInterval(state) {
        const { min, max } = batchInterval();
        return new Promise(resolve => {
            let timer;
            const finish = () => {
                clearTimeout(timer);
                state.cancelWait = null;
                resolve();
            };
            state.cancelWait = finish;
            timer = setTimeout(finish, (min + Math.random() * (max - min)) * 1000);
            if (state.stopped || !pageActive) finish();
        });
    }

    function updateBatchProgress(state) {
        state.panel.replaceChildren();
        element('strong', state.phase === 'finished' ? state.stopped ? '批量下载已停止' : '批量下载已完成' : '批量下载种子', state.panel);
        element('div', `保存到：${state.directory.name}`, state.panel);
        element('div', batchCounts(state), state.panel);
        if (state.phase !== 'finished') {
            element('div', `当前：${state.current || '准备中'}`, state.panel);
            const stop = element('button', state.stopped ? '正在停止…' : '停止（当前项完成后）', state.panel);
            stop.type = 'button'; stop.disabled = state.stopped;
            stop.addEventListener('click', () => { stopBatch(state); updateBatchProgress(state); });
        } else {
            const results = element('button', '查看结果', state.panel);
            results.type = 'button';
            results.addEventListener('click', () => showBatchSummary(state));
            const close = element('button', '关闭', state.panel);
            close.type = 'button';
            close.addEventListener('click', () => {
                state.panel.remove();
                state.summary?.remove();
                if (batchPanel === state.panel) batchPanel = null;
            });
        }
    }

    async function runBatchQueue(state, items, manual = false) {
        batchRun = state;
        state.phase = manual ? 'manual' : 'automatic';
        try {
            for (let i = 0; i < items.length; i++) {
                if (state.stopped || !pageActive) { stopBatch(state); break; }
                const item = items[i];
                state.current = item.title;
                updateBatchProgress(state);
                let selected;
                if (manual) {
                    selected = await pickManually(item.prepared.records, item.url, item.decision,
                        { title: item.title, stop: () => stopBatch(state) });
                    if (state.stopped) break;
                }
                const result = manual && !selected ? { status: 'skipped', reason: '已跳过人工选择' }
                    : !manual && item.torrentcount === 0 ? { status: 'empty', reason: '网站显示此画廊没有种子', noRequest: true }
                    : await enqueue(item.url, item.anchor, false, { batch: state, titles: item.titles,
                        ...(manual ? { selected, prepared: item.prepared } : {}) });
                const requested = !result.noRequest;
                delete result.noRequest;
                Object.assign(item, result);
                if (item.status !== 'manual') { delete item.prepared; delete item.decision; }
                updateBatchProgress(state);
                if (state.stopped) break;
                if (requested && i < items.length - 1) await waitForBatchInterval(state);
            }
        } finally {
            state.cancelWait?.();
            state.phase = 'finished';
            if (batchRun === state) batchRun = null;
            updateBatchProgress(state);
        }
    }

    function showBatchSummary(state) {
        if (state.summary?.isConnected) { if (!state.summary.open) state.summary.showModal(); return; }
        const dialog = element('dialog', undefined, getUI().shadow);
        state.summary = dialog;
        const resume = async (items, manual) => {
            if (batchRun) { notify('当前已有一批任务正在运行。'); return; }
            state.stopped = false;
            dialog.close();
            try { await runBatchQueue(state, items, manual); }
            catch (error) { notifyError(error, null, 'batch'); }
            render();
            dialog.showModal();
        };
        const action = (label, items, manual, parent) => {
            const button = element('button', label, parent);
            button.type = 'button'; button.addEventListener('click', () => resume(items, manual));
        };
        const render = () => {
            dialog.replaceChildren();
            element('h2', '批量下载结果', dialog);
            element('p', batchCounts(state), dialog);
            element('p', `保存文件夹：${state.directory.name}。每本择优保存一个种子。`, dialog).className = 'hint';
            const waiting = state.items.filter(item => item.status === 'manual' && item.prepared.records.length);
            const failed = state.items.filter(item => item.status === 'failed');
            const remaining = state.items.filter(item => item.status === 'queued');
            if (waiting.length) action(`逐一选择（${waiting.length}）`, waiting, true, dialog);
            if (failed.length) action(`重试失败项（${failed.length}）`, failed, false, dialog);
            if (remaining.length) action(`继续剩余项目（${remaining.length}）`, remaining, false, dialog);
            const outstanding = state.items.filter(item => ['manual', 'failed', 'queued'].includes(item.status));
            if (outstanding.length) {
                const table = element('table', undefined, element('div', undefined, dialog));
                table.parentElement.className = 'scroll';
                const header = element('tr', undefined, element('thead', undefined, table));
                for (const text of ['漫画', '状态 / 原因', '操作']) element('th', text, header);
                const body = element('tbody', undefined, table);
                for (const item of outstanding) {
                    const row = element('tr', undefined, body);
                    element('td', item.title, row);
                    element('td', item.reason || '尚未处理', row);
                    const cell = element('td', undefined, row);
                    if (item.status === 'manual' && item.prepared.records.length) action('选择种子', [item], true, cell);
                    else if (item.status === 'failed') action('重试', [item], false, cell);
                    originalLink(cell, item.url);
                }
            }
            const close = element('button', '关闭', dialog);
            close.type = 'button'; close.addEventListener('click', () => { dialog.close(); dialog.remove(); });
        };
        dialog.addEventListener('cancel', () => dialog.remove());
        render();
        dialog.showModal();
    }

    async function startBatchDownload() {
        if (batchRun) { notify('当前已有一批任务正在运行。'); return; }
        const items = batchTargets();
        if (!items.length) { notify('当前页面没有可下载的种子入口。'); return; }
        const pickerWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        if (typeof pickerWindow.showDirectoryPicker !== 'function') {
            notify('选择文件夹需要使用 Chrome / Edge，并通过 HTTPS 打开当前网站。');
            return;
        }
        const state = { items, stopped: false, phase: 'automatic' };
        batchRun = state;
        try {
            // 必须直接由这次点击调用，保留浏览器的用户手势授权。
            state.directory = await pickerWindow.showDirectoryPicker({ id: 'ehtd-torrents', mode: 'readwrite', startIn: 'desktop' });
            batchPanel?.remove();
            state.panel = batchPanel = element('div', undefined, getUI().toasts);
            state.panel.className = 'notice batch'; state.panel.setAttribute('role', 'status');
            state.panel.textContent = '正在读取画廊信息…';
            try {
                const info = await readEHGalleries(items.map(item => item.url));
                for (const item of items) Object.assign(item, info.get(new URL(item.url).searchParams.get('gid')) || {});
            } catch (error) {
                // 限流时不再开始；API 其他故障时回退为逐本读取详情页。
                if (error.code === 'RATE_LIMIT') throw error;
            }
            await runBatchQueue(state, items);
            showBatchSummary(state);
        } catch (error) {
            if (error.name !== 'AbortError') notifyError(new Error(`批量下载未能开始：${redactErrorText(error.message)}`), null, 'batch');
        } finally { if (batchRun === state) batchRun = null; }
    }

    function searchChineseOnly() {
        const input = document.querySelector('#f_search, input[name="f_search"]');
        if (!input) return;
        const query = input.value.trim();
        if (!/(?:^|\s)(?:l|language):(?:chinese\$|"chinese\$")(?=\s|$)/i.test(query)) {
            input.value = query ? `${query} l:chinese$` : 'l:chinese$';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.form;
        const submit = form?.querySelector('button[type="submit"], input[type="submit"]');
        if (submit) submit.click();
        else if (form) form.requestSubmit();
    }

    function prepareSearchActions() {
        if (document.getElementById('ehtd-search-tools')) return;
        const form = document.querySelector('#f_search, input[name="f_search"]')?.form;
        const row = form?.querySelector('a[onclick*="toggle_filesearch_pane"], a[onclick*="toggle_advsearch_pane"]')?.parentElement
            || form?.querySelector('#advdiv')?.previousElementSibling;
        if (!row) return;
        const tools = element('span', undefined, row);
        tools.id = 'ehtd-search-tools';
        for (const [text, callback] of [['批量下载种子', startBatchDownload], ['只显示中文结果', searchChineseOnly]]) {
            const slot = element('span', undefined, tools);
            slot.style.cssText = 'display:inline-block;white-space:nowrap;margin-inline-start:12px;';
            slot.append(document.createTextNode('['));
            const link = element('a', text, slot);
            link.href = '#';
            link.addEventListener('click', event => { event.preventDefault(); callback(); });
            slot.append(document.createTextNode(']'));
        }
    }

    function prepareLinks(root) {
        const selector = 'a[href*="gallerytorrents.php"], a[onclick*="gallerytorrents.php"]';
        const anchors = [...(root.querySelectorAll?.(selector) ?? [])];
        if (root.matches?.(selector)) anchors.unshift(root);
        for (const anchor of anchors) {
            const url = linkListURL(anchor, location.href);
            if (!url || anchor.dataset.ehtdList === url) continue;
            anchor.dataset.ehtdList = url;
            anchor.href = url;
            anchor.removeAttribute('onclick');
            const title = '优先选择当前版本中下载量最高的种子；全部过时则提示人工选择。Shift / Ctrl 点击打开原列表。';
            anchor.title = title;
            for (const image of anchor.querySelectorAll('img')) image.title = title;
        }
        prepareArchiveIcons(root);
    }

    function preparePageActions() {
        prepareSearchActions();
        const detail = galleryListURL(location.href);
        if (detail) prepareDetailArchiveIcon(detail);
        prepareMetadataLink();
    }

    function observeLinks() {
        const roots = new Set();
        let scheduled = false;
        // 自己创建的按钮不再反过来触发整行扫描；页面新增内容仍正常处理。
        const owned = '#ehtd-ui, #ehtd-search-tools, a[data-ehtd-archive], [data-ehtd-detail-archive-slot], [data-ehtd-metadata-slot]';
        const collect = node => {
            if (node.nodeType !== 1 || !node.isConnected || node.closest(owned)) return;
            const root = node.closest('.gl1t, .gl1e, .itg tr') || node;
            for (let parent = root; parent; parent = parent.parentElement) if (roots.has(parent)) return;
            for (const other of roots) if (root.contains(other)) roots.delete(other);
            roots.add(root);
        };
        new MutationObserver(changes => {
            for (const change of changes) {
                if (change.type === 'attributes') {
                    const anchor = change.target;
                    // prepareLinks 写入的 href / 移除的 onclick 无需再处理。
                    if (anchor.dataset.ehtdList && !anchor.hasAttribute('onclick')
                        && linkListURL(anchor, location.href) === anchor.dataset.ehtdList) continue;
                    collect(anchor);
                }
                for (const node of change.addedNodes) collect(node);
            }
            if (scheduled || !roots.size) return;
            scheduled = true;
            // 合并同批父子节点和同一行变动，并让浏览器有机会继续解析与绘制。
            setTimeout(() => {
                scheduled = false;
                const batch = [...roots]; roots.clear();
                for (const root of batch) if (root.isConnected) prepareLinks(root);
                preparePageActions();
            }, 0);
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'onclick'] });
    }

    function createArchiveIcon(list) {
        const source = new URL(list), arrow = element('a');
        arrow.dataset.ehtdArchive = list;
        arrow.dataset.ehtdGallery = galleryURLForList(list);
        arrow.href = `${source.origin}/archiver.php?gid=${source.searchParams.get('gid')}&token=${source.searchParams.get('t')}`;
        arrow.title = '下载 Original 原档 ZIP（橙色箭头），文件名自动包含站点、gid 和 token。Shift / Ctrl 点击打开原归档入口。';
        arrow.setAttribute('aria-label', '下载 Original 原档 ZIP');
        arrow.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;margin-left:5px;vertical-align:middle;color:#ed951f;text-decoration:none;cursor:pointer;';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', '#ed951f');
        path.setAttribute('d', 'M6 1h4v6h3L8 12 3 7h3V1zm-4 11h2v2h8v-2h2v4H2v-4z');
        svg.append(path); arrow.append(svg);
        return arrow;
    }

    function prepareDetailArchiveIcon(list) {
        const menu = document.querySelector('#gd5');
        if (!menu) return;
        const native = [...menu.querySelectorAll('a[href*="archiver.php"], a[onclick*="archiver.php"]')]
            .find(link => !link.dataset.ehtdArchive && linkArchiveURL(link, location.href, list));
        const slot = native?.closest('.g2');
        const existing = [...menu.querySelectorAll('a[data-ehtd-archive]')];
        let arrow = existing.find(link => link.dataset.ehtdArchive === list);
        const rows = [...menu.querySelectorAll('[data-ehtd-detail-archive-slot]')];
        let item = rows[0];
        for (const old of existing) if (!slot || old !== arrow) old.remove();
        for (const old of rows) if (!slot || old !== item) old.remove();
        if (!slot) return;
        if (!item) {
            item = document.createElement('p'); item.className = slot.className;
            item.dataset.ehtdDetailArchiveSlot = 'true';
            const chevron = slot.querySelector('img');
            if (chevron) {
                const icon = chevron.cloneNode(false); icon.alt = '';
                item.append(icon, document.createTextNode(' '));
            } else item.append(document.createTextNode('› '));
        }
        if (!arrow) arrow = createArchiveIcon(list);
        // The detail menu uses a normal text row; retain the compact orange icon in search results.
        if (arrow.textContent !== '下载原档 ZIP') arrow.textContent = '下载原档 ZIP';
        if (arrow.hasAttribute('style')) arrow.removeAttribute('style');
        arrow.title = '下载 Original 原档 ZIP，文件名自动包含站点、gid 和 token。Shift / Ctrl 点击打开原归档入口。';
        if (arrow.parentElement !== item) item.append(arrow);
        if (slot.nextElementSibling !== item) slot.after(item);
    }

    function prepareArchiveIcons(root) {
        if (galleryListURL(location.href)) return;
        const rowSelector = '.gl1t, .gl1e, .itg tr';
        const scope = root.closest?.(rowSelector) || root;
        const anchors = [...(scope.querySelectorAll?.('a[href*="/g/"]') ?? [])];
        if (scope.matches?.('a[href*="/g/"]')) anchors.unshift(scope);
        const seen = new Map();
        for (const galleryLink of anchors) {
            const list = galleryListURL(asURL(galleryLink.getAttribute('href'), location.href)?.href);
            const row = galleryLink.closest(rowSelector);
            if (!list || !row) continue;
            if (!seen.has(row)) seen.set(row, new Set());
            if (seen.get(row).has(list)) continue;
            seen.get(row).add(list);
            const current = new Set([...row.querySelectorAll('a[href*="/g/"]')]
                .map(link => galleryListURL(asURL(link.getAttribute('href'), location.href)?.href)).filter(Boolean));
            for (const old of row.querySelectorAll('a[data-ehtd-archive]')) if (!current.has(old.dataset.ehtdArchive)) old.remove();
            const galleryURL = galleryURLForList(list);
            const torrent = [...row.querySelectorAll('a[data-ehtd-list], a[href*="gallerytorrents.php"], a[onclick*="gallerytorrents.php"]')]
                .find(link => (link.dataset.ehtdList || linkListURL(link, location.href)) === list);
            let arrow = [...row.querySelectorAll('a[data-ehtd-archive]')].find(link => link.dataset.ehtdArchive === list);
            if (!arrow) {
                arrow = createArchiveIcon(list);
                if (torrent) torrent.after(arrow);
                else {
                    let slot = row.querySelector('.gldown');
                    const metadata = row.querySelector('.gl5t');
                    if (!slot && metadata) {
                        slot = element('div', undefined, metadata.children[1] || metadata);
                        slot.className = 'gldown';
                    }
                    if (slot) slot.append(arrow);
                    else {
                        const titleLink = [...row.querySelectorAll('a[href*="/g/"]')].find(link => link.querySelector('.glink, .glname')) || galleryLink;
                        titleLink.after(arrow);
                    }
                }
            } else if (torrent && arrow.previousElementSibling !== torrent) torrent.after(arrow);
            const slot = arrow.closest('.gldown');
            if (slot) {
                // 网站的 .gldown 常为 15×15 固定容器，保持原位置并扩大宽度，防止箭头换行。
                Object.assign(slot.style, { display: 'inline-flex', alignItems: 'center', width: 'max-content', whiteSpace: 'nowrap', lineHeight: '0' });
                if (torrent) Object.assign(torrent.style, { display: 'inline-flex', alignItems: 'center', flexShrink: '0', lineHeight: '0' });
            }
            // 保留 href 的人工入口；不预先请求每个搜索结果的详情页或费用。
            arrow.dataset.ehtdGallery = galleryURL;
        }
    }

    document.addEventListener('click', event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const anchor = event.target instanceof Element ? event.target.closest('a') : null;
        if (!anchor) return;
        const archive = Boolean(anchor.dataset.ehtdArchive);
        const url = archive ? anchor.dataset.ehtdArchive : anchor.dataset.ehtdList || linkListURL(anchor, location.href);
        if (!url) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        enqueue(url, anchor, archive);
    }, true);

    async function start() {
        if (NH_SITES.has(location.hostname)) { startNHMetadata(); return; }
        if (typeof GM_addValueChangeListener === 'function') {
            try { GM_addValueChangeListener(HISTORY_KEY, (_key, _old, value) => { historyMirror = normalizeHistory(value); }); }
            catch { /* 历史监听不可用也继续准备操作入口。 */ }
        }
        // 先准备操作入口，辅助历史或扩展登记不可用也不会让按钮消失。
        prepareLinks(document);
        preparePageActions();
        observeLinks();

        GM_registerMenuCommand('切换：打开详情页自动下载', () => {
            const enabled = !GM_getValue(AUTO_KEY, false);
            GM_setValue(AUTO_KEY, enabled);
            notify(`详情页自动下载已${enabled ? '开启' : '关闭'}，下次打开详情页生效。`);
        });
        GM_registerMenuCommand('切换：下载弹出另存为', () => {
            const enabled = !GM_getValue(SAVE_AS_KEY, false);
            GM_setValue(SAVE_AS_KEY, enabled);
            notify(enabled ? '种子、原档和 metadata 下载已开启另存为。' : '种子、原档和 metadata 使用浏览器的默认下载目录。');
        });
        GM_registerMenuCommand('设置批量下载间隔（秒）', showBatchIntervalSettings);
        GM_registerMenuCommand(`查看版本和下载历史（${VERSION}）`, showHistory);
        GM_registerMenuCommand('设置重复提醒的记录笔数（0 为关闭）', async () => {
            const input = window.prompt('设置最近下载记录的保存笔数（非负整数）。默认 100；0 关闭提醒并清空历史。减少笔数会删除较旧记录。', String(historyLimit()));
            if (input === null) return;
            const value = /^\d+$/.test(input.trim()) ? Number(input.trim()) : NaN;
            if (!Number.isSafeInteger(value)) { notify('请输入非负整数，设置未改变。'); return; }
            GM_setValue(HISTORY_LIMIT_KEY, value);
            await updateHistory(history => history);
            notify(value === 0 ? '重复提醒已关闭，历史已清空，不再记录下载。' : `重复提醒已开启，只保存最新 ${value} 笔下载记录。`);
        });
        GM_registerMenuCommand('切换：原档 GP 和文件大小提醒', () => {
            const enabled = !GM_getValue(ARCHIVE_CONFIRM_KEY, true);
            GM_setValue(ARCHIVE_CONFIRM_KEY, enabled);
            notify(`原档 GP 和文件大小提醒已${enabled ? '开启：提交申请前确认网站费用。' : '关闭：点击箭头将直接申请并下载，网站可能扣除 GP / Credits 或免费额度。'}`);
        });
        GM_registerMenuCommand('清除下载记录', async () => {
            await updateHistory(() => []);
            notify('已清除下载记录。');
        });
        const historyReady = updateHistory(history => history).catch(() => {});
        // 按钮随页面片段立即出现；自动下载仍等待完整题名与原生菜单。
        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        await historyReady;
        const url = galleryListURL(location.href);
        if (url && GM_getValue(AUTO_KEY, false)) {
            const anchor = [...document.querySelectorAll('a[data-ehtd-list]')].find(item => item.dataset.ehtdList === url);
            enqueue(url, anchor);
        }
        // 直接访问种子列表页时不自动下载，保留“打开原列表”的人工入口。
    }

    // 返回缓存页面时自动续接，不重跑自动下载，也不重复安装监听和菜单。
    window.addEventListener?.('pagehide', () => { pageActive = false; if (batchRun) stopBatch(batchRun); });
    window.addEventListener?.('pageshow', event => {
        pageActive = true;
        if (!event.persisted) return;
        if (NH_SITES.has(location.hostname)) { prepareNHMetadataLink(); return; }
        pageInitialization = null;
        coordinationRetryAt = 0;
        prepareLinks(document);
        preparePageActions();
        updateHistory(history => history).catch(() => {});
    });
    start().catch(error => notifyError(error, location.href, 'initialize'));
})();
