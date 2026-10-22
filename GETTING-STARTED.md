# Getting started · 开始使用

[English](#english) · [简体中文](#简体中文)

## English

### Web: open and try it

[Open the bilingual website](https://words-actually-dance-lab.aivnailedeng.chatgpt.site/). Switch between English and Chinese in the upper-right corner. Use a built-in demo rhythm or explicitly choose shared audio; imported text is read only on your current device. The website has no music-file upload and does not include the former collaboration library. You can copy its authoring prompt into an AI tool of your choice. Changing the interface language does not automatically translate your own material.

### Windows: no coding required

Download the portable package from this repository's Releases and check the SHA-256 supplied with that release. Extract the entire folder and double-click its launcher; do not move only the executable. The first launch asks you to choose the playback display explicitly. It asks again if the saved display is disconnected. The app currently has neither a signature nor an installer; the release page states this status.

Start with **Try it** to see the keyword and explanation. **Your text** at the top lets you choose the three learning-method examples, other built-in topics, or your own TXT file. Space plays or pauses; the left and right arrow keys revisit the previous line or move to the next. These shortcuts do not interrupt typing in an input field.

Open **Settings** to adjust characters per beat, motion strength and ghost text. If reading becomes difficult, slow the text, reduce the motion or turn off ghosts. Knowledge-text effects switch automatically between sentences by default; you can also keep one fixed effect.

**Recall** first pauses playback and hides the explanation. Explain the idea in your own words, then use **Show answer** to check it; revealing the answer does not resume playback automatically. The app does not score you or schedule reviews. You arrange your own reviews across days. This provides a way to practise active recall, not evidence that its music or animation improves learning. See the [research and usage limits](docs/learning-science.md).

### Your own text

Put one passage on each TXT line. The format is `keyword, related word｜explanation`, for example:

```text
Recall, check｜Recall first; then check what you missed.
Spacing, review｜Spacing: wait, then review by explaining again.
```

You can also copy the app's prompt and use it with your materials in an external AI tool to produce standard JSON, then import the result. Check facts, sources and permissions yourself; the app has no integrated online model. Save the prepared text locally to use it again.

### Music

Built-in demo rhythms are synthesised live by code, without samples from external recordings. Local songs are analysed only on your device. Windows system audio requires your explicit selection and reads the default output at the time the connection is established. Reconnect after changing the output device or the music application's output routing.

Web shared audio requires the browser to offer an audio-sharing option and you to confirm it. The browser may request screen-sharing permission as part of that session, but the app does not display, save or upload the screen image. If shared audio is unavailable, use a built-in demo, or use a local music file in the Windows app; the public website does not import music files. Do not assume this supports background audio on phones or system capture in every browser.

### Run from source

Install Node.js 22.13+ and pnpm 11.25, then run `pnpm install --frozen-lockfile`.

- `pnpm preview`: local browser preview; open the address printed in the terminal.
- `pnpm start`: Windows Electron app.
- `pnpm test`, `pnpm check`, `pnpm format:check`: behaviour, syntax and formatting checks.
- `pnpm package:win`: build the Windows portable package, retaining Electron's licence notices.

Test mode retains the original development environment's ASUS display guard and will not silently launch on another display. On another machine, a person must explicitly select that machine's `WAD_DISPLAY_ID` before native QA. A normal public release uses a display-selection dialog and does not require an ASUS display.

## 简体中文

### 网页：直接打开

[进入中英文网站](https://words-actually-dance-lab.aivnailedeng.chatgpt.site/)。右上角切换中文／English，使用内置试听或主动选择共享声音，导入文案只在当前设备读取。网站不提供音乐文件上传，没有原来的协作云库；提示词可复制给自己选择的AI工具。自己的材料不随界面语言自动翻译。

### Windows：不用写代码

从本仓库Releases下载便携版，核对同次发布的SHA-256。解压整个文件夹，双击其中的启动文件，不要只移动exe。首次运行会让你明确选择播放屏幕；记住的屏幕断开后会再次询问。程序目前没有签名或安装器，发布页会明确说明此状态。

先点「开始试听」，观察关键词与讲解。上方「知识文案」里可以选三份学习方法示例及其他内置知识，或放入自己的TXT。空格播放／暂停，左右方向键回看或下一句；在输入框打字时不会抢这些快捷键。

点击「表现」可以调整每拍字数、动作幅度和虚影。读不进去时降低文字速度、动作强度，或关掉虚影。知识效果默认按句自动切换，也可以固定一个。

「回想一下」先暂停并遮住知识讲解。用自己的话说说刚才的意思，再点「看答案」核对；揭示答案不会自动继续播放。不会打分，也没有复习日程；跨日复习需要你自行安排。它提供主动回想的入口，不代表音乐或动画的学习收益已经验证。见[研究与使用边界](docs/learning-science.md)。

### 自己的文案

TXT每行一段，可写 `关键词、关联词｜讲解`。例如：

```text
回想、核对｜先不看原文说一遍，再核对遗漏。
间隔、复习｜隔一段时间回来，再试着解释一次。
```

也可以复制程序提供的提示词，配合自己的材料在外部AI工具中生成标准JSON，再导入。自行核对事实、来源和授权；应用没有集成在线模型。文案可以保存到本地继续使用。

### 音乐

内置试听由代码现场合成，没有外部录音采样。本地歌曲只在设备上分析。Windows系统声音需你主动选择，读取连接建立时的默认输出；切换输出设备或音乐软件路由后重新连接。

网页共享声音需要浏览器提供共享音频选项并由你确认，可能同时请求共享画面权限，但应用不显示、保存或上传画面。没有共享音频时可用内置试听，或在Windows程序选择本地音乐；公开网页不导入音乐文件。不要据此假定手机后台或所有浏览器都支持系统采集。

### 源码运行

安装Node.js 22.13+、pnpm 11.25，执行 `pnpm install --frozen-lockfile`。

- `pnpm preview`：浏览器本地预览，按终端输出地址访问。
- `pnpm start`：Windows Electron程序。
- `pnpm test`、`pnpm check`、`pnpm format:check`：有效行为、语法和格式检查。
- `pnpm package:win`：Windows便携打包，保留Electron许可通知。

测试模式默认保留原开发环境的ASUS保护，不会静默启动另一块屏幕；其他机器要由人明确指定自己的 `WAD_DISPLAY_ID` 再做原生QA。普通公开版启动通过选屏幕对话框，不需要ASUS。
