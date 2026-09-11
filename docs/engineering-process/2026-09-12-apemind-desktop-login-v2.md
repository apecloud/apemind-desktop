# ApeMind Desktop 登录与工作空间设计

本文是 ApeMind Desktop 登录功能的当前设计。它覆盖产品行为、桌面端实现、ApeMind 服务端接口、私有化兼容性、组织权限和验收标准。所有服务端接口统一使用 `/api/v2`。

## 目标和边界

用户在 Desktop 中点击一次“登录 ApeMind”，即可完成账户登录，并看到自己的个人空间和全部有效组织。Desktop 保存的是可撤销的 OAuth 设备会话，不创建隐藏 API Key，也不把浏览器 Cookie 当作桌面长期登录态。每次业务请求仍由服务端根据用户身份、组织成员关系、角色和 scope 做最终鉴权。

首个版本支持三种入口，按普通用户的使用顺序排列：

1. 标准桌面 OAuth：授权码 + PKCE + 系统浏览器 + 本机回环回调；
2. 兼容性兜底：设备授权码，用户可以在任意浏览器输入短码确认；
3. 高级入口：用户主动粘贴已有 API Key。

本版本不包含组织创建、组织邀请、计费、跨组织批量写操作或新的业务权限模型。这些能力继续使用现有组织 RBAC，在具体业务需求明确后单独扩展。

## 产品流程

设置页的主卡片显示账户状态和当前工作空间。

未登录时，页面显示服务地址（默认 `https://apemind.ai`）、“在浏览器中登录”和“使用设备码登录”两个按钮。浏览器登录是主按钮，设备码是兼容入口，并在按钮下说明适用场景：浏览器不能自动返回 Desktop、企业自研浏览器或网络策略拦截回调时使用设备码。登录过程中显示“正在等待浏览器授权”、取消按钮和明确的失败原因。

登录成功后，页面显示用户名、服务地址、工作空间选择器和最近同步时间。工作空间列表包含个人空间和用户当前可见的组织，显示类型、组织角色和可用权限。默认选择个人空间；没有个人空间时选择第一个有效组织。暂停、撤销或不可访问的组织不能选择。点击切换后，Desktop 重新向服务端获取列表并校验目标空间仍然有效；失败时保留原选择。

页面提供“刷新工作空间”按钮。刷新使用当前 OAuth 会话重新读取成员关系，发现当前空间失效时清空选择并要求用户重新选择。所有知识库或后续业务操作都显示当前工作空间名称，服务端再次校验权限，不信任本地快照。

“高级连接 · 使用 API Key”折叠显示手工连接表单。用户必须主动粘贴 API Key，提交后输入框立即清空。页面只显示连接对应的工作空间和 Key 后四位（如需要），完整 Key 不进入 Renderer 状态、URL、日志或普通插件接口。移除连接只清理本机记录，不撤销用户在服务端创建的 Key。

退出 OAuth 登录时，Desktop 调用服务端撤销当前刷新令牌，然后清理本地凭据。退出不影响用户已有的 API Key 连接。

## 三条认证路径

### 主路径：授权码 + PKCE + 回环回调

Desktop 是公开原生客户端，不内置 client secret。每次登录生成高熵 `state` 和 `code_verifier`，使用 S256 生成 `code_challenge`，在本机随机端口只监听 `127.0.0.1`：

```text
http://127.0.0.1:<随机端口>/callback
```

Desktop 打开系统默认浏览器访问：

```text
GET /api/v2/auth/desktop/authorize
  ?response_type=code
  &client_id=apemind-desktop
  &redirect_uri=http://127.0.0.1:<port>/callback
  &code_challenge=<S256>
  &code_challenge_method=S256
  &state=<随机值>
  &scope=profile workspace.read collection.read
```

服务端要求用户使用浏览器会话登录，展示授权确认页。确认页只使用当前浏览器 Cookie 完成用户身份判断，不接受 API Key、Desktop Token 或服务身份代替交互登录。确认成功后，服务端把一次性授权码和原始 `state` 重定向到回环地址：

```text
GET http://127.0.0.1:<port>/callback?code=<一次性码>&state=<原始值>
```

Desktop 校验 state 和参数只出现一次，调用：

```text
POST /api/v2/auth/desktop/token
grant_type=authorization_code
client_id=apemind-desktop
code=<一次性码>
redirect_uri=<完全匹配的回环地址>
code_verifier=<原始 verifier>
```

服务端验证 PKCE、客户端、回环地址和授权码一次性使用后，返回短期 Access Token 和可轮换 Refresh Token。Desktop 随后读取账户与工作空间，全部成功后才把 Refresh Token 写入凭据存储；任何中途失败都会撤销已签发的刷新令牌并关闭本机监听器。

