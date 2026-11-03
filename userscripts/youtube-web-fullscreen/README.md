# YouTube 网页全屏

在 YouTube 桌面版播放器中，带斜箭头的小窗按钮接替原来的「剧场模式」。点击后，播放器占满标签页，浏览器地址栏和系统任务栏仍可使用。再点一次或按 `Esc`，回到进入前的普通或剧场布局。

视频保持原比例，4:3 课程录像在宽窗口中会有左右留边。播放进度、字幕和控制栏都由原播放器管理。在普通布局下按 YouTube 原有的 `T` 键仍可进入剧场模式。

## 安装

1. 在桌面浏览器安装并启用 Tampermonkey。
2. 打开[脚本原始文件](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-web-fullscreen/youtube-web-fullscreen.user.js)，点击「安装」。
3. 刷新已打开的 YouTube 视频页，把鼠标移到播放器上，点击右下角的「网页全屏」。

## 开发

测试使用 Node.js 22+ 和本机安装的 Chrome。在本目录运行：

```sh
npm install
npm test
```
