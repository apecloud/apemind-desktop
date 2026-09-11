# ApeMind Desktop 登录与工作空间设计

本文定义 ApeMind Desktop（基于 DeepSeek Harness）如何登录 ApeMind、发现个人空间与组织，并在后续业务调用中保持服务端权限隔离。

## 现状与目标

当前 Desktop 插件支持用户手工输入 API Key，使用 `/api/v2/auth/user`、组织查询和知识库查询验证一条绑定到单个工作空间的 Key。这个能力适合开发者和旧部署兼容，但把“用户登录”和“操作凭据”混在了一起：一个用户加入多个组织时，需要手工获得多把 Key，退出和权限变更也无法由用户身份自然处理。

目标是让普通用户在 Desktop 中完成一次 ApeMind 登录，自动看到其个人空间和全部有效组织；用户明确选择当前工作空间后，Desktop 的每个请求都由服务端实时验证成员关系、组织状态、角色和 API scope。API Key 作为高级兼容入口保留，不作为普通登录的实现手段。

本方案不解决组织邀请、组织创建、计费、跨组织批量写操作和 Agent 工具的具体业务授权规则。这些功能继续复用现有组织 RBAC，并在对应业务需求明确后单独增加权限和审计。

## 产品体验

设置页的主入口为“登录 ApeMind”。点击后使用系统默认浏览器打开 ApeMind 登录页。用户在浏览器中完成账号登录和必要的二次验证，授权页面明确展示 Desktop 请求的权限。授权完成后浏览器回到 Desktop，Desktop 自动加载个人空间和全部有效组织。

登录结果页显示账户、服务地址和工作空间列表。首次登录选择个人空间，没有个人空间时选择第一个可用组织；重启恢复已保存的选择。工作空间列表支持手动刷新；当前空间失效时清除选择，由用户重新选择。被暂停的组织显示“已暂停”并禁止选择。

工作区选择器始终显示当前上下文。切换空间是显式动作，成功后后续会话和业务请求使用新的 workspace。切换失败保留原选择。退出操作撤销当前设备的刷新令牌并清除本机登录状态，不撤销用户创建的 API Key。

“使用 API Key”放在“高级连接”入口中。提交 Key 后仍使用服务端绑定范围验证；页面只显示 Key 后四位，不展示完整 Key，也不把 Key 传给 Renderer 的状态或业务插件。

## 认证与令牌

Desktop 是公开原生客户端，不内置 client secret。登录使用 OAuth 2.0 Authorization Code + PKCE，并通过系统浏览器完成授权。应用为每次登录生成随机 `state`、`code_verifier` 和 `code_challenge`，严格校验回调来源、state 和一次性授权码。

回调使用本机 Loopback：`http://127.0.0.1:<随机端口>/callback`，只监听本机回环地址，在完成令牌交换、账户同步和本地保存后显示成功并关闭；超时、取消或失败也关闭监听器。首版仅支持此回调形式。不得在 Electron 内嵌页面中输入 ApeMind 密码或读取浏览器 Cookie。

