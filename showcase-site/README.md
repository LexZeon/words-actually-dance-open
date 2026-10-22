# Words Actually Dance — Film room / 影像展厅

[English](#english) · [简体中文](#简体中文)

## English

A separate, static video gallery for actual Words Actually Dance recordings. It does not embed or link to the music-reactive application Site. There is no music analysis, file upload, account, cloud library or first-party analytics. Selecting one of the four songs automatically requests its visible, unmodified Bilibili official player; this contacts Bilibili and follows its playback and privacy rules.

### Build and preview

From the project root:

```sh
node showcase-site/build.mjs
python -m http.server 4321 --directory showcase-site/dist
```

Open `http://localhost:4321/`. The build needs only Node.js and existing, reviewed public media. It reads `public-docs/media` in the private development project, or `media` in the public project. An explicit `--media-root` may select either of those two project directories. It never reads private song recordings.

The resulting `dist` is a self-contained, buildless website: HTML, CSS, one JavaScript module, and local media. The builder accepts only its own marked output, refuses unknown or modified files, hashes every copied file, and verifies actual MP4 track metadata: four song previews have **zero audio tracks**; four original-music videos have one audio track. It does not perform a fresh full media decode. `dist` is generated and ignored by Git.

The gallery has a separate hosting address, `https://words-actually-dance-showcase.aivnailedeng.chatgpt.site/`. This build does not publish it; the owner verifies the deployed revision separately. This source does not contain hosting credentials or manage a Site identity.

### Direct links and playback

Use `?clip=<id>&lang=en` or `?clip=<id>&lang=zh`:

| Clip ID         | Recording                                     | Duration  | Audio          |
| --------------- | --------------------------------------------- | --------- | -------------- |
| `die-for-you`   | The Weeknd — Die For You reference            | 12s       | Silent         |
| `qian-si-xi`    | 牵丝戏 / Qian Si Xi reference                 | 34s       | Silent         |
| `mc-mong-remix` | 죽을 만큼 아파서 adaptation/remix reference   | 61s       | Silent         |
| `friends-wine`  | 朋友的酒 / HALO DJ reference                  | About 57s | Silent         |
| `overview`      | Let knowledge follow the rhythm               | 10s       | Original music |
| `ghosts`        | One word, two moments                         | 10s       | Original music |
| `learning`      | Read, then recall                             | 12s       | Original music |
| `full`          | Three complete clips, joined with simple cuts | 32s       | Original music |

`full` is the default. Valid URL language wins over the locally remembered preference. Invalid clip IDs fall back to `full`; unsupported languages fall back to the saved preference or browser language. Switching language changes gallery text, not the recorded video's interface or contents.

Opening a clip or selecting another one attempts playback with sound by default: songs use the official source player beside the silent local app recording, and original clips use their own audio. If the browser blocks it, visible playback buttons remain. Reduced-motion preference suppresses automatic playback. Native playback controls remain available. Each video has a same-origin Download preview video link. The four downloaded song-driven app recordings have **no source-song audio**; this does not mean the website cannot play the corresponding song.

For a song, the default request and **Play song + demo** reset the local app recording to zero and requests playback in a visible Bilibili official player at source seconds **90 / 79 / 124 / 0** respectively. The request uses the [documented official player](https://player.bilibili.com/) with `bvid`, `t`, `autoplay=1`, `muted=0` and `danmaku=0`. Platform branding, source video and native controls remain visible. There is no audio extraction, source download, hidden player, cropping, or undocumented player-control messaging. **Stop source song** removes the iframe. Changing the selected clip, language or history entry, or leaving the page, removes the old source player as well. A separate Open source song link remains available.

The source player may require another Play click or a platform-specific action before audible playback. Its state is cross-origin and is not claimed to be observable. **Restart together** now preloads the local recording at zero, opens the official iframe at the source offset, and waits for its **page load event** before starting the demo. It no longer starts the demo before creating Bilibili’s player. Page loading does not confirm audio readiness: the song can still buffer or require Play. **Song audible? Start demo now** provides a manual start while waiting. After 15 seconds without a page-load event, automatic startup is cancelled, with an explicit retry/manual-start message; a late load cannot unexpectedly start the demo.

Ending, pausing or seeking the local demo removes the source iframe so the song cannot keep running beyond the local segment. Stop, restart, clip/language/history changes and leaving the page cancel old waiting callbacks as well. To resume the pair, use Restart together; playing only the local video does not resume a stopped source song. Two separate players are **not guaranteed to remain strictly synchronized**; the page-load gate avoids a known early start but does not establish acoustic alignment or ongoing correction. No undocumented control messages or cross-origin media inspection are used by the gallery.

The four original-music videos attempt their own audio by default. A browser NotAllowedError triggers one muted-play fallback and an explicit **Play with sound** retry. Programmatic fallback does not change the sound intent. A real user mute choice is retained for later original clips on the same page, including native-control changes, and a fresh page visit returns to the default sound request. Language changes pause the local recording; the user chooses when to continue.

### Sources and limits

Titles, durations, segment ranges, original-performer and uploader credits are drawn from the project's [public README](https://github.com/LexZeon/words-actually-dance-open/blob/main/README.md#english) and [Music credits](https://github.com/LexZeon/words-actually-dance-open/blob/main/MUSIC-CREDITS.md#english). Original performers and selected-version creators remain separate roles. Further version credits and permissions can remain unverified; the full credits retain those limits.

The four **local MP4 files** show only the project's own app interface and original example text, without source-song sound, Bilibili imagery or lyrics. The separate official embed shows the source video through Bilibili. Referenced recordings have not been licensed for re-upload, extraction or distribution as project soundtracks. Attribution is not permission to copy, synchronise or distribute a song, and an official embedding option does not establish the complete rights chain. The four local videos with audio use this project's procedural original music. These are software demonstrations, not verified beat-accuracy or learning-benefit experiments.

Copyright contacts: **aivnailedeng@gmail.com** and **lexzeonstudio@gmail.com**. Source artists, writers and uploaders remain separately credited; contact us about a rights or credit concern.

No new fonts, templates, stock footage or third-party music are bundled. First-party source and original media follow the project's [MIT licence](https://github.com/LexZeon/words-actually-dance-open/blob/main/LICENSE); [third-party notices](https://github.com/LexZeon/words-actually-dance-open/blob/main/THIRD-PARTY-NOTICES.md#english) remain separate. Publishing this gallery does not grant rights to the linked songs.

---

## 简体中文

这是独立的 Words Actually Dance 真实录屏静态展厅，不嵌入、不链接音乐联动应用的 Site。没有音乐分析、文件上传、账号、云库或第一方统计服务。选择四首歌曲之一时，会自动请求可见、未改动的 Bilibili 官方播放器；这会连接 Bilibili，适用其播放与隐私规则。

### 构建与预览

在项目根目录运行：

```sh
node showcase-site/build.mjs
python -m http.server 4321 --directory showcase-site/dist
```

打开 `http://localhost:4321/`。构建只需要 Node.js 和已经审核的公开媒体：私有开发项目读取 `public-docs/media`，公开项目读取 `media`；`--media-root` 可明确选择这两个项目目录之一，不读取私人歌曲录屏。

生成的 `dist` 是无需在线构建的完整静态网站，包含 HTML、CSS、一个 JavaScript 模块和本地媒体。构建器只接受自己带所有权标记的输出目录，遇到未知文件或已修改的文件会拒绝覆盖，逐个核对复制哈希，并检查实际 MP4 轨道：四首歌曲预览**没有音轨**，四段原创配乐视频各有一条音轨；不在此重新完整解码媒体。`dist` 是生成目录，由 Git 忽略。

独立展厅地址为 `https://words-actually-dance-showcase.aivnailedeng.chatgpt.site/`。此构建不执行发布，已部署版本由所有者另行核验。这里的源码不含托管凭据，也不管理 Site 身份。

### 直达链接与播放

使用 `?clip=<id>&lang=en` 或 `?clip=<id>&lang=zh`：

| 视频 ID         | 录屏内容                                 | 时长   | 声音     |
| --------------- | ---------------------------------------- | ------ | -------- |
| `die-for-you`   | The Weeknd《Die For You》联动参考        | 12秒   | 无声     |
| `qian-si-xi`    | 《牵丝戏》联动参考                       | 34秒   | 无声     |
| `mc-mong-remix` | 《죽을 만큼 아파서》改编／remix 联动参考 | 61秒   | 无声     |
| `friends-wine`  | 《朋友的酒》HALO DJ 联动参考             | 约57秒 | 无声     |
| `overview`      | 让知识跟上节奏                           | 10秒   | 原创配乐 |
| `ghosts`        | 一字，两道时间                           | 10秒   | 原创配乐 |
| `learning`      | 读过之后，回想一下                       | 12秒   | 原创配乐 |
| `full`          | 三段完整录屏，以简单切镜合并             | 32秒   | 原创配乐 |

默认选择 `full`。URL 中有效语言优先于本地保存的偏好；未知视频 ID 回退到 `full`，不支持的语言回退到已保存偏好或浏览器语言。切换语言只改变展厅文字，不改变录屏中的界面与内容。

点开或切换视频，默认尝试带声音播放：歌曲使用官方源播放器配合本地无声程序录屏，原创片段使用自身音轨；浏览器阻止时保留显眼的播放按钮。用户启用减少动态效果偏好时，不自动播放。视频保留原生播放控件，各有同源「下载预览视频」。四首歌曲对应的下载文件**没有原曲音轨**，不表示网站不能播放对应歌曲。

歌曲页面默认请求和「**播放原曲与演示**」都会把本地程序录屏重置为零，并请求可见的 Bilibili 官方播放器分别从源歌曲 **90／79／124／0 秒**开始播放。使用[官方公开文档](https://player.bilibili.com/)中的 `bvid`、`t`、`autoplay=1`、`muted=0` 和 `danmaku=0` 参数；保留平台标识、源视频和原生控件，不提取音频、不下载源视频、不隐藏或裁切播放器、不使用未公开的播放器控制消息。「**停止原曲**」会移除 iframe；切片、切语言、历史导航和离开页面也会移除旧源播放器，并保留「打开源歌曲」原链接。

源播放器可能需要额外点击播放或完成平台要求的操作才能开声。它属于跨源页面，本展厅不声称能读取其播放状态。「**重新同步**」现在先把本地录屏预载并停在零，打开对应起点的官方 iframe，等其**页面 load 事件**后再启动演示，不再先播演示再创建 Bilibili 播放器。页面加载不等于音频就绪：原曲仍可能缓冲或需点击播放。等待时可按「**音乐已响，开始演示**」手动启动；15秒未收到页面加载事件会取消自动启动，并显示重试／手动开始提示，迟到的 load 不会突然开播。

本地演示结束、暂停或拖动进度时，会移除源 iframe，避免歌曲继续超出演示片段。停止、重启、切片／切语言／历史导航和离页也会取消旧等待回调。继续配对请按「重新同步」；仅播放本地视频不会恢复已停止的源歌曲。两个独立播放器**不保证严格同步**；页面加载门槛消除了已知抢跑，不代表已实现声学对齐或持续校正。展厅不使用未公开控制消息或跨源媒体检查。

四段原创配乐视频默认尝试自身音轨。有声播放收到浏览器 NotAllowedError 后，只尝试一次静音回退，并明确提供「**播放并开声**」重试；程序回退不改变开声意图。用户主动静音后，本页后续原创片段会保留该选择，原生控件的改动也会同步；重新打开页面恢复默认开声请求。切换语言会暂停本地录屏，由用户决定何时继续。

### 来源与边界

标题、时长、参考片段、原演唱者及上传者署名来自项目[公开 README](https://github.com/LexZeon/words-actually-dance-open/blob/main/README.md#简体中文)与[音乐署名](https://github.com/LexZeon/words-actually-dance-open/blob/main/MUSIC-CREDITS.md#简体中文)。原演唱者与所选版本创作者保持分开；进一步版本署名与授权仍可能未核实，完整署名保留这些边界。

四个**本地 MP4 文件**只含自有程序界面和原创示例文案，不含源歌曲声音、哔哩哔哩画面或歌词；独立的官方嵌入播放器通过 Bilibili 展示源视频。参考录音未获重新上传、提取或作为本项目配乐分发的授权；署名不构成复制、同步配乐或分发许可，平台提供嵌入入口也不代表完整权利链已核实。四段本地有声视频采用本项目代码生成的原创配乐；这些是软件演示，不是已验证拍点准确率或学习收益的实验。

版权联系：**aivnailedeng@gmail.com**、**lexzeonstudio@gmail.com**。原作者、词曲作者与上传者分别署名；如有权利或署名问题，可通过这些地址联系。

没有新增字体、模板、素材视频或第三方歌曲。自有源码与原创媒体遵循项目 [MIT 许可](https://github.com/LexZeon/words-actually-dance-open/blob/main/LICENSE)，[第三方说明](https://github.com/LexZeon/words-actually-dance-open/blob/main/THIRD-PARTY-NOTICES.md#简体中文)独立保留；发布展厅不授予所链接歌曲的权利。
