# Words Actually Dance — Film room / 影像展厅

[English](#english) · [简体中文](#简体中文)

## English

A separate, static video gallery for actual Words Actually Dance recordings. It does not embed or link to the music-reactive application Site. There is no music analysis, file upload, account, cloud library, tracking service or external video embed.

### Build and preview

From the project root:

```sh
node showcase-site/build.mjs
python -m http.server 4321 --directory showcase-site/dist
```

Open `http://localhost:4321/`. The build needs only Node.js and existing, reviewed public media. It reads `public-docs/media` in the private development project, or `media` in the public project. An explicit `--media-root` may select either of those two project directories. It never reads private song recordings.

The resulting `dist` is a self-contained, buildless website: HTML, CSS, one JavaScript module, and local media. The builder accepts only its own marked output, refuses unknown or modified files, hashes every copied file, and verifies actual MP4 track metadata: four song previews have **zero audio tracks**; four original-music videos have one audio track. It does not perform a fresh full media decode. `dist` is generated and ignored by Git.

The owner has reserved a separate hosting address, `https://words-actually-dance-showcase.aivnailedeng.chatgpt.site/`. Creation of an address is not confirmation of publication; the owner verifies and publishes it separately. This source does not contain hosting credentials or manage a Site identity.

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

Selection attempts **muted** inline playback; if the browser blocks it, a prominent Play video button remains. Reduced-motion preference suppresses automatic playback. Native playback controls remain available. Original music can be enabled explicitly; song previews have no source-song audio to enable. Each video has a same-origin Download preview video link, and each song reference has a separate Open source song link. No Bilibili media is remotely played or embedded.

### Sources and limits

Titles, durations, segment ranges, original-performer and uploader credits are drawn from the project's [public README](https://github.com/LexZeon/words-actually-dance-open/blob/main/README.md#english) and [Music credits](https://github.com/LexZeon/words-actually-dance-open/blob/main/MUSIC-CREDITS.md#english). Original performers and selected-version creators remain separate roles. Further version credits and permissions can remain unverified; the full credits retain those limits.

The four song-driven previews show only the project's own app interface and original example text, without source-song sound, Bilibili imagery or lyrics. Referenced recordings have not been licensed as this project's public-demo soundtracks. Attribution is not permission to copy, synchronise or distribute a song. The four videos with sound use this project's procedural original music. These are software demonstrations, not verified beat-accuracy or learning-benefit experiments.

No new fonts, templates, stock footage or third-party music are bundled. First-party source and original media follow the project's [MIT licence](https://github.com/LexZeon/words-actually-dance-open/blob/main/LICENSE); [third-party notices](https://github.com/LexZeon/words-actually-dance-open/blob/main/THIRD-PARTY-NOTICES.md#english) remain separate. Publishing this gallery does not grant rights to the linked songs.

---

## 简体中文

这是独立的 Words Actually Dance 真实录屏静态展厅，不嵌入、不链接音乐联动应用的 Site。没有音乐分析、文件上传、账号、云库、追踪服务或外部视频嵌入。

### 构建与预览

在项目根目录运行：

```sh
node showcase-site/build.mjs
python -m http.server 4321 --directory showcase-site/dist
```

打开 `http://localhost:4321/`。构建只需要 Node.js 和已经审核的公开媒体：私有开发项目读取 `public-docs/media`，公开项目读取 `media`；`--media-root` 可明确选择这两个项目目录之一，不读取私人歌曲录屏。

生成的 `dist` 是无需在线构建的完整静态网站，包含 HTML、CSS、一个 JavaScript 模块和本地媒体。构建器只接受自己带所有权标记的输出目录，遇到未知文件或已修改的文件会拒绝覆盖，逐个核对复制哈希，并检查实际 MP4 轨道：四首歌曲预览**没有音轨**，四段原创配乐视频各有一条音轨；不在此重新完整解码媒体。`dist` 是生成目录，由 Git 忽略。

所有者已为独立展厅保留 `https://words-actually-dance-showcase.aivnailedeng.chatgpt.site/` 地址；地址创建不等于已发布，发布与结果由所有者另行核验。这里的源码不含托管凭据，也不管理 Site 身份。

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

选择视频后尝试**静音**内联播放；浏览器不允许自动播放时，会保留显眼的「播放视频」按钮。用户启用减少动态效果偏好时，不自动播放。视频保留原生播放控件；原创配乐可以主动打开，歌曲无声预览本身没有源曲音频。每段视频均提供同源「下载预览视频」，歌曲参考另外提供「打开源歌曲」。不远程播放或嵌入哔哩哔哩媒体。

### 来源与边界

标题、时长、参考片段、原演唱者及上传者署名来自项目[公开 README](https://github.com/LexZeon/words-actually-dance-open/blob/main/README.md#简体中文)与[音乐署名](https://github.com/LexZeon/words-actually-dance-open/blob/main/MUSIC-CREDITS.md#简体中文)。原演唱者与所选版本创作者保持分开；进一步版本署名与授权仍可能未核实，完整署名保留这些边界。

四首歌曲驱动预览只含自有程序界面和原创示例文案，不含源歌曲声音、哔哩哔哩画面或歌词。参考录音尚未获本项目公开视频配乐授权；署名不构成复制、同步配乐或分发许可。四段有声视频采用本项目代码生成的原创配乐；这些是软件演示，不是已验证拍点准确率或学习收益的实验。

没有新增字体、模板、素材视频或第三方歌曲。自有源码与原创媒体遵循项目 [MIT 许可](https://github.com/LexZeon/words-actually-dance-open/blob/main/LICENSE)，[第三方说明](https://github.com/LexZeon/words-actually-dance-open/blob/main/THIRD-PARTY-NOTICES.md#简体中文)独立保留；发布展厅不授予所链接歌曲的权利。
