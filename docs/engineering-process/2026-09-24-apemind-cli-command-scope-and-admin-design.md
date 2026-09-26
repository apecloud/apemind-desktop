# ApeMind CLI 命令语义、权限范围与管理能力设计修订

本文把 ApeMind CLI 的产品边界、命令语义和服务端授权合同收敛为一套可执行设计，重点解释本轮审计发现了什么、哪些现有行为需要调整、哪些能力应保留，以及后续如何让 Agent 不容易误用命令。

本文是 [ApeMind CLI-first 集成设计](2026-09-14-apemind-cli-first-integration.md) 和 [ApeMind CLI 对标 gh 的能力分析与产品技术设计](2026-09-16-apemind-cli-gh-capability-design.md) 关于命令范围、组织治理、工作空间、管理员能力和授权矩阵的当前补充；身份、凭据、Desktop 集成和异步资源的基础原则仍由前两篇文档共同定义。

本轮审计针对 `apemind` CLI 当前实现、`aperag-enterprise` 的 `/api/v2` 路由和服务端权限代码进行交叉检查。文中把“当前代码事实”“目标产品语义”和“需要修改的合同”分开书写；设计完成不等于代码、发布或线上验收已经完成。

## 结论先行

ApeMind CLI 的普通命令必须默认表达“当前 connection、当前用户、当前 workspace、服务端实时授权”这四个条件的交集。命令不能因为调用者是 site admin，就静默把普通用户命令扩展为平台全量查询。

`org list` 的产品含义应是“列出当前用户加入或拥有的组织”，而不是“列出平台中的所有组织”。平台管理员的全局组织清单属于控制面，应使用显式的 `apemind admin org list` 或等价的 `apemind api /api/v2/admin/...`，不能复用普通 `org list` 的隐含语义。

不建议维护第二个 `apemind-admin` 二进制。认证、连接、配置、帮助、输出和 Agent 接入都应只有一套；管理员能力在同一个 `apemind` 二进制下使用显式的 `admin` 命名空间，并由服务端权限决定是否允许执行。

`connection`、`workspace`、`org` 和 `admin` 是四个不同维度。Connection 选择身份和服务，workspace 选择数据命名空间，org 表示当前用户对组织的业务治理，admin 表示平台控制面。它们不能被一个“当前组织”或一个模糊的 `--admin` 开关替代。

`apemind api` 是 `gh api` 式的逃生舱，允许当前连接访问当前服务的 `/api/v2`，但不能覆盖认证头、Cookie、workspace 上下文或服务端授权。稳定、高频、面向普通用户的操作仍应有明确的高层命令；长尾和快速演进接口才走 `api`。

## 第一性原理：CLI 要表达什么

CLI 的价值不是把每个 HTTP 路由改名后暴露出来，而是把一个 Agent 的意图可靠地翻译为一次有边界的服务端请求。一个命令的最小语义必须能够回答：请求代表哪个身份、访问哪个空间、操作哪个真实资源、需要什么授权、成功或失败如何被机器判断。

因此，CLI 的默认请求上下文固定为：

```text
connection
  = 服务地址 + 凭据引用 + 凭据类型
identity
  = 服务端从 OAuth Access Token 或 API Key 解析出的主体
workspace
  = 当前用户明确选择的数据命名空间
authorization
  = 服务端按 token、scope、成员关系、角色和资源权限实时判断
```

客户端缓存的用户、组织和工作空间列表只是显示快照，不能代替服务端授权。workspace 切换不会改变登录账号、不会创建 API Key、不会扩大权限，也不会让一个组织的资源出现在另一个组织的默认结果中。

参数设计遵循正交原则，但正交不等于每个命令都接受全部参数。只有真正参与该请求语义的参数才应出现；例如 `org member list` 需要组织 ID，但不应接受一个会产生歧义的 `--workspace`，而 `knowledge list` 需要 workspace 选择。

## 用户、连接、工作空间和组织的边界

### Connection 是凭据连接，不是隐含的全局账号

