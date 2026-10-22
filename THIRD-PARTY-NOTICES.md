# 许可、署名与灵感

## 实际分发组件

本仓库自有源码、原创示例文案和自产演示媒体使用根目录 MIT License。此许可不覆盖第三方组件、你导入的内容或你设备上的字体。

- Electron 44.7.0 的自有代码为 MIT；其 Chromium 及其他组件分别保留原许可。Windows 包完整保留运行时的 `LICENSE` 与 `LICENSES.chromium.html`，并在 `resources/app/LICENSE` 保存本项目许可。不要用本项目 MIT 替代这些通知。
- Node／pnpm 的开发依赖以锁文件为准，包含各自 MIT、ISC、BSD、Apache 等许可；它们不全部等同本项目 MIT。构建前获取的工具及它们的许可也需分别处理。
- 可选网页 Worker 使用 esbuild 作为构建工具，按其 MIT 许可处理。默认本地预览无需托管账户或云库。
- 文字通过系统字体栈和 Canvas／DOM 渲染，没有捆绑字体文件；没有分发第三方歌曲、模板、教材或录音采样。

## 仅作方法研究的来源

以下是研究与灵感，未嵌入其模板、媒体或整库实现：

- [FMP 的起音与周期教程](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6.html)及[段落变化教程](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S4_NoveltySegmentation.html)：分别参考声音变化、周期与跨段差异的方法；没有复制教程代码、图像或示例音乐。
- [librosa 0.11.0 beat_track](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html)与[onset_strength](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html)：起音／周期分析方法背景；未复制源码或将 Python 库打包进应用。
- [Adobe Echo／Time effects](https://helpx.adobe.com/after-effects/desktop/apply-effects-and-animation-presets/list-of-effects/time-effects.html)：延迟回声机制。
- [Jitter 文字动画](https://help.jitter.video/en/articles/6500074-animate-text) 与 [Inward echo loop](https://jitter.video/template/inward-echo-loop/)：文字动作表现灵感。
- [Anime.js stagger 文档](https://animejs.com/documentation/utilities/stagger/)：逐字符错峰机制。
- [morluto/rea](https://github.com/morluto/rea)，研究版本 `26525706fcd102355d1cd765138398067f32527f`：分析文字效果实现方法的工作流参考；没有安装、运行或复制其代码。REA 自身 MIT 不覆盖被分析对象、字体、模板或素材。

自产演示由真实应用页面录制、配乐由项目代码合成。MediaRecorder 输出经本地 FFmpeg 转码；FFmpeg 录制工具没有打包到应用或仓库，它的许可与运行时组件分别处理。演示不使用外部视频或音乐。

用户提供的音乐风格观察链接：[Die for You](https://www.bilibili.com/video/BV1Zopb6KEFo/)、[另一片段（1:19–1:53）](https://www.bilibili.com/video/BV1Eqh9z1EcP/)、[副歌片段（2:04起）](https://www.bilibili.com/video/BV1Kmpc6zEi3/)。用户明确未取得公开视频配乐许可，选择自产配乐并附参考链接；这些录音不混入公开演示或随仓库及软件分发。本地私有歌曲测试录制独立保存，不在公开快照中。来源链接不授予录音、词曲或同步配乐权利。

学习方法的原始研究、作者与适用边界见[学习说明](docs/learning-science.md)。原创示例转述通用方法，没有分发论文全文、图表或原实验素材；这些研究不是本产品音乐、动画或整体学习效果的验证。

## 后续采用

引入新代码、模型、字体、音频或内容时，先核对实际版本、复制／修改范围、商用和分发条件，再保留所需许可证与署名。MIT 允许自有部分的商业使用，不保证品牌、专利、上传材料或服务条款已完成所有市场的法律清查。正式分发仍应按实际依赖与目标市场履行义务。
