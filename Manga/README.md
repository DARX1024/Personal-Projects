# 漫画自动整理入库

补齐 ComicInfo、改名归档、格式转换、判重与 Komga 同步。工具包位于仓库的 `Manga/` 目录；以下命令均在此目录运行。返回 [仓库目录](../README.md)。

## 首次运行

需要 Windows、Python 3.12+；RAR/7z 转换使用 Windows 自带的 `tar.exe`（bsdtar）。Python 代码仅依赖标准库。

1. 将 `config.example.json` 复制为 `config.json`，修改书库路径；首次配置默认关闭 Komga 同步，需要时再填写路径并启用。
2. 使用本机 Python，或设置 `MANGA_INTAKE_PYTHON` 为其可执行文件路径；也可保留自己的 `runtime/python/python.exe`。
3. 先运行 `process_download_batch.ps1 -DryRun`，核对结果后再正式整理。

```powershell
Copy-Item -LiteralPath .\config.example.json -Destination .\config.json
# 编辑 config.json 后运行：
& .\process_download_batch.ps1 -DryRun
```

`config.json`、runtime、缓存和运行记录留在本地，不进入 Git。双击入口与 PowerShell 入口共用 Python 选择：显式 `-Python`（仅 PowerShell）→ `MANGA_INTAKE_PYTHON` → 自带 runtime → 系统 `py -3` / `python`。显式指定的 Python 无效时直接报错。

## 日常功能

把新本放入 `C:\Manga\【未分类】`，双击 [整理新漫画.cmd](整理新漫画.cmd)。程序复用／补齐 ComicInfo、自动将 RAR/CBR/7z/CB7 转换为 CBZ、改名并按作者／社团归档，排入 Komga 更新任务，最后自动清理；每批最多 100 本，继续处理剩余输入。Komga 关闭时无需启动它，之后启动便会自动处理已排队任务。

```powershell
Set-Location -LiteralPath '<仓库目录>\Manga'
& .\process_download_batch.ps1                 # 整理 H 库
& .\process_download_batch.ps1 -Library E      # 整理 E 库
& .\process_download_batch.ps1 -DryRun         # 先预览
```

完整规则以 [使用说明](docs/使用说明.md) 为准；运行环境、Git 和测试说明也在该文档中。

默认库根和 Komga 设置见 `config.json`；同时只允许一批运行。完整本次结果在 `state\intake\latest.txt`，未解决问题在 `failures.csv`，修正后重跑。双击入口也支持 `--library E`、`--dry-run` 等 Python 参数。

## 可选功能

全部通过主整理入口调用，日常无需分开采集、归档和维护。

| 参数 | 用途 |
|---|---|
| `-InPlace -Root '<库内已归位子目录>'` | 保留当前位置，补 metadata 并改名；图片文件夹核验后转 CBZ |
| `-SeriesTags` | 精确匹配失败时，允许借用同作者同系列内容标签 |
| `-HashLookup` | 授权发送首／中／末页 SHA-1 到 EH 补充检索，不上传图片 |
| `-MetadataOnly` | 原位补 ComicInfo，不归档；需转换的归档生成同目录 CBZ |
| `-Library H,E` | 顺序处理两库的未分类输入 |
| `-Sources '<映射.json>' -SourcesOnly` | 修正来源，只重跑指定输入；完整 metadata 重新查询另加 `-Refresh` |
| `-Offline -DryRun` | 只用缓存预览 |
| `-PrefixedOnly` | 只选择带画廊来源前缀的输入 |
| `-NoSeriesMerge` | 关闭新系列组合及旧单篇移动，仍沿用已有系列 |
| `-KeepDuplicates` | 同作品只报告并保留输入，关闭图页核验及自动删除 |
| `-Report '<固定目录>'` | 额外导出，覆盖同一目录避免积累 |
| `-TagLanguage raw` | 使用原始标签，默认中文 |