Connection 是本地保存的一条服务连接记录，至少包含服务地址、凭据引用、凭据类型和可选的显示名称。它不保存明文令牌，也不把当前工作空间写成身份的一部分。

一个用户可以保存多个 OAuth connection，例如不同服务地址或不同 ApeMind 账号；也可以保存多个显式 API Key connection。`connection use NAME` 只改变后续命令使用的默认连接，不会登录、注销、切换服务端用户权限或修改其他连接。

OAuth connection 的业务请求使用该连接在当前进程中取得的 Access Token；API Key connection 的业务请求使用该连接明确保存的 API Key。认证失败、权限不足或资源不存在时，CLI 不自动换用其他 connection、浏览器 Cookie、SLOCK、环境文件或服务器环境密钥。

建议命令：

```bash
apemind connection list
apemind connection current
apemind connection use NAME
apemind connection remove NAME
apemind auth login --connection NAME --server https://apemind.ai
apemind auth connect --connection NAME --api-key-stdin
```

`connection list` 只显示服务地址、用户名摘要、凭据类型、状态、最近验证时间和后四位等非敏感信息。它不显示 Access Token、Refresh Token、Cookie 或完整 API Key。

### Workspace 是数据命名空间

Workspace 统一表示当前身份实际可访问的命名空间，可能包含遗留个人空间、组织空间，也可能为空。`workspace list` 返回服务端实际返回的空间及其角色、状态和能力摘要；`workspace use ID` 只写入本地默认选择。

```bash
apemind workspace list
apemind workspace current
apemind workspace use WORKSPACE_ID
```

workspace-aware 命令读取当前默认值，显式 `--workspace ID` 优先于默认值；一次命令的分页、重试、轮询和流式事件固定使用同一个 workspace。命令结束后，显式参数不改变默认 workspace。

使用某个 workspace 会影响知识库、文档、检索、模型、Bot、Chat、Turn、导入和导出等带数据命名空间的命令。它不影响 `auth status`、`connection list`、本地配置读取，也不改变组织管理和平台管理的身份权限。

跨 workspace 查询必须显式请求：

```bash
apemind knowledge list --all-workspaces
apemind knowledge search "发布流程" --all-workspaces
```

聚合结果必须保留 `workspace_id`、workspace 名称和来源；某个空间失败时报告部分失败，不能把成功空间的结果描述为完整结果。跨空间读取不能自动改变默认 workspace，也不能用于绕过单空间的写入确认。

### Org 是当前用户可治理的组织

普通 `org` 命令只面向当前用户可见且有成员关系或明确组织治理权限的组织。它不是平台组织目录，也不应因为当前用户有 site-admin 角色就返回全平台组织。

```bash
apemind org list
apemind org get ORG_ID
apemind org member list --org-id ORG_ID
apemind org role list --org-id ORG_ID
```

`org member`、`org role`、邀请、join link 和组织设置属于具体组织的治理操作。服务端必须在具体 `ORG_ID` 上重新检查当前用户的成员关系、组织角色和资源权限；CLI 不能根据本地显示的 `owner` 或 `admin` 字符串自行授予权限。

当前服务端普通组织路由把 site admin 作为全局绕过条件，`GET /api/v2/organizations` 因此可能返回平台所有组织。这是数据范围和产品语义错误，不能通过 CLI 端过滤修复。正确做法是分离普通用户和平台控制面接口：

```http
GET /api/v2/me/organizations
GET /api/v2/admin/organizations
```

如果兼容期必须保留旧路径，旧路径也必须明确选择一种语义并由服务端合同固定；不允许同一个 URL 根据隐藏角色改变返回集合而不在响应或帮助中说明。

### Admin 是显式的平台控制面

平台管理员能力可以支持，但不应污染普通用户命令。建议保留单一 `apemind` 二进制，在其中增加显式的 `admin` 命名空间：

```bash
apemind admin org list
apemind admin org get ORG_ID
apemind admin user list
apemind admin audit list
apemind admin usage summary
```

第一阶段只包装真实、稳定、重复出现的控制面工作流。服务端已有但低频、快速变化或仅用于运维的接口，先通过：

```bash
apemind api /api/v2/admin/organizations
```

