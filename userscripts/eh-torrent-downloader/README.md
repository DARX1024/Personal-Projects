# EH / EX 种子择优下载

Tampermonkey 用户脚本：

- **E-Hentai / ExHentai**：点击种子入口自动选择当前版本中下载量最高的种子；橙色箭头下载 Original 原档 ZIP（申请前确认 GP / Credits 费用）；搜索页批量下载种子；按画廊、种子和题名别名提醒重复下载；导出 ComicInfo.xml。
- **nhentai**：详情页增加“下载 metadata”，导出中文 ComicInfo.xml。

## 安装

1. 浏览器安装 Tampermonkey，并在设置中将 **下载模式** 设为 **Browser API**，允许 `torrent`、`zip`、`xml` 扩展名。
2. 打开 [eh-torrent-downloader.user.js 原始文件](https://raw.githubusercontent.com/DARX1024/Personal-Scripts/main/userscripts/eh-torrent-downloader/eh-torrent-downloader.user.js)，Tampermonkey 会弹出安装页。

脚本通过 `@updateURL` 从本仓库 `main` 分支自动更新；中文词库 `metadata-dictionary.json` 通过 `@resource` 随脚本安装。

## 页面加载（v1.9.2）

- 搜索操作、原档和 metadata 按钮随对应页面区域出现，不再等待 `DOMContentLoaded`；详情页自动下载仍等待完整题名，保留去重判断。
- 动态列表更新按区域合并处理，同一画廊的封面与标题链接只处理一次，避免新按钮反复触发扫描。
- 1.8.8 与 1.9.1 都存在等待页面解析完成的行为。EH / EX 共用初始化逻辑；本地慢页面模拟验证了等待已消除，但不能据此判断真实站点、网络或脚本管理器的耗时。

## 开发

```sh
npm install
npm test
```

测试用 Node 内置 `node:test` 和 jsdom，覆盖解析、择优、文件名、限流识别和 metadata 导出，以及页面分段加载、动态列表、缓存恢复与自动下载时机。启动测试不请求真实站点。

## 第三方数据

`metadata-dictionary.json` 的中文标签来自 [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)（快照提交 `0eaf24ee6ffea4a744f7d597e8471d9d365b883e`），按 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 授权使用，该文件沿用同一协议。
