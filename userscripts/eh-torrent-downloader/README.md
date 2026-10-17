# EH / EX 种子择优下载

Tampermonkey 用户脚本：

- **E-Hentai / ExHentai**：点击种子入口自动选择当前版本中下载量最高的种子；橙色箭头下载 Original 原档 ZIP（申请前确认 GP / Credits 费用）；搜索页批量下载种子；按画廊、种子和题名别名提醒重复下载；导出 ComicInfo.xml。
- **nhentai**：详情页增加“下载 metadata”，导出中文 ComicInfo.xml。

## 安装

1. 浏览器安装 Tampermonkey，并在设置中将 **下载模式** 设为 **Browser API**，允许 `torrent`、`zip`、`xml` 扩展名。
2. 打开 [eh-torrent-downloader.user.js 原始文件](https://raw.githubusercontent.com/DARX1024/Personal-Scripts/main/userscripts/eh-torrent-downloader/eh-torrent-downloader.user.js)，Tampermonkey 会弹出安装页。

脚本通过 `@updateURL` 从本仓库 `main` 分支自动更新；中文词库 `metadata-dictionary.json` 通过 `@resource` 随脚本安装。

## 下载等待与原档文件名（v1.9.3）

- 原档 ZIP 优先使用网站的日文题名（`#gj`），缺少时使用英文题名（`#gn`）；保留 `[EH/EX_画廊ID_token]` 来源前缀和文件名安全处理。种子继续使用选中种子的名称。
- 详情页直接复用已有题名和原档入口，减少一次网络请求；列表页补齐题名，即使关闭下载历史也采用相同命名规则。详情读取失败时沿用列表题名。
- 单次点击下载种子时，并行读取详情题名与种子列表；历史核对仍在读取种子文件之前完成。批量下载保持原来的请求节奏。
- 任务状态、历史写入和锁释放合并同步，保留跨标签页互斥。离线无竞争模拟中，保存前的跨标签页接口调用从种子 28 次、已有 ZIP 的原档 35 次，分别降为 18 次。
- 已有 ZIP 链接时立即显示确认窗口，文件大小在后台补充；查询超时设为 3 秒、不重试，确认或取消后中止查询。新申请仍先展示并确认网站费用；网站准备归档时仍按原间隔检查进度。
- 历史去重继续使用两种题名，原档费用确认和下载方式保持原有行为。

## 页面加载（v1.9.2）

- 搜索操作、原档和 metadata 按钮随对应页面区域出现，不再等待 `DOMContentLoaded`；详情页自动下载仍等待完整题名，保留去重判断。
- 动态列表更新按区域合并处理，同一画廊的封面与标题链接只处理一次，避免新按钮反复触发扫描。
- 1.8.8 与 1.9.1 都存在等待页面解析完成的行为。EH / EX 共用初始化逻辑；本地慢页面模拟验证了等待已消除，但不能据此判断真实站点、网络或脚本管理器的耗时。

## 开发

```sh
npm install
npm test
```

测试用 Node 内置 `node:test` 和 jsdom，覆盖解析、择优、文件名、限流识别和 metadata 导出，以及页面分段加载、动态列表、缓存恢复与自动下载时机。下载流程模拟验证双语命名、慢大小查询、取消和付费确认、并行读取、跨标签页去重与历史一致性，不请求真实站点。

## 第三方数据

`metadata-dictionary.json` 的中文标签来自 [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)（快照提交 `0eaf24ee6ffea4a744f7d597e8471d9d365b883e`），按 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 授权使用，该文件沿用同一协议。