访问，不因为“有一个 admin API”就制造几十个管理员命令。

`admin` 不是安全开关，也不授予权限。客户端不增加 `--admin` 来绕过普通命令的范围检查；服务端仍然根据 OAuth scope、管理员角色、许可证、组织状态和具体资源授权。没有管理员权限时，命令返回稳定的 `forbidden` 或 `admin_scope_required`，不会自动退回普通接口并返回看似成功的空结果。

暂不维护独立 `apemind-admin` 的原因是它会复制认证、配置、版本、帮助、输出和 Desktop/Agent 集成，并让 Agent 需要在两个入口之间猜测。只有当平台运维拥有与普通产品完全不同的发布节奏、凭据边界或安装渠道时，才重新评估拆分二进制。

## 本轮审计发现与设计调整

### 组织列表泄露了错误的数据范围

当前 CLI 的 `org list` 调用 `GET /api/v2/organizations`。服务端在 site admin 身份下使用全量组织查询，因此普通命令对管理员账号返回平台组织目录。

影响是 Agent 会把“我能治理的组织”“我作为平台管理员能观察到的组织”和“我加入的组织”混成一个列表，后续知识库查询、workspace 选择和写操作可能误选命名空间。

调整为：普通命令使用当前用户组织接口，平台目录使用显式 admin 接口；权限边界在服务端修正，CLI 不做客户端过滤。

### Workspace 语义本身正确，但必须成为默认边界

`/api/v2/me/workspaces` 按当前用户返回服务端 presence resolver 判定为实际可访问的工作空间，是 CLI workspace 发现的唯一来源；个人空间可能不存在，列表也可以为空。`workspace use` 只改变本地默认选择，每个业务请求仍需服务端重新校验成员关系。CLI 不读取个人数据表来推断空间，也不根据用户 ID 或旧 flag 拼接个人空间 ID。

调整为：所有 workspace-aware 命令统一读取该上下文；跨 workspace 必须使用显式 `--all-workspaces` 或逐空间调用；不再把组织列表作为知识库查询的隐式来源。

### API Key 列表的默认范围不清晰

CLI 会发送 workspace 上下文，但当前 `/api/v2/apikeys` 默认返回当前用户的全部 API Key；服务端已有 `org_id` 和 `personal_only` 查询参数，但 CLI 命令语义尚未把它们统一表达出来。

调整为：普通 `api-key list` 返回当前 connection 所属用户可见的 Key，并明确显示每个 Key 的绑定范围；`--workspace` 或 `--org-id` 只允许收窄范围。平台管理员查看全平台 Key 必须走 `admin` 命名空间或显式 admin API，不能让普通列表因为角色变化而扩大。

API Key 的创建仍要求 active organization membership；CLI 不自动创建隐藏 Key，也不把 OAuth 登录转成 API Key。连接型 API Key 是用户主动配置的另一条身份来源。

### Model 命令没有稳定传递 Workspace

当前 CLI 的 `modelCredentials()` 忽略 `WorkspaceID`，`model list` 调用 `/api/v2/me/models` 时不能保证使用当前 workspace；本地 model proxy 转发 `/api/v2/llm/chat/completions` 也需要检查 workspace header 是否被保留。

调整为：模型列表、模型调用、模型凭据和默认模型都明确区分个人配置、组织配置和平台 provider；workspace-aware 请求必须从同一个解析器得到 workspace，并在服务端再次校验。不能因为 `workspace use` 成功就声称模型调用已经绑定该空间，除非请求和响应都能证明绑定成立。

### OAuth Scope 与 CLI 命令树不一致

CLI 默认申请了 `organization.*`、`model.*`、`agent.*`、`chat.*`、`turn.*`、`knowledge.*` 和 `document.*` 等范围，而服务端当前 Desktop/CLI 支持列表主要包含 `profile`、`workspace.read`、`collection.read`、`knowledge.read`、`document.read` 和 `document.write`。