系列组合和一致副本删除默认开启；同作品图页不同的版本自动另存，重名时添加 `[版本2]` 等后缀，保留已有版本。`-KeepDuplicates` 可关闭图页核验，继续仅报告并保留输入。自动删除只针对本次输入，保留库内副本；核验全部图页大小／CRC和前三页 SHA-256，不比较附加文件或 ComicInfo，永久删除不经回收站。

预览与正式入库共用候选、图页判重和归档规划；文件及 metadata 不变时结果一致。卷号从右往左识别，排除题名固有数字；来源前缀后允许零个、多个空格或换行。

格式转换使用 Windows 自带 bsdtar，不解包到磁盘目录；逐条核对大小、SHA-256 和 ZIP CRC，验证并提交成功后再移除原包。转换失败保留原件，中断恢复使用既有事务记录。预览只读目录及 metadata，不执行转换。PDF/EPUB 不属于本次自动转换范围。

输入子目录用 `-Root '<库根>\【未分类】\<子目录>'`；自定义书库可指定 `-LibraryRoot '<库根>'`。指定目录时只能选择一库。`-Help` 查看分区参数；agents 交接见 [AGENTS.md](AGENTS.md)。

## 自动清理与记录

正式运行结束或发生可捕获的异常时清理程序生成的已知文件；强制退出后，下次运行先恢复，再收尾。查询缓存最多保留 **30 天／2,000 文件／32 MiB**；已知遗留临时输出满 24 小时清理。预览不执行清理。

| 记录 | 保留范围 |
|---|---|
| `latest.txt` | 最近一次完整结果 |
| `failures.csv` | 未解决项，跨书库／选择性重跑保留；离线书库不会被误判为解决 |
| `deleted_duplicates.csv` | 删除依据 30 天，最多 1,000 条 |
| `last_error.txt` | 最近异常，成功且恢复完成后清除 |
| `pending_*.json`（含扫描任务）、`service_pause.json` | 恢复完成后删除，不按时间清理 |
| `run.lock` | 可复用运行锁，进程退出后释放 |

阅读器排队失败时保留恢复任务；再次正式运行同一书库会重试，成功后清除对应失败项。旧版残留记录也会重新排入一次普通扫描再清除。

不积累永久成功日志、整库快照和长期备份。漫画、词库、配置和未完成恢复材料不属于清理对象。

旧 PDF 解包、在线词库更新及重复入口已退役，本地词库继续使用。命名、来源、系列和阅读器规则见 [使用说明](docs/使用说明.md)。

## metadata 获取与原位整理

已有完整 ComicInfo 优先，保留人工字段。torrent／文件名前缀直接定位；缺少直接来源或来源确认不存在时，自动按名称查询 EH，再查询 nhentai 官方 API v2。超时、限流和无结果分别处理；作者、卷号或来源有歧义时保留原件。

```powershell
& .\process_download_batch.ps1 -Root 'C:\Manga\作者目录' -InPlace -DryRun
# 核对预览后，移除 -DryRun 执行；按需加 -SeriesTags。
```

同系列参考只补内容标签，不写成本卷 Web／外部题名。跨语言内容标签可以参考，语言采用本地版本，页数采用实际图页。`-InPlace` 保留位置并允许改名打包；`-MetadataOnly` 保留原文件名。可选环境变量 `NHENTAI_API_KEY` 提高 NH 请求限额，密钥不写入代码、配置或报告；未配置时使用匿名限额。NH 缓存在查询缓存下的 `nhentai` 子目录，按既有时限与容量规则收尾。

## 第三方数据与许可

中文标签词库 `data/translations/db.text.json` 来自 [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)，附带原 [CC BY-NC-SA 3.0 中国大陆许可](data/translations/LICENSE.md)。固定来源提交和文件 SHA-256 见 [SOURCE.json](data/translations/SOURCE.json)；该数据许可独立于项目代码。词库保留在仓库中，以支持默认中文标签和离线运行。

本仓库暂未指定统一的代码许可证；第三方数据继续适用各自附带的许可。