### 兼容路径：设备授权码

设备码流程不依赖浏览器回跳，因此覆盖旧浏览器、自研浏览器、远程桌面和隔离网络。

Desktop 请求：

```text
POST /api/v2/auth/desktop/device
client_id=apemind-desktop
scope=profile workspace.read collection.read
```

服务端返回：

```json
{
  "device_code": "只返回给 Desktop 的长随机值",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://apemind.ai/api/v2/auth/desktop/device",
  "verification_uri_complete": "https://apemind.ai/api/v2/auth/desktop/device?user_code=ABCD-EFGH",
  "expires_in": 600,
  "interval": 5
}
```

Desktop 打开 `verification_uri_complete`。如果自动打开失败，页面同时展示地址和短码，用户可以在任意浏览器打开地址并手工输入短码。浏览器要求用户登录 ApeMind 后确认授权。确认结果只写入服务端设备授权记录，不把令牌放进网页。

Desktop 使用 `device_code` 轮询同一个 Token 接口：

```text
POST /api/v2/auth/desktop/token
grant_type=urn:ietf:params:oauth:grant-type:device_code
client_id=apemind-desktop
device_code=<长随机值>
```

服务端按 RFC 8628 语义返回 `authorization_pending`、`slow_down`、`access_denied`、`expired_token` 或成功令牌。Desktop 首次可以立即轮询，之后至少按服务端 interval 等待；收到 `slow_down` 自动增加等待时间。设备码过期、取消或用户拒绝时，页面给出重新开始的入口。

### 高级路径：API Key

用户在高级连接中主动粘贴 API Key。Desktop 通过：

```text
GET /api/v2/auth/user
Authorization: Bearer <API Key>
```

确认 Key 有效、用户状态正常以及绑定工作空间的组织成员关系，再调用现有组织和知识库接口。API Key 的绑定范围由服务端决定；Desktop 不允许用请求头覆盖 Key 的组织范围，也不把一把组织 Key 扩展成用户所有组织的权限。

## 服务端接口

### OAuth 与设备授权

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/v2/auth/desktop/authorize` | PKCE 浏览器授权页 |
| POST | `/api/v2/auth/desktop/authorize` | 浏览器确认或拒绝 PKCE 授权 |
| POST | `/api/v2/auth/desktop/device` | 创建设备授权请求 |
| GET | `/api/v2/auth/desktop/device` | 短码输入和设备授权确认页 |
| POST | `/api/v2/auth/desktop/device/approve` | 浏览器确认或拒绝设备授权 |
| POST | `/api/v2/auth/desktop/token` | 授权码、设备码和刷新令牌换取令牌 |
| POST | `/api/v2/auth/desktop/revoke` | 撤销刷新令牌或设备会话 |

服务端只接受预注册的 `client_id=apemind-desktop`。回环 redirect URI 必须是 `http://127.0.0.1:<1024-65535>/callback`，不接受 `localhost`、IPv6、路径参数、查询参数、用户名或密码。授权码、设备码和刷新令牌在数据库中只保存哈希。

授权确认页以绑定当前浏览器会话的签名同意令牌作为主要 CSRF 证明。`Origin` 或 `Referer` 存在时继续校验可信来源；老浏览器两者都缺失时仍可确认，因为攻击者无法伪造与当前会话绑定的同意令牌。这个校验只负责网页表单的 CSRF 边界，Desktop 主流程的安全性由 PKCE、回环监听、设备码和一次性状态保证。

### 用户和工作空间

现有接口继续复用：

```text
GET /api/v2/auth/user
GET /api/v2/organizations/{id}
GET /api/v2/collections
```

Desktop OAuth 使用新增的：

```text
GET /api/v2/me/workspaces
Authorization: Bearer <Access Token>
```

