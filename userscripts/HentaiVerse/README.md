# HentaiVerse

在一个目录中维护四个独立安装的 Tampermonkey 用户脚本。适用于 HentaiVerse 主世界及异世界；界面脚本另包含论坛装备预览与相关术语汉化。

| 安装文件 | 用途 |
| --- | --- |
| [HV-Interface.user.js](HV-Interface.user.js) | 游戏汉化、装备百分比和满锻预览 |
| [AADB.user.js](AADB.user.js) | 战斗规则、日常流程、记录及收益统计 |
| [HV-PonySolver.user.js](HV-PonySolver.user.js) | 小马验证码识别服务客户端 |
| [HV-Utils.user.js](HV-Utils.user.js) | 装备、商店、邮件、神殿和怪物管理 |

## 安装与迁移

使用 Tampermonkey 打开下面的原始文件地址：

- [安装 HV 界面增强](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/HentaiVerse/HV-Interface.user.js)
- [安装 AADB](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/HentaiVerse/AADB.user.js)
- [安装 HV-PonySolver](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/HentaiVerse/HV-PonySolver.user.js)
- [安装 HV Utils 汉化](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/HentaiVerse/HV-Utils.user.js)

从旧脚本迁移时：

1. 先在脚本管理器导出原脚本及设置。AADB 的配置、PonySolver 的 API 地址、HV Utils 设置均有独立存储。
2. 安装 **HV 界面增强**，停用原来的 **HV 汉化** 和 **Percentage Ranges**。保留 **HV Utils 汉化**。
3. AADB、PonySolver 和 HV Utils 保留原来的脚本名称及命名空间。为确保保留管理器存储，可在原脚本编辑器中用对应新文件的完整内容替换并保存；不要先删除原脚本。
4. 刷新页面。左下角“HV 界面”中设置汉化、日志汉化与装备显示模式；AADB 沿用原配置入口；PonySolver 在管理器菜单中设置服务地址及延迟。

界面脚本沿用当前站点 `localStorage` 中的旧汉化开关。新脚本身份无法直接读取旧 Percentage Ranges 的 GM 存储，百分比默认开启，可以在“HV 界面”中重新设置。不同域名的站点存储相互独立。

AADB 和 jpx 都会控制战斗动作，同一战斗页面只启用其中一套。原始脚本备份和新版本不要同时启用。

PonySolver 需要可用的识别后端，本项目不包含服务端或模型。默认地址沿用原版的远程 HTTP 服务，并非本机服务；可在菜单修改。允许连接的主机由脚本头部 `@connect` 指定，使用其他服务时须同步调整权限。识别失败不会随机提交，可用菜单“重新检查并处理当前验证码”重试。

## 开发与测试

需要 Node.js 22+。在本目录执行：

```sh
npm install
npx playwright install chromium
npm run build
npm test
npm run check
```

若使用已安装的 Chrome，可跳过下载 Chromium，并在 PowerShell 中运行：

```powershell
$env:HV_BROWSER_CHANNEL = 'chrome'
npm test
```

修改 `src/` 后运行构建，提交源码与生成的 `.user.js`。`HV-Utils.user.js` 保持独立，直接维护。三个生成脚本的版本由 `build.mjs` 和各自的元数据文件共同维护；更新时同时提升版本并记录到 [CHANGELOG.md](CHANGELOG.md)。

测试使用隔离页面、模拟网络与临时浏览器上下文，不连接游戏服务器或识别服务，不消耗游戏资源。测试覆盖装备计算与汉化顺序、动态内容、配置表单、条件规则、请求失败和验证码任务取消；不等同于所有实际游戏场景已验证。

源码结构见 [ARCHITECTURE.md](ARCHITECTURE.md)，第三方来源见 [SOURCES.md](SOURCES.md)。本目录不包含个人配置、Cookie、账户记录或脚本管理器存储备份。