首版申请 `profile workspace.read collection.read`，不宣称支持 OpenID Connect 或签发 ID Token。服务端返回有效期 10 分钟的 Access Token 和可轮换的 Refresh Token；设备会话绝对有效期为 30 天，刷新不延长该期限。Access Token 只保存在 Desktop Host 内存中，过期后使用 Refresh Token 换取新 Token。当前版本由 DSH Host 凭据服务将 Refresh Token 保存到权限为 `0600` 的本地文件。此限制已被接受用于首版功能发布；文件权限不提供静态加密。macOS Keychain、Windows Credential Manager/DPAPI 和 Linux Secret Service 的接入与迁移由 [系统凭据库事项](https://github.com/apecloud/apemind-desktop/issues/3) 跟踪，尚未实现。

Access Token 必须包含用户主体、客户端、受众、scope、会话 ID 和过期时间。服务端按请求重新检查工作空间成员关系；工作空间列表或权限变化不依赖长时间有效的 Token claims。

## 服务端 API（统一 `/api/v2`）

### OAuth 授权

```http
GET /api/v2/auth/desktop/authorize
POST /api/v2/auth/desktop/token
POST /api/v2/auth/desktop/revoke
```

授权请求使用 `client_id`、`redirect_uri`、`state`、`code_challenge`、`code_challenge_method=S256` 和最小 scope。服务端只接受预注册的 Desktop client 和 redirect URI。Token 端点支持授权码交换和刷新令牌；刷新令牌每次使用后轮换并使旧令牌失效。撤销端点支持按设备会话撤销。

### 用户与工作空间

现有 `GET /api/v2/auth/user` 继续支持 API Key 和 OAuth Token，但 OAuth 登录不能依赖 `bound_org_id` 表示全部组织。新增：

```http
GET /api/v2/me/workspaces
```

响应包含个人空间和当前用户可见的组织空间：

```json
{
  "items": [
    {
      "id": "personal:user-id",
      "type": "personal",
      "name": "个人空间",
      "status": "active",
      "role": null,
      "permissions": []
    },
    {
      "id": "org-id",
      "type": "organization",
      "name": "ApeMind 公司",
      "status": "active",
      "role": "member",
      "permissions": ["collection.read"]
    }
  ]
}
```

### 工作空间上下文

业务请求继续使用现有资源路径，例如：

```http
GET /api/v2/collections
Authorization: Bearer <access-token>
X-ApeMind-Workspace-Id: org-id
```

`X-ApeMind-Workspace-Id` 只表达客户端选择，绝不是权限证明。服务端认证依赖必须验证 Token、workspace 是否属于用户、组织是否 active、scope 和 RBAC 是否允许，并将最终 workspace 放入请求上下文。首版知识库列表请求必须提供 workspace Header，个人空间排除组织知识库和订阅，组织空间只返回该组织资源。Cookie 原有行为不改变。客户端无法通过修改 Header 越权。

API Key 请求仍由 Key 的绑定工作空间决定，不接受客户端用 workspace Header 覆盖其绑定范围。

## 服务端内部模型

认证上下文按以下维度区分身份（这不是新增的通用 DTO）：

```text
subject_id, subject_type, auth_method, client_id,
session_id, workspace_id, scopes, permissions
```

现有业务服务继续使用认证依赖给出的 User 和工作空间上下文。首版不引入全仓 Principal 重构；认证依赖在请求状态中记录用户、认证方式、设备会话和选定空间，不记录令牌、Key、Cookie 或授权码。现有审计机制继续负责业务操作记录。

建议新增设备会话表或等价存储，字段包括用户、客户端、Refresh Token 哈希、设备名称、创建时间、最近使用时间、过期时间和撤销时间。Refresh Token 只存哈希或可验证的密文，首版支持撤销当前设备会话。

## Desktop 插件接口

Host Remote 对 Renderer 暴露：

```ts
state()
startBrowserLogin(origin)
cancelBrowserLogin()
selectWorkspace(workspaceId)
refreshWorkspaces()
oauthCollections()
oauthLogout()
connect(origin, apiKey)
```

Renderer 只接收账户和工作空间公开投影。`startBrowserLogin(origin)` 打开浏览器并等待完成，返回账户投影。`state()` 同时返回 `browserLoginPending`；`cancelBrowserLogin()` 可在等待中调用。Renderer 不接收授权码、浏览器 Cookie 或 Token。

状态模型从“每个连接对应一把 Key”调整为：

```text
loginSession: origin, user, refreshToken reference, verifiedAt
workspaces: server-provided workspace snapshots
activeWorkspaceId: selected workspace
```

现有 API Key 连接可以继续使用独立的 advanced connection 记录，不应与 OAuth session 混存成同一种凭据。

## 错误、退出与并发

登录回调必须验证 state 和 PKCE；过期授权码只能重新开始登录。刷新令牌失败时清除本机会话并要求重新登录。网络失败不清除仍可能有效的会话，服务恢复后再刷新。

同一 Host 的登录、切换 workspace、刷新列表和退出操作串行执行，取消可中断在途登录。凭据写入比较先前快照；独立 Host 进程同时轮换共享文件中的刷新令牌时会拒绝冲突，用户需要重新登录，不自动重试已消费的令牌。退出先撤销服务端设备会话，再清除本地 Refresh Token；撤销失败时显示失败并保留凭据。首版不提供离线强制删除按钮，不承诺未完成的服务端撤销。

## 安全与可观测性

禁止默认创建 API Key，禁止创建不可见的隐藏 API Key，禁止复制浏览器 Cookie，禁止把 Token 或 Key 写入 URL、日志、错误文本、崩溃报告和 Renderer 状态。所有 API 请求使用 HTTPS；OAuth 回调监听仅限 `127.0.0.1` 并使用随机端口。

Access Token scope 按实际功能最小化；资源服务端检查 audience、client_id、session_id、实时会话状态和 scope。首版 OAuth 只允许 `GET /api/v2/auth/user`、`GET /api/v2/me/workspaces` 和 `GET /api/v2/collections`；其他方法与路径默认拒绝。增加业务操作时必须同时增加明确 scope、工作空间与 RBAC 校验和对应测试。Refresh Token 使用轮换和重放检测。禁止将授权请求、Token 端点表单或回调完整 URL 写入应用日志。

## 兼容与迁移

第一版发布后，已有 API Key 连接继续可用。设置页将其迁移到“高级连接”，不自动把 API Key 转换成 OAuth 会话，也不自动创建新 Key。历史的绑定组织连接在用户完成 OAuth 登录后可以作为独立高级连接保留；用户可手工删除。

服务端先增加 OAuth 和统一 Principal 能力，再发布 Desktop。Desktop 检测到服务端不支持 OAuth 时，提供 API Key 高级入口和明确的升级提示。服务端回滚时，旧 API Key 路径继续工作；OAuth 数据表和端点可以保持向后兼容，不影响现有资源接口。

## 验收标准

- 浏览器登录完成后，Desktop 能显示个人空间和全部有效组织。
- 成员被移除、组织被暂停或 scope 被撤销后，服务端拒绝后续请求。
- 修改 workspace Header 不能访问未授权组织。
- Access Token 过期可自动刷新；Refresh Token 重放、撤销和过期会要求重新登录。
- 退出后本机没有可用 Refresh Token，服务端设备会话已撤销。
- Renderer、日志、错误和审计记录均不含 Token、Key、Cookie 或授权码。
- API Key 高级入口继续验证绑定范围，且不会创建隐形 Key。
- Desktop 单元测试、服务端认证与组织权限测试、构建测试、真实 staging 联调和回滚演练全部通过。

## 读完后能回答的问题

读者应能回答：普通用户如何登录、为什么不默认创建 API Key、为什么不使用 Cookie、多个组织如何自动发现、当前 workspace 如何影响请求、Token 存在哪里、API Key 入口如何兼容，以及服务端需要新增哪些 `/api/v2` 能力。

## 协议依据

系统浏览器与回环回调遵循 [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)，令牌范围约束、轮换与重放处理参考 [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)。
