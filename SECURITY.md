# Security · 安全问题

[English](#english) · [简体中文](#简体中文)

## English

Do not put credentials, personal materials or directly exploitable vulnerability details in a public Issue. Report them privately to `lexzeonstudio@gmail.com`, identifying the affected version, trigger conditions and reproduction steps that contain no private data.

This is experimental open-source software with no guaranteed security-response time. Windows packages are currently unsigned. Obtain them only from this repository's official Releases and check the SHA-256. Do not treat binaries or assets from unknown sources as repository releases.

Electron uses context isolation, a sandbox, restricted IPC and a resource policy. Debugging and recording interfaces are enabled only in isolated test mode; do not make them permanently available in production for demonstration convenience. Do not bypass browser certificates, security warnings or system permissions to read audio.

## 简体中文

请勿在公开Issue中贴出凭据、个人材料或可直接利用的漏洞细节。可通过 `lexzeonstudio@gmail.com` 私下报告，说明受影响版本、触发条件和不含私人数据的复现步骤。

这是实验性开源软件，没有固定安全响应时限。Windows包目前未签名；只从本仓库官方Releases获取并核对SHA-256。不要把未知来源二进制或素材当作仓库发布物。

Electron使用context isolation、sandbox、受限IPC与资源策略。调试和录制接口仅在隔离测试模式启用，不应当为方便演示改成生产常开。不要绕过浏览器证书、安全提示或系统授权来读取声音。
