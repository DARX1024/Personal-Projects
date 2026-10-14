'use strict';

// 脚本在 Node 中通过 module.exports 导出纯函数；DOM 相关函数由 jsdom 提供环境。
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://exhentai.org/' });
Object.assign(global, {
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
});

module.exports = require('../eh-torrent-downloader.user.js');