调整为建立一份逐命令授权矩阵，禁止用 blanket scope 掩盖缺口。每个命令必须能查到它需要的 scope、workspace 选择、服务端路由和最终角色权限；如果服务端尚未支持该 scope，CLI 应返回明确的 `scope_not_granted` 或 `capability_unavailable`，不能把权限错误伪装成空列表。

### MCP 的 Bearer 认证路径必须统一

CLI 的 MCP 调用使用当前连接的 Bearer Token，但 direct HTTP MCP 的旧认证入口曾把 Bearer 值当作 API Key 查询，并且存在 Cookie-only 或凭据回退的风险。

调整为：HTTP MCP 明确接受 OAuth Access Token 或调用方显式提供的 API Key；两者都必须通过同一个服务端授权内核解析身份、scope、workspace 和工具权限。Cookie 只参与浏览器页面授权，不参与 CLI/HTTP MCP 业务调用。认证失败必须发生在限流、额度扣减和工具执行之前，并区分 `401`、scope 不足的 `403` 和工具业务错误。

如果某个 MCP 工具暂时只支持 API Key，CLI 必须返回可诊断的 `mcp_auth_unsupported`，不能偷偷创建 API Key、读取浏览器 Cookie 或回退到服务器环境密钥。

### Bot、Chat 和 Turn 必须重复验证 Workspace

Bot 已有成员关系和权限内核，但 Chat 列表和详情主要按 `user_id + bot_id` 查询，必须确认每条读取和写入路径都重新验证 Bot 所属 workspace、当前成员关系和资源权限。

需要覆盖被移出组织后读取旧 Chat、Chat 导出、Turn evidence、附件、摘要、下一轮上下文和 Turn 写入等路径。API Key 创建的 Chat/Turn 还必须绑定 API Key connection 与创建时权限快照，后续请求不能换用 OAuth 或另一条 Key 读取历史。

### CLI 基础解析层仍然会制造 Agent 歧义

当前 Cobra 只用于帮助和补全，真实执行仍走旧的扁平解析器；因此部分子命令的 `--help` 不能工作，`config get/set` 的分发会匹配不到带参数的命令，自动分页也存在漏掉最后一页的风险。

调整为：命令注册、帮助、参数校验、补全和实际执行共用一棵命令树。分页器必须由服务端分页合同驱动，在确认没有 `next_cursor`、`Link` 或等价 continuation 后才结束；未知分页协议不得猜测已经完成。

## 命令分类与正交参数

### 稳定高层命令

高频、稳定、面向 Agent 的产品能力使用高层命令：

```text
auth
connection
config
workspace
org
knowledge
document
search
evidence
graph
web
agent
chat
turn
api-key
mcp
admin
```

`knowledge` 是正式的产品名称，`collection` 可以作为兼容别名；`workspace` 统一当前身份实际可访问的空间，个人空间属于可选遗留项；`org` 只表达当前用户的组织治理；`admin` 表达平台控制面。

### 正交全局参数

全局参数只表达跨命令共用的请求维度：

```text
--connection NAME
--workspace ID
--all-workspaces
--server URL
--format text|json|stream-json
--jq FILTER
--template TEMPLATE
--paginate
--timeout DURATION
```

不是所有命令都接受所有参数。`--all-workspaces` 只允许只读查询；`--workspace` 与 `--all-workspaces` 互斥；`--server` 只在连接解析阶段生效，不得让单次 raw API 请求把凭据发到另一个来源。

管理员命令可以额外需要 `--organization`、`--user`、`--role` 等资源参数，但不能用一个 `--admin` 布尔值把普通命令变成平台命令。

### `apemind api` 的边界

`apemind api` 的目标是像 `gh api` 一样提供稳定的通用入口：

```bash
apemind api /api/v2/workspaces/WORKSPACE_ID/knowledge-bases
apemind api /api/v2/admin/organizations --method GET
apemind api /api/v2/workspaces/WORKSPACE_ID/knowledge-bases \
  --method POST --input request.json --confirm --idempotency-key REQUEST_KEY
```

规则如下：

