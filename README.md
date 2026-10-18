# Personal-Projects

个人兴趣项目与日常小脚本合集。

## 目录

| 路径 | 说明 |
| --- | --- |
| [`Manga`](Manga/README.md) | 漫画自动整理入库：补 ComicInfo、改名归档、格式转换、判重与 Komga 同步 |
| [`userscripts/eh-torrent-downloader`](userscripts/eh-torrent-downloader) | EH / EX 种子择优下载、原档下载、批量与去重；nhentai 导出中文 ComicInfo.xml |
| [`userscripts/universal-math-latex-copier`](userscripts/universal-math-latex-copier) | 双击网页公式复制 LaTeX，支持 KaTeX、MathJax、MathML 等 |

各项目的安装、运行和测试方法见对应目录的 README。

漫画工具入口为 `Manga/整理新漫画.cmd` 和 `Manga/process_download_batch.ps1`，首次使用见 [Manga 说明](Manga/README.md#首次运行)。本机配置、runtime、缓存和运行记录存放在 `Manga/` 内，由 Git 忽略。

不要提交 API key、Cookie、本地配置或运行记录。第三方数据保留各自的来源及许可；本仓库暂未指定统一的代码许可证。
