# 工具包维护与交接

漫画整理程序位于仓库的 `Manga/` 目录；新本输入为本机 `config.json` 所配置书库下的 `【未分类】`。浏览器脚本位于仓库的 `userscripts/`，保留各项目的独立说明与测试。

## 入口与文档分工

- 日常运行：双击 `整理新漫画.cmd`，或在工具包目录运行 `& .\process_download_batch.ps1`；E 库加 `-Library E`，预览加 `-DryRun`。
- [README.md](README.md) 提供快速入口与常用参数；[使用说明](docs/使用说明.md) 是行为、参数、metadata、命名归档、图集和恢复规则的完整说明。修改行为时更新对应章节；README 只同步入口与常用操作变化。
- 浏览器脚本及安装说明在 [下载说明](../userscripts/eh-torrent-downloader/README.md)。本文件保留维护约束和模块边界，不重复完整使用规则。

## 维护约束

- 保留配置、人工 ComicInfo 字段、作者别名、本地词库及许可、Python runtime 和未完成恢复状态。禁止整库原位扫描；只处理显式选择的库内输入。
- ComicInfo 新增内容仅限基本 metadata。检索过程、哈希证据、置信度、修复和归档历史留在库外，不写入 Notes 或自定义审计字段；已有简介、手工备注和未知字段保留。
- 普通漫画沿用来源匹配流程；已确认订阅图集按本地题名、作者、实际页数、语言和可确认日期维护，Tags／Web 有意留空不触发补齐。平台名称提示与明确图集标识的区别见使用说明。
- 保留 Komga 身份、阅读进度、书单和既有单篇／系列布局。关闭时只持久排队，不主动启动；扫描使用普通扫描，不做深度重建。
- 删除只针对经图页核验一致的本次输入；保留库内副本。转换或图片目录打包须完成全载荷核验和事务提交后才移除原件。预览与正式运行共用规划，预览不提交或清理。
- `state/intake/pending_*.json`（含扫描任务）及 `service_pause.json` 是恢复材料，不按年龄清理。同步失败只能在所属书库成功排队后清除；不能仅凭 recovery 路径消失判断成功。
- 不恢复已退役的 PDF 解包、在线词库更新、旧 Python 转发、独立采集／多库维护入口或旧数据库工具链。

## 模块边界

`daily_intake.py` 负责输入、路径规划和事务执行；`intake_enrichment.Resolver.resolve(book, rules)` 返回 metadata、匹配范围和参考来源；`nhentai_api.py` 只请求官方 API 并维护缓存，EH 复用现有 client/searcher。数据源及匹配模块不得调用日常主入口或修改漫画／阅读器。

`intake_inputs.py` 负责图片目录读取、流式打包和字节核验；`intake_archives.py` 负责归档转换；`intake_reader.py` 负责 Komga 身份与任务队列；`intake_housekeeping.py` 负责有界记录及程序自有文件清理。保留单一日常入口。

## 验证与版本控制

完整回归：用 `runtime.ps1` 的 `Get-MangaPython` 选择 Python 后，运行 `-B -m unittest discover -s tests -v`；完整命令见使用说明。测试使用临时书库及 SQLite 数据库；默认系统临时目录，可用 `MANGA_INTAKE_TEST_ROOT` 指定独立位置。修改同步／恢复逻辑时覆盖失败、重跑、中断、预览和跨书库隔离。

Git 跟踪源码、测试、示例配置、文档和规则／词库，忽略本机配置、runtime、cache、state、字节码及旧测试临时目录。提交前检查不含本机个人路径或凭据。恢复源码不能回滚真实书库、Komga 或运行状态；不要删除未完成 journal 来配合代码回退。运行环境与迁移说明见使用说明。