- 基础地址来自当前 connection；
- 默认只允许当前服务的 `/api/v2`；
- 认证头、Cookie、workspace header 由 CLI 生成，调用者不能覆盖；
- 服务端仍负责最终身份、scope、成员关系、角色、资源权限和许可证判断；
- 高风险写入需要明确确认和幂等键；
- 支持 stdin JSON、服务端分页、`--jq`、`--template` 和脱敏 `--verbose`；
- 路径 workspace 与显式 workspace 不一致时拒绝；
- 不把 raw API 返回的内部 `job` 或队列字段包装成统一 `task` 资源。

`api` 不是普通命令的替代品。Agent 高频使用、需要稳定错误解释和安全确认的能力仍应逐步获得高层命令；`api` 解决的是能力发现和服务端快速演进期间的覆盖问题。

## 命令到服务端授权矩阵

以下矩阵是实现每条命令时必须补齐的合同。表中的 scope 名称是目标命名；服务端未支持的范围必须在对应 PR 中补齐或明确标记不可用，不得默默放宽为全量权限。

| CLI 命令 | 默认数据范围 | 选择参数 | 目标 HTTP 能力 | 目标 OAuth scope | Admin 是否扩大范围 |
|---|---|---|---|---|---|
| `auth status` | 当前 connection | `--connection` | `/api/v2/me`、`/api/v2/me/workspaces` | `profile`、`workspace.read` | 否 |
| `connection list/use` | 本地连接记录 | connection name | 本地状态，不访问业务数据 | 无 | 否 |
| `workspace list` | 当前用户实际可访问的工作空间，列表可以为空 | connection | `/api/v2/me/workspaces` | `workspace.read` | 否 |
| `org list` | 当前用户所属或可治理的组织 | connection | `/api/v2/me/organizations` | `organization.read` | 否 |
| `org member/role` | 一个明确组织 | `--org-id` | `/api/v2/organizations/{id}/members` 等 | `organization.read` 或 `organization.write` | 否 |
| `admin org list` | 平台组织目录 | admin connection/context | `/api/v2/admin/organizations` | `admin.organization.read` | 是，且仍需服务端 admin 权限 |
| `knowledge list/search` | 当前 workspace | `--workspace` 或默认值 | workspace knowledge/search 路径 | `knowledge.read` | 否 |
| `document list/get/content` | 当前 workspace 的指定知识库/文档 | workspace、knowledge base、document | document read paths | `document.read` | 否 |
| `document create/update/delete` | 当前 workspace 的指定资源 | workspace、resource IDs、confirm | document write paths | `document.write` | 否，admin 也需业务授权 |
| `model list/use` | 当前 workspace 可用模型 | workspace | `/api/v2/me/models` 或 workspace model paths | `model.read` | 否 |
| `api-key list` | 当前用户可见的个人/组织绑定 Key | workspace 或 `--org-id` | `/api/v2/apikeys` with explicit filters | `apikey.read` | 否 |
| `api-key create/remove` | 当前用户拥有且有权管理的 Key | workspace/org, confirm | `/api/v2/apikeys` | `apikey.write` | 否，平台 Key 走 admin |
| `mcp tools call` | 当前 workspace 和工具 scope | workspace、tool | MCP HTTP/streamable HTTP | tool-specific scope | 否 |
| `admin ...` | 平台控制面资源 | admin resource selectors | `/api/v2/admin/*` | `admin.*` | 是，仍由服务端判断 |
| `api ...` | URL 指定的资源，但受当前 connection 和 workspace 限制 | path、method、workspace | `/api/v2/**` | 路由对应 scope | 只有显式 admin 路径和权限 |

矩阵中的“Admin 是否扩大范围”只表示命令命名空间和服务端路由不同，不表示管理员可以绕过资源权限。对于组织 owner、site admin、license admin 和服务运维角色，应在服务端合同中分别记录允许的资源集合和写入动作。

## 输出、帮助和 Agent 使用合同

每个命令和子命令都必须有自己的 `--help`，帮助中说明用途、必需参数、互斥参数、默认 workspace、认证要求、写入确认和可执行示例。静态帮助不依赖登录；动态能力发现才依赖当前 connection。

