# Contributing · 一起改进

[English](#english) · [简体中文](#简体中文)

## English

Issues, documentation improvements and small, complete changes are welcome. This experimental project has no guaranteed maintenance schedule or response time.

Read the implemented scope in the README and run the tests first. Explain the trigger, resulting behaviour and validation for each change. Do not conceal a local problem by replacing the entire player.

Both text renderers use the same continuously running playback Clock. Keep actual sound events separate from the internal beat grid: do not manufacture successful detections from virtual beats or give the knowledge area its own timer. The four feature families must continuously modulate actual poses, rather than merely switch randomly between presets. Preserve correct behaviour for pause, cancellation, failed source changes, resource cleanup and reading in small windows.

When reporting a music issue, describe the sound characteristics, source mode and output device. Do not publicly upload songs you have no right to share, private notes, spectra or account information. A small self-generated sample that you are allowed to distribute is welcome. A BPM label is not a detection result.

Contribute only material you have the right to license. When copying a third-party implementation, model, font or media asset, record its exact version, licence, scope of use and required notices separately. Public availability does not establish commercial-use permission. Distinguish inspiration from code reuse. Contributions are licensed under the repository's MIT licence by default; third-party material retains its own licence.

Keep the interface black, white and grey, centred on text, with understandable entry points, keyboard access and respect for reduced-motion preferences. Learning content must distinguish research findings from validation of this software. Do not advertise unverified improvements in memory or learning efficiency.

## 简体中文

欢迎报告问题、完善文档和提交小而完整的改动。实验项目没有固定维护或响应承诺。

先阅读README的已实现范围，运行测试。一次改动解释清楚触发条件、实际变化和验证，不要用替换整个播放器掩盖局部问题。

两种文字使用同一持续播放Clock；真实声音事件与内部拍子分开。不能从虚拟拍制造检测成功，不能给知识区新增独立计时器。四类特征应连续调制真实姿态，不能只随机换预设。暂停、取消、切源失败、关闭资源和小窗口阅读都要保护。

报告音乐问题时，描述声音特征、来源方式和输出设备即可。不要公开上传没有权利分享的歌曲、私人笔记、频谱或账户资料。可提供你自行生成、允许分发的小样例；BPM标签不是检测结果。

贡献代码需为你有权授权的内容。复制第三方实现、模型、字体、媒体时，分别记录具体版本、许可、采用范围和所需声明，不把公开可见等同可商用。方法灵感与代码复用分开。默认贡献按仓库MIT授权，第三方保留其原许可。

界面保持黑白灰、文字为主、入口好懂、键盘可用并尊重减少动态效果。学习文案区分研究发现与软件实际验证；不要宣传记忆率或学习效率的未经验证提升。
