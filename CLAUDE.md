# CLAUDE.md

这是仓库所有者（DARX1024）的个人脚本仓库，由所有者与 Claude 共同维护。

## 协作方式

- 个人项目，不走 PR / review 流程：**直接在 `main` 上开发、提交并推送**（所有者已明确授权）。
- 每完成一个独立改动就提交并推送，避免会话结束后丢失。
- 提交信息用中文或英文均可，首行简明说明改动；一次提交只做一件事。
- 用户脚本改动时同步提升 `@version` 与脚本内 `VERSION` 常量。

## 仓库结构

- 每个项目一个目录，按类型分组：`userscripts/<name>/` 等。
- 每个项目目录有自己的 `README.md`；新增项目时同步更新根目录 `README.md` 的目录表。
- 项目有测试时放在项目目录的 `test/` 下，用项目自带的 `package.json` 运行。

## 安全

- 公开仓库：绝不提交 API key、Cookie、token、账号信息、个人路径等。
- 第三方数据（如 EhTagTranslation 词库）保留来源与授权说明。

## 各项目

### userscripts/eh-torrent-downloader

- Tampermonkey 脚本，主文件 `eh-torrent-downloader.user.js`。
- 中文标签词库在 `metadata-dictionary.json`，脚本通过 `@resource` 从本仓库 `main` 分支读取；改词库路径时同步改 `@resource`。
- 测试：`cd userscripts/eh-torrent-downloader && npm install && npm test`（Node 22+，jsdom 提供 DOM）。
- 脚本在 Node 中通过 `module.exports` 导出纯函数供测试；浏览器中不导出。