```bash
apemind org --help
apemind org list --help
apemind admin org list --help
apemind api --help
apemind capabilities --format json
```

交互终端默认使用可读表格或摘要；非 TTY 默认使用 JSON。机器输出保留 `request_id`、`server`、`connection`、`workspace` 和 `fetched_at`，列表保留 continuation 信息和来源空间。

`--json field1,field2`、`--jq` 和 `--template` 的投影顺序必须稳定：先取得完整、带来源的结构化结果，再做字段选择或模板投影。错误输出使用稳定的 `code`、`message`、`request_id`、`server`、`workspace` 和 `hint`；stderr 只输出脱敏诊断。

建议至少区分：`usage`、`not_authenticated`、`forbidden`、`scope_not_granted`、`workspace_not_found`、`resource_not_found`、`conflict`、`rate_limited`、`server_unavailable`、`mcp_auth_unsupported` 和 `confirmation_required`。退出码和机器代码不能依赖中文文案匹配。

Skill 只说明如何发现和选择命令：先确认 `auth status` 和 `workspace current`，再使用高层命令；查询失败时报告具体 workspace 和权限；写入先预览再确认；不读取凭据文件，不从其他 Agent 借身份，不把组织列表当成知识库范围。命令参数和当前能力由 `--help`、`capabilities` 和服务端返回实时决定。

## 认证与 MCP 合同

浏览器登录建立 OAuth connection。Access Token 只在 CLI 进程内存中使用，Refresh Token 保存在系统凭据库；Desktop、Agent 和 MCP 不读取浏览器 Cookie。OAuth 登录不创建隐藏 API Key，API Key 只有在调用方明确执行 `auth connect` 或提供进程级凭据时才进入连接解析。

REST 和 MCP 共用同一身份与授权内核。OAuth Access Token 需要校验签发者、受众、用途、scope 和连接服务；API Key 需要校验密钥状态、绑定范围和限制。两者都必须再检查 workspace、组织成员关系、资源权限和许可证。

HTTP MCP 不接受 Cookie-only，也不在 Bearer 失败后回退到 API Key、服务器环境变量或其他连接。凭证拒绝必须先于工具路由、限流、额度扣减和业务执行；通过认证后继续执行工具级授权和审计。

## 实施顺序和验收

### P0：先修正产品语义和授权边界

1. 服务端增加或明确 `/api/v2/me/organizations` 与 `/api/v2/admin/organizations`，让普通组织列表不再受 site admin 全局绕过影响。
2. CLI 修改 `org list`、`org get`、`org member` 和 `org role` 的路由与帮助，明确组织 ID 和 workspace 参数边界。
3. 统一 API Key 列表的 personal、organization 和 workspace 过滤语义，并为管理员 Key 目录保留显式 admin 路径。
4. 修复 model list、model proxy 和相关凭据请求的 workspace 传递。
5. 建立命令到 HTTP 路由、OAuth scope、workspace selector 和最终服务端权限的矩阵测试。
6. 让 direct HTTP MCP 明确支持 OAuth 或显式 API Key，拒绝 Cookie-only 和隐式回退。

### P1：修正 CLI 的发现和组合能力

1. 用真正的命令树同时驱动解析、帮助、补全和执行；不再让 Cobra 只负责帮助而让旧解析器负责执行。
2. 修复 `config get/set` 带参数分发、未知参数、互斥参数和建议命令。
3. 实现稳定的 `apemind api`、JSON 字段投影、jq/template、自动分页和机器错误合同。
4. 分页器只在服务端明确返回结束条件时停止，并覆盖空页、单页、多页和最后一页有数据的负例。
5. 提供 `capabilities`，区分 CLI 已实现、服务端已提供和当前 connection 已授权的能力。

### P2：按真实资源补齐业务能力

先补齐知识库、文档、检索、证据、导入、导出和资源级等待，再补齐 Agent、Bot、Chat、Turn、事件、审批、附件和分享。每个命令都直接对应服务端真实资源和状态；没有统一 Task 产品对象时，不新增 `task list/get/wait/cancel`。

