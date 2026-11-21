# ApeMind Desktop 文档

## 维护文档

- [开发运行手册](dev-runbook.md)：上游同步、构建、CLI 版本锁与本地运行。
- [品牌说明](branding.md)：品牌改动边界；逐文件范围以 `overlay/OVERLAY.md` 为准。
- [系统凭据库后续事项](https://github.com/apecloud/apemind-desktop/issues/3)：当前允许 `0600` 凭据文件，系统凭据库接入尚未实现。

## 现行集成与工作空间约定

- 服务端路由工作区准入策略与合同测试以 `apecloud/aperag-enterprise` 的 `aperag/domains/identity/service/workspace_policy.py` 与 `tests/unit_test/identity/test_workspace_route_policy_contract.py` 为准；面向用户的产品与接入文档见 <https://apemind.ai/docs/>。
- 组织空间是长期的数据、权限和配额边界；新账户默认没有个人空间。CLI 与 Desktop 只消费服务端返回的 workspace ID 与 `type`，不从 ID 前缀合成个人空间。
- 空工作空间是正常登录结果，不是异常登录态：`items: []` 时仍可查看账户和刷新状态，所有需要命名空间的命令由 CLI/服务端返回 `workspace_required`，Desktop 只呈现恢复动作。个人数据迁移、导出、删除和旧 alias 清理不随客户端发布隐式执行。
- 工作空间响应必须包含明确的 `items` 数组；缺少字段、`null` 或其他类型属于服务端协议错误，客户端显示同步失败并保留原选择，不能把坏响应误判为空空间。
- 异步能力统一遵循服务端资源合同：当前系统没有统一的 `task` 产品对象，CLI 不创建跨资源任务命令、状态表或输出字段；等待和取消使用 `document`、`turn`、`import`、`export` 等真实资源。
