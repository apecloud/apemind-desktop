# ApeMind Desktop 文档

- [ApeMind CLI 对标 gh 的能力分析与产品技术设计](engineering-process/2026-09-16-apemind-cli-gh-capability-design.md)：CLI 体验差距、服务端能力覆盖、高层命令、通用 API、MCP、Desktop 和 Skill 分工、实施优先级与持续交付 Goal 文案。
- [ApeMind CLI-first 集成设计](engineering-process/2026-09-14-apemind-cli-first-integration.md)：CLI、Desktop、DSH Agent 与 ApeMind `/api/v2` 的统一身份、凭据与进程边界；明确 OAuth 默认业务路径、显式 API Key、HTTP MCP Bearer 认证及错误合同。能力扩展以对标 gh 的设计为准。
- [登录与工作空间设计](engineering-process/2026-09-12-apemind-desktop-login-v2.md)：产品体验、UI、PKCE、设备码、API Key、服务端接口、权限与验收标准。
- [API Key 连接说明](engineering-process/2026-09-11-apemind-desktop-login.md)：高级连接实现与历史验证记录。
- [开发运行手册](dev-runbook.md)：同步、构建与本地运行。
- [品牌说明](branding.md)：品牌改动边界；逐文件范围以 `overlay/OVERLAY.md` 为准。
- [系统凭据库后续事项](https://github.com/apecloud/apemind-desktop/issues/3)：当前允许 `0600` 凭据文件，系统凭据库接入尚未实现。