组织成员、角色、API Key、用量、配额、模型和审计能力放在普通用户能力稳定之后，以 `org` 和 `admin` 的显式边界分别设计。低频或快速演进接口继续由 `api` 暴露，不机械生成整棵管理命令树。

### 验收判据

- 普通 site admin 执行 `apemind org list` 只看到自己加入或可治理的组织。
- `apemind admin org list` 没有 admin scope 时稳定返回权限错误，有权限时才返回平台目录。
- `workspace use` 只影响后续 workspace-aware 命令，不改变 connection、OAuth 身份或其他 workspace 的权限。
- `--all-workspaces` 只用于只读查询，结果保留来源，部分失败不会被隐藏。
- model、knowledge、document、Chat 和 Turn 请求的 workspace 与输出一致，成员被移除后后续请求被服务端拒绝。
- OAuth 和 API Key 连接不能互相读取不属于该 connection 的 Chat、Turn、证据、附件和导出历史。
- HTTP MCP 的认证拒绝发生在限流、额度和工具执行之前，并区分 OAuth、API Key、Cookie-only 和 scope 不足。
- 所有命令层级的 `--help` 都能显示真实参数；Cobra、补全和执行使用同一注册信息。
- 自动分页不漏掉最后一页，JSON 输出可由 Agent 稳定解析，错误退出码不依赖自然语言。

## 不属于本次设计的内容

本文不要求为服务端每个 `/api/v2` 路由生成一个高层命令，不要求维护第二个 admin 二进制，也不要求 Desktop 再实现一套业务 SDK、权限判断或 OAuth 刷新逻辑。

本文不创建新的统一 Task 资源，不把服务端内部 job、队列或一次 CLI 进程包装成跨资源公共对象。没有公开资源状态和取消合同的操作继续使用同步请求或原资源的状态接口。

## 持续执行 Goal 文案

```text
以 apecloud/apemind-desktop 的 docs/engineering-process/2026-09-24-apemind-cli-command-scope-and-admin-design.md 为当前 CLI 命令语义、组织/workspace/admin 边界和授权矩阵的权威设计，以 2026-09-14 和 2026-09-16 文档为统一身份、凭据、Desktop 集成、MCP 和 gh 能力背景，持续把 ApeMind CLI 及 aperag-enterprise 的 /api/v2 合同实现、合并、发布并完成真实验收。

先核对当前分支、主干、PR、CLI 制品、服务端部署版本和现有实现，保留已经正确且已验证的代码；把审计发现按“普通用户语义、服务端权限、CLI 命令树、输出/分页、MCP 认证、业务覆盖”分组，逐项完成，不把命令存在、CI 通过、PR 合并或工作流启动当成功能交付。

普通命令默认只表达当前 connection、当前用户、当前 workspace 和服务端实时授权。org list 只返回当前用户组织；平台目录必须使用显式 admin 命名空间或显式 admin API。不要因为 site admin 身份而扩大普通命令数据范围，不要在客户端过滤服务端已经泄露的全量结果。

保持单一 apemind 二进制。不要创建第二套 Desktop SDK、admin 二进制、凭据来源或隐藏 API Key。Desktop 只通过 CLI 进程合同调用；OAuth 使用 Access Token，API Key 只来自明确配置；HTTP MCP 只接受明确的 OAuth 或 API Key，不接受 Cookie-only，也不做隐式凭据回退。

先修正 /api/v2 的组织列表、workspace 传递、API Key 范围、model 请求、OAuth scope 和 MCP 认证合同，再修正 CLI 命令树、help、completion、config、api、分页、JSON/jq/template、错误码和 capabilities。后续按知识库、文档、检索、证据、Agent、Chat、Turn、治理和 admin 的真实资源逐项暴露；没有服务端真实资源时，不发明 task 命令或本地任务状态。

每项实现必须同时提供成功和权限负例：错误身份、错误 workspace、成员移除、scope 不足、Key 撤销、Cookie-only、分页最后一页、部分跨空间失败、写入未确认和服务端不可用。分别记录代码、合并、制品、部署和最终验收状态；未完成的范围继续推进，不把设计文档本身当成实现完成。
```
