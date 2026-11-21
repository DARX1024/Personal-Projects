# YouTube 听课留言板

把 YouTube 观看页右侧的推荐视频换成一个只有你自己的「直播间」：听课时随手发疑问、想法或标记重点，每条留言自动记下视频时间戳和当时屏幕上的字幕。课程结束后一键复制成 Markdown，交给 Agent 总结、答疑或整理笔记。

## 使用

- **时间戳记在开始输入的那一刻**，而不是按回车的时刻：打字的这十几秒里老师已经讲到后面去了。输入框上方的 `⏱` 显示这条留言会记在哪个时间；点它可以改成当前时间。
- **快捷按钮**：「？没懂」和「⭐ 重点」不用打字，直接在当前时间记一条。以 `?` / `？` 开头或结尾的留言自动归为「疑问」。
- **字幕上下文**：打开 YouTube 字幕（自动字幕也可以）时，每条留言会附上该时刻前 20 秒到后 5 秒的字幕，Agent 据此还原老师讲到了什么。没开字幕时只记录时间戳。
- **快捷键**：在页面任意位置按 `` ` ``（反引号）聚焦输入框；`Enter` 发送，`Shift+Enter` 换行，`Esc` 把焦点交还播放器。输入时 YouTube 的 `k` / `j` / `f` 等快捷键不会被触发，中文输入法组字时按回车也不会误发送。
- 点击时间戳跳到对应位置，悬停留言可删除。留言按视频时间排序，回看时补的留言会插到对应位置。
- 「推荐」按钮可以随时把推荐视频放回来，选择会被记住。
- **拉灯开关**：面板右上角挂着一根台灯拉绳，点一下或用鼠标往下拉，切换留言板自己的深色 / 浅色，YouTube 页面不受影响（拉得不够长不会切换）。没拉过时留言板跟随 YouTube 主题，拉过之后记住你的选择。
- 每个视频的留言分开保存在 Tampermonkey 存储里，刷新或隔天再看仍然在。

导出格式示例：

```markdown
# 听课留言：解剖小龍蝦 — 以 OpenClaw 為例介紹 AI Agent 的運作原理

- 视频：https://www.youtube.com/watch?v=xxxx
- 频道：Hung-yi Lee
- 导出：2026/11/21 21:30:00，共 2 条

## 留言

- [23:32](https://www.youtube.com/watch?v=xxxx&t=1412s) **疑问** 没听懂
  - 字幕：今天讲 context window / 語言模型的 context window
- [25:30](https://www.youtube.com/watch?v=xxxx&t=1530s) **想法** 能不能把 context 压缩做成可学习的模块？
```

## AI 助教接口

脚本里预留了 `teacher` 对象（默认关闭）。实现 `reply(note, lecture)` 并把 `enabled` 设为 `true` 后，每条「疑问」发出时都会调用它，返回的文本显示在留言下方，并随留言一起导出。`note` 包含时间戳、留言文字和字幕上下文，`lecture` 包含视频标题、链接和本课全部留言。API key 不要写进脚本，用 `GM_getValue` 读取本机保存的配置。

## 安装

1. 在桌面浏览器安装并启用 Tampermonkey。
2. 打开[脚本原始文件](https://raw.githubusercontent.com/DARX1024/Personal-Projects/main/userscripts/youtube-lecture-chat/youtube-lecture-chat.user.js)，点击「安装」。
3. 刷新已打开的 YouTube 视频页，右侧会出现「课堂留言」面板。

## 开发

测试使用 Node.js 22+ 和本机安装的 Chrome（没有 Chrome 时用 `CHROME_PATH` 指定 Chromium 可执行文件）。在本目录运行：

```sh
npm install
npm test
```
