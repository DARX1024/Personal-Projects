'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('./helpers');

const EX_LIST = 'https://exhentai.org/gallerytorrents.php?gid=123&t=abcdef0123';
const bytes = value => Buffer.byteLength(value);

test('文件名：中日文长标题按 UTF-8 字节截断', () => {
    const torrent = m.filename({ name: '超'.repeat(200), id: 'a'.repeat(40) }, 123, EX_LIST);
    assert.ok(bytes(torrent) <= 230, `torrent ${bytes(torrent)} bytes`);
    assert.match(torrent, /^\[EX_123_abcdef0123\] 超+-aaaaaaaa\.torrent$/);

    const zip = m.archiveFilename('超'.repeat(300), 123, EX_LIST);
    assert.ok(bytes(zip) <= 230, `zip ${bytes(zip)} bytes`);
    assert.match(zip, /^\[EX_123_abcdef0123\] 超+\.zip$/);
});

test('文件名：短标题保持原样', () => {
    assert.equal(m.filename({ name: 'Title.torrent', id: 'b'.repeat(40) }, 1, null), '1-Title-bbbbbbbb.torrent');
    assert.equal(m.archiveFilename('My Title. ', 1, null), '1 - My Title.zip');
});

test('clipBytes 不拆开多字节字符', () => {
    assert.equal(m.clipBytes('ab超c', 4), 'ab');
    assert.equal(m.clipBytes('ab超c', 5), 'ab超');
    assert.equal(m.clipBytes('😀😀', 5), '😀');
});

test('限流 / 封禁页面识别', () => {
    const ban = m.rateLimitError('Your IP address has been temporarily banned for excessive pageloads. The ban expires in 59 minutes.');
    assert.equal(ban?.code, 'RATE_LIMIT');
    assert.equal(m.rateLimitError('You are opening pages too fast, thus placing a heavy load on the server.')?.code, 'RATE_LIMIT');
    assert.equal(m.rateLimitError('<html>normal gallery page</html>'), null);
    // 长页面（例如评论中出现同样字样）不误判。
    assert.equal(m.rateLimitError('x'.repeat(5000) + ' temporarily banned'), null);
    assert.equal(m.rateLimitError(undefined), null);
});

test('ComicInfo.xml：EX 画廊的 Web 使用 exhentai.org', () => {
    const gallery = { gid: 123, token: 'abcdef0123', web: 'https://exhentai.org/g/123/abcdef0123/',
        title: '[Artist] Some Title Vol. 2 [Chinese]', title_jpn: '', tags: ['language:chinese', 'female:big breasts'], filecount: '20' };
    const xml = m.metadataXML(gallery);
    assert.match(xml, /<Web>https:\/\/exhentai\.org\/g\/123\/abcdef0123\/<\/Web>/);
    assert.match(xml, /<Number>2<\/Number>/);
    assert.match(xml, /<LanguageISO>zh<\/LanguageISO>/);
    assert.match(xml, /女性：巨乳/);
});

test('词库：JSON 文件结构完整', () => {
    const file = path.join(__dirname, '..', 'metadata-dictionary.json');
    const dictionary = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(dictionary).sort(), ['entries', 'namespaces', 'overrides']);
    assert.ok(Object.keys(dictionary.entries).length > 10000);
    assert.equal(m.metadataDictionary().namespaces.artist, '艺术家');
});

test('种子择优：当前版本中下载量最高者', () => {
    const records = [
        { id: 'a', downloads: 10, timestamp: 1, outdated: false },
        { id: 'b', downloads: 50, timestamp: 1, outdated: false },
        { id: 'c', downloads: 99, timestamp: 1, outdated: true },
    ];
    assert.equal(m.chooseTorrent(records).best.id, 'b');
    assert.equal(m.chooseTorrent([records[2]]).manual, true);
});

test('种子校验：bencode 结构', () => {
    assert.ok(m.validateTorrent(Buffer.from('d4:infod4:name1:aee')));
    assert.throws(() => m.validateTorrent(Buffer.from('<html>banned</html>')));
    assert.throws(() => m.validateTorrent(Buffer.from('d4:name1:ae')));
});

test('URL 识别', () => {
    assert.equal(m.galleryListURL('https://exhentai.org/g/123/abcdef0123/'), EX_LIST);
    assert.equal(m.listURL('https://evil.example/gallerytorrents.php?gid=1&t=abcdef0123'), null);
    assert.equal(m.nhGalleryURL('https://nhentai.net/g/42'), 'https://nhentai.net/g/42/');
});