返回个人空间和当前有效组织的投影：

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
      "name": "组织名称",
      "status": "active",
      "role": "member",
      "permissions": ["collection.read"]
    }
  ]
}
```

业务请求可以携带：

```text
X-ApeMind-Workspace-Id: <workspace id>
```

服务端只接受当前用户实际可见且状态为 active 的工作空间。个人空间和组织空间分别映射到现有数据访问边界；组织切换不会改变用户身份，也不会绕过组织 RBAC。当前 OAuth scope 只允许账户、工作空间和知识库读取，修改型操作必须增加独立 scope 和业务审计。

### 会话和权限

Access Token 有效期 10 分钟。Refresh Token 只保存哈希，单次使用后轮换；设备会话绝对有效期 30 天，刷新不延长这个期限。重放旧 Refresh Token 会撤销整个设备会话。每次请求仍检查用户是否激活、Desktop 会话是否撤销或过期，以及组织成员关系和组织状态。

设备授权记录只允许 `pending → approved/denied/expired → consumed` 的单向状态变化。短码不作为令牌使用，服务端要求浏览器已有用户会话才能确认。设备码接口应沿用现有 HTTP 限流和审计能力，避免匿名请求无限创建记录。

## Desktop 实现

Host 插件 `@deepseek-ai/dsh-apemind-login` 负责所有网络请求、令牌刷新、工作空间选择和凭据写入。Renderer 只能调用公开的 Remote 投影，不能读取 Refresh Token、Access Token 或 API Key。

OAuth 主路径使用系统浏览器和本机回环 HTTP Server。设备码路径复用同一个 `OAuthService`、同一个账户快照和同一套刷新/退出逻辑。两条路径获得的最终状态完全一致，后续业务代码不需要知道登录来源。

网络客户端固定：

- 只接受 HTTPS 的服务地址；
- 禁止 HTTP 重定向；
- 使用 15 秒请求超时；
- `credentials: omit`，不携带浏览器 Cookie；
- 将 401、403、过期、拒绝、网络错误转换为固定产品文案；
- 不把服务器响应体、令牌或 Key 写入错误消息。

Refresh Token 当前由 DSH 凭据服务保存为权限为 `0600` 的本地凭据记录。系统钥匙串接入列为后续事项：macOS Keychain、Windows Credential Manager/DPAPI 和 Linux Secret Service。接入前不能把本地文件描述成加密存储。

## 私有化部署兼容性

每套部署配置 `APEMIND_PUBLIC_URL`，用于生成设备码验证地址和校验授权页的可信来源。反向代理终止 TLS 时，服务端使用受信任的请求基址和该配置，不信任客户端可伪造的 `X-Forwarded-Host`。

私有化环境没有公网域名时：

- PKCE 回环回调仍然只需要 Desktop 能访问服务端；
- 设备码可以在另一台能访问该部署的浏览器上完成；
- 自研或老旧浏览器无法回跳时，用户使用短码输入页；
- 浏览器缺少 `Origin` 时可使用同站 `Referer`；老浏览器两个来源头都缺失时，使用签名同意令牌完成确认，不因缺失头部而阻断登录。

服务端不要求 Desktop 使用嵌入式浏览器，也不读取浏览器 Cookie，因此浏览器内核版本不会决定令牌能否被 Desktop 获取。

## 凭据和隐私

- Access Token 只保存在 Host 内存；
- Refresh Token 只保存在凭据存储，数据库只保存哈希；
- API Key 只在提交连接时短暂存在；
- 日志、遥测、错误、URL、HTML 和 UI 公开状态不得出现令牌、Key、Cookie 或 Authorization 头；
- 退出时本地删除 OAuth 快照并调用撤销接口；
- 服务端组织列表是用户可见成员关系的投影，不返回隐藏组织或无效成员。

## 验收标准

服务端自动化测试必须覆盖：

- PKCE 授权码正确交换、错误 verifier、重复使用和 redirect URI 校验；
- 设备码创建、待确认、批准、拒绝、过期、轮询过快、重复消费；
- Origin、Referer、缺失来源和伪造转发头；
- Refresh Token 轮换、重放撤销、用户停用和会话过期；
- 工作空间只返回当前成员关系，组织撤销后即时不可用；
- 个人与组织工作空间的业务请求隔离。

Desktop 自动化测试必须覆盖：

- 回环回调的 state 校验、重复回调、取消、超时和监听器关闭；
- 设备码打开验证地址、待确认轮询、slow_down、拒绝和过期；
- 两条 OAuth 路径写入相同的账户快照并且公开投影不含秘密；
- Refresh Token 轮换、并发请求串行、退出竞态和网络失败；
- API Key 输入清空、错误脱敏和连接范围隔离。

发布验收必须包含：

1. 从锁定的上游 commit 重新构建 Desktop；
2. Desktop Host 和 Renderer 插件实际加载；
3. 在现代浏览器完成 PKCE 回环登录；
4. 在无法回跳的浏览器场景完成设备码登录；
5. 登录后显示个人空间和全部有效组织；
6. 切换组织后读取请求只返回当前空间数据；
7. 退出后令牌失效，重启后按凭据存储恢复；
8. 私有化配置 `APEMIND_PUBLIC_URL` 后，授权页面和设备码地址正确；
9. 服务端和 Desktop 版本、迁移、构建产物与发布记录一致。

## 后续事项

系统凭据库迁移、设备管理页、设备名称、单设备撤销、更多组织操作 scope、组织切换后的业务导航和审计报表应作为独立需求实现。它们不能通过默认创建隐藏 API Key 或共享浏览器 Cookie 解决。

