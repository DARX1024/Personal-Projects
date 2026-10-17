# EH / EX 种子择优下载

Tampermonkey 用户脚本：

- **E-Hentai / ExHentai**：点击种子入口自动选择当前版本中下载量最高的种子；橙色箭头下载 Original 原档 ZIP（申请前确认 GP / Credits 费用）；搜索页批量下载种子；按画廊、种子和题名别名提醒重复下载；导出 ComicInfo.xml。
- **nhentai**：详情页增加“下载 metadata”，导出中文 ComicInfo.xml。

更新内容见 [CHANGELOG.md](CHANGELOG.md)。

## 安装

1. 浏览器安装 Tampermonkey，并在设置中将 **下载模式** 设为 **Browser API**，允许 `torrent`、`zip`、`xml` 扩展名。
2. 打开 [eh-torrent-downloader.user.js 原始文件](https://raw.githubusercontent.com/DARX1024/Personal-Scripts/main/userscripts/eh-torrent-downloader/eh-torrent-downloader.user.js)，Tampermonkey 会弹出安装页。

脚本通过 `@updateURL` 从本仓库 `main` 分支自动更新；中文词库 `metadata-dictionary.json` 通过 `@resource` 随脚本安装。

## 开发

```sh
npm install
npm test
```

测试使用 Node 内置的 `node:test` 和 jsdom，模拟页面与下载流程，不请求真实站点。

## 第三方数据

`metadata-dictionary.json` 的中文标签来自 [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)（快照提交 `0eaf24ee6ffea4a744f7d597e8471d9d365b883e`），按 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 授权使用，该文件沿用同一协议。
