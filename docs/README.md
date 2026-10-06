# ApeMind Desktop 文档

- [个人空间与组织工作空间最终合同](engineering-process/2026-10-07-personal-workspace-policy-final.md)：当前定稿入口，固定个人空间存在、为空或不存在时的产品语义、`/api/v2` 边界、CLI/Desktop 行为和六态验收口径。
- [ApeMind CLI 命令语义、权限范围与管理能力设计修订](engineering-process/2026-09-24-apemind-cli-command-scope-and-admin-design.md)：当前用户、connection、workspace、org、admin、API/MCP 认证边界、审计发现、授权矩阵和执行 Goal。
- [ApeMind CLI 对标 gh 的能力分析与产品技术设计](engineering-process/2026-09-16-apemind-cli-gh-capability-design.md)：CLI 体验差距、服务端能力覆盖、高层命令、通用 API、MCP、Desktop 和 Skill 分工、实施优先级与持续交付 Goal 文案。
- [ApeMind CLI-first 集成设计](engineering-process/2026-09-14-apemind-cli-first-integration.md)：CLI、Desktop、DSH Agent 与 ApeMind `/api/v2` 的统一身份、凭据与进程边界；明确 OAuth 默认业务路径、显式 API Key、HTTP MCP Bearer 认证及错误合同。能力扩展以对标 gh 的设计为准。
- 异步能力统一遵循服务端资源合同：当前系统没有统一的 `task` 产品对象，CLI 不创建跨资源任务命令、状态表或输出字段；等待和取消使用 `document`、`turn`、`import`、`export` 等真实资源。
- [登录与工作空间设计](engineering-process/2026-09-12-apemind-desktop-login-v2.md)：产品体验、UI、PKCE、设备码、API Key、服务端接口、权限与验收标准。
- [个人空间可选化与组织工作空间迁移设计](engineering-process/2026-09-26-personal-workspace-transition.md)：个人空间逐步退出期间的历史背景和迁移矩阵；当前规范以[个人空间可选合同](engineering-process/2026-09-29-personal-workspace-optional-contract.md)为准。
- [个人空间可选合同](engineering-process/2026-09-29-personal-workspace-optional-contract.md)：历史合同正文；当前定稿以[个人空间与组织工作空间最终合同](engineering-process/2026-10-07-personal-workspace-policy-final.md)为准。
- [个人空间退出基线与执行计划](engineering-process/2026-09-28-personal-workspace-exit-plan.md)：个人空间默认关闭、最终不存在时的统一产品基线、六种账户状态和服务端、CLI、Desktop、Widget、迁移及发布剩余工作。
- 服务端对应的 `/api/v2` presence、权限前置检查和迁移退出合同见 [aperag-enterprise 的个人空间服务端合同](https://github.com/apecloud/aperag-enterprise/blob/main/docs/engineering-process/2026-09-26-personal-workspace-contract.md)。
- 当前生产事实是线上新账户默认关闭个人空间；历史个人空间可以存在、为空或已经迁移，长期完全没有个人空间仍是正常状态。
- 个人空间当前已是生产中的可选遗留能力：线上新账户默认关闭，长期可以完全移除；组织空间是长期的数据、权限和配额边界。CLI 与 Desktop 只消费服务端返回的 workspace ID 和 `type`，不从 ID 前缀合成个人空间。
- 空工作空间是正常登录结果，不是异常登录态：`items: []` 时仍可查看账户和刷新状态，所有需要命名空间的命令由 CLI/服务端返回 `workspace_required`，Desktop 只呈现恢复动作。个人数据迁移、导出、删除和旧 alias 清理不随客户端发布隐式执行。
- 工作空间响应必须包含明确的 `items` 数组；缺少字段、`null` 或其他类型属于服务端协议错误，客户端显示同步失败并保留原选择，不能把坏响应误判为空空间。
- [API Key 连接说明](engineering-process/2026-09-11-apemind-desktop-login.md)：高级连接实现与历史验证记录。
- [开发运行手册](dev-runbook.md)：同步、构建与本地运行。
- [品牌说明](branding.md)：品牌改动边界；逐文件范围以 `overlay/OVERLAY.md` 为准。
- [系统凭据库后续事项](https://github.com/apecloud/apemind-desktop/issues/3)：当前允许 `0600` 凭据文件，系统凭据库接入尚未实现。
