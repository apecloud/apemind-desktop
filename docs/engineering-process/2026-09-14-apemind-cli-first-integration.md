# ApeMind CLI-first 集成设计

本文定义 ApeMind CLI、ApeMind Desktop 和 ApeMind 服务端的统一产品与技术边界，回答一个问题：如何让 DSH Agent 稳定地读写 ApeMind，同时只维护一套面向 Agent 的能力接口。

后续命令体验、通用 API、MCP 和业务能力扩展见 [ApeMind CLI 对标 gh 的能力分析与产品技术设计](2026-09-16-apemind-cli-gh-capability-design.md)。本文继续定义统一身份、凭据与进程调用边界；通用 API 的开放范围以该扩展设计为准。

## 现状与目标

ApeMind Desktop 是 DeepSeek Harness 的品牌化发行版。它的核心用户是 Agent，用户通过 Desktop 完成登录、配置和授权，Agent 通过 Desktop 内置的工具执行任务。ApeMind CLI 尚未正式发布，现有命令、认证和本地状态模型不承担兼容性责任。

目标产品模型是：

```text
ApeMind Desktop = ApeMind CLI 的图形化控制台 + DSH Harness 宿主
ApeMind CLI     = Agent 操作 ApeMind 的正式接口
ApeMind API     = CLI 使用的服务端协议
```

Desktop 中的登录、空间选择、知识库查询、文档写入和配置修改，最终都通过 ApeMind CLI 完成。Desktop 不维护一套独立的 ApeMind API 客户端，也不把插件内部 Remote 当成 Agent 的第二套能力入口。

## 核心决策

### CLI 是唯一的 Agent 能力面

Agent 使用 ApeMind 的唯一正式方式是执行 `apemind` 命令。Skill 负责说明命令用途和安全规则，CLI 负责认证、请求、权限、输出和退出码，服务端负责最终身份与权限校验。

```text
DSH Agent
    ↓ shell / process
apemind CLI
    ↓ OAuth access token
ApeMind /api/v2
```

Desktop 的 UI、设置项和后台任务也调用同一个 CLI。用户在 UI 中看到的状态，应当与执行 `apemind auth status --format json` 得到的状态一致。

### 产品只有一套 CLI，不区分 Desktop 模式

CLI 不提供 `--auth desktop`、`--auth cli` 等用户可见模式。Desktop 登录和终端登录都是 `apemind auth login`，区别只在于启动者是否有图形界面。

认证实现可以根据环境选择浏览器授权、设备授权、系统凭据库或自动化凭据，但这些是实现细节，不改变命令语义和输出合同。

### Desktop 不拥有第二份业务逻辑

Desktop 可以直接启动 CLI 子进程，读取其结构化输出。CLI 的命令、JSON schema、退出码和错误代码是 Desktop 与 Agent 共同依赖的合同。

CLI 内部可以使用由 OpenAPI 生成的客户端代码，但不另外发布或维护一个供 Desktop 使用的业务 SDK。OpenAPI 是服务端合同，CLI 是产品接口，两者的职责不同。

### 普通登录不创建 API Key

普通用户通过 OAuth 登录。登录不创建隐藏 API Key，不把浏览器 Cookie 当作长期凭据，也不从 SLOCK、其他 Agent 或旧 profile 自动寻找替代身份。

API Key 只作为明确的高级连接，用于自动化、CI 或用户主动选择的固定密钥场景。

## 版本命名长期规则

ApeMind Desktop 是 DSH 的品牌化发行版，应用版本必须跟随所锁定的 DSH 上游版本。只要 `upstream.lock` 指向的上游版本没有变化，品牌改动、CLI 更新或其他 overlay 改动都不能擅自改变 Desktop 的应用版本号。

发布时使用下面的版本边界：

| 信息 | 规则 |
|---|---|
| Desktop 应用版本 | 使用上游 DSH 的版本，写入 Electron 应用和安装包元数据 |
| 上游版本 | 由 `upstream.lock` 的 commit 及其对应版本确定 |
| GitHub Release 标签 | 默认与 Desktop 应用版本一致 |
| 同版本内部试用 | 使用 GitHub Release 的 prerelease、构建号或发布说明区分，不能伪造一个新的应用版本 |
| ApeMind CLI 版本 | 独立于 Desktop 版本，由 CLI 自己的发布版本管理 |

例如，Desktop 基于 DSH `0.1.5-rc.1` 时，应用版本和正式 Release 标签应保持 `0.1.5-rc.1`；内置 CLI 可以是 `v0.3.9`。如果同一应用版本需要多次内部试用，应通过 prerelease 或构建元数据区分，不能把 `v0.1.5-rc.8` 当作应用已经升级到该版本。

发布流水线必须在创建 Release 前检查应用版本、`upstream.lock` 对应版本和 Release 标签的一致性；CLI 版本只检查是否符合 Desktop 的 CLI lock，不参与 Desktop 应用版本计算。不得通过给 monorepo 或 Electron 应用追加品牌修订后缀来表达内部构建，避免破坏上游统一版本约束。

## 产品结构

### Desktop 的职责

Desktop 提供：

- ApeMind 登录入口；
- 登录状态、当前账号和当前空间展示；
- 工作空间切换；
- CLI 配置和版本状态；
- Agent 使用 ApeMind CLI 的 Skill；
- CLI 的结构化结果展示；
- 写操作前的用户确认界面。

Desktop 不提供：

- 独立的知识库 HTTP 客户端；
- 独立的 OAuth 刷新流程；
- 独立的组织权限判断；
- 另一套 Agent Tool API；
- 通过浏览器 Cookie 代替 CLI OAuth。

### CLI 的职责

CLI 是一个跨平台、可随 Desktop 分发的单二进制程序，负责：

- OAuth 登录和退出；
- 账号和连接状态；
- 工作空间管理；
- 知识库和文档读写；
- 结构化输出；
- 非交互执行；
- 幂等、重试、分页和错误转换；
- 请求审计上下文。

### 服务端的职责

服务端负责：

- OAuth 授权和令牌轮换；
- 用户、个人空间和组织空间；
- workspace 级权限；
- 知识库与文档 API；
- 写操作审计；
- 访问范围和数据隔离；
- `/api/v2` OpenAPI 合同。

## CLI 用户体验

### 登录

```bash
apemind auth login
apemind auth status --format json
apemind auth logout
```

`auth login` 默认启动系统浏览器完成 Authorization Code + PKCE。没有可用浏览器回调时，CLI 自动切换到设备授权，并输出验证地址和短码。Desktop 设置页调用相同命令，通过 `--format stream-json` 接收进度事件。

登录命令不把令牌输出到终端。`auth status` 只返回非敏感信息：服务地址、用户摘要、连接状态、当前工作空间和权限摘要。

### 连接

私有化部署需要支持多个服务地址，但不引入多个产品模式：

```bash
apemind connection list
apemind connection use production
apemind auth login --server https://apemind.ai
```

默认服务地址为 `https://apemind.ai`。环境变量 `APEMIND_SERVER_URL` 可以覆盖默认值，命令行显式参数优先级最高。连接配置保存服务地址和账号引用，不保存明文令牌。

### 工作空间

```bash
apemind workspace list --format json
apemind workspace current --format json
apemind workspace use <workspace-id>
```

工作空间统一表示个人空间和组织空间。每个命令默认使用当前工作空间，也支持显式 `--workspace`。服务端始终重新校验用户是否仍然属于目标空间。

工作空间列表需要返回：

- ID；
- 名称；
- 类型；
- 用户角色；
- 状态；
- 允许的能力；
- 最近同步时间。

不会把不同组织的知识库默认合并成一个无边界列表。Agent 需要跨空间查询时，先列出空间，再明确选择或逐空间执行查询。

### 知识库和文档

```bash
apemind knowledge list --format json
apemind knowledge search "发布流程" --format json
apemind knowledge get <knowledge-base-id> --format json

apemind document list --knowledge-base <id> --format json
apemind document get <document-id> --format json
```

第一阶段提供只读能力。写能力采用预览和确认流程：

```bash
apemind document update <id> --knowledge-base <kb-id> --input change.json --dry-run
apemind document update <id> --knowledge-base <kb-id> --input change.json \
  --confirm --idempotency-key <stable-request-key>
```

非交互环境中，写命令不等待终端输入。没有 `--confirm` 时返回结构化的 `confirmation_required` 和待执行变更，Desktop 或 DSH 再向用户展示确认。确认执行必须显式提供调用方生成的幂等键；同一个幂等键只能对应同一份请求内容，重试会返回原始结果，不会重复写入。

## 输出与进程合同

CLI 必须区分交互输出和机器输出。

```bash
apemind knowledge list
apemind knowledge list --format json
apemind knowledge list --format stream-json
apemind knowledge list --jq '.items[] | .name'
```

规则如下：

- stdout 只输出业务结果或结构化事件；
- stderr 只输出脱敏诊断；
- 非 TTY 且未指定格式时默认 JSON；
- 每个结构化结果包含 `request_id`、`server`、`workspace` 和 `fetched_at`；
- 分页结果包含 `next_cursor`；
- 不输出 Authorization header、Cookie、API Key 或 Refresh Token；
- 错误使用稳定的机器代码和用户可读消息；
- 退出码由错误类别决定，不根据自然语言判断成功失败。

建议退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 2 | 参数或命令错误 |
| 3 | 未登录或登录已过期 |
| 4 | 需要用户确认 |
| 5 | 没有工作空间权限 |
| 6 | 资源不存在或已失效 |
| 7 | 服务端限流 |
| 8 | 网络或服务端暂时不可用 |

这种设计借鉴 `gh` 的结构化输出和筛选能力，也借鉴 Claude Code 非交互模式对 JSON、流式事件和权限提示的处理方式。CLI 本身不运行第二个大模型；推理由 DSH Agent 完成，CLI 只执行确定性操作。

## 认证与凭据

### 统一身份合同

浏览器登录建立的是 OAuth 连接。该连接的所有需要身份的业务操作都使用 OAuth Access Token，包括 REST 读取、REST 写入和直接 HTTP MCP 调用；不在登录后换取、创建或隐藏一份 API Key。API Key 是调用方主动配置的另一种连接凭证，不是 OAuth 功能缺口的补救手段。

浏览器 Cookie 只参与网站登录和浏览器中的授权确认。授权完成后，CLI 持有自己的客户端授权；Desktop、Agent 和 CLI 不读取浏览器 Cookie 来调用业务接口。

```text
用户在浏览器登录并授权
        ↓
CLI 保存客户端授权、管理令牌刷新
        ↓
CLI 根据当前连接发送 OAuth Access Token 或显式配置的 API Key
        ↓
服务端验证凭证并建立唯一身份、授权范围和空间上下文
        ↓
REST 与 MCP 复用组织、角色、资源权限和业务服务
```

OAuth 解决用户对客户端的委托；API Key 服务明确选择固定密钥的集成和自动化。两者的凭证验证不同，业务权限判定必须复用。同一请求不得因为某个入口不支持当前凭证，就换用另一个账号、Cookie、其他连接或服务器环境中的 API Key。

本合同是目标行为，不表示已有接口全部完成 OAuth 接入。每个能力上线前都必须验证它的实际 HTTP 路由、scope、空间选择、资源权限和部署版本。缺口要修复或明确返回尚不可用，不能使用无边界的 `api.read` / `api.write` scope 开放所有接口。

### 连接选择与凭据来源

- 命令显式指定的连接优先于保存的默认连接；一次业务操作及其分页、重试和跨空间查询固定使用同一身份，不因并发切换默认连接而改变。
- OAuth 连接使用 Access Token；API Key 连接使用用户配置的 Key。认证失败不切换凭据来源，权限失败不切换账号或空间。
- 自动化可以由调用方显式提供进程级凭据。这与服务端替无凭据请求使用自己的环境 Key 不同。接入此能力时必须明确目标服务、来源优先级、冲突规则和诊断输出；不能从 `.env`、其他应用或其他 Agent 的目录搜集候选密钥。
- Desktop 默认沿用已选连接，不主动把 Token 注入 Agent 环境。用户没有明确选择另一种来源时，不因宿主机器上恰好存在其他凭据而改变 UI 展示的登录身份。
- `auth status` 展示实际服务、账号、连接、空间、凭据种类和来源，不显示 Token、Cookie 或完整 Key。环境凭据不自动持久化或覆盖已有登录。
- 正常调用只向 Agent 返回操作结果，不把凭据放进命令参数或模型上下文。这不是对同一操作系统用户下任意高权限进程的隔离保证。

### HTTP MCP 的认证边界

直接 HTTP MCP 仅接受调用方显式提供的一份 `Authorization: Bearer …`，其值可以是有效的 OAuth Access Token 或 API Key。`/mcp` 与 `/mcp/` 的受保护请求采用同一规则，包括初始化、工具发现、工具调用以及会话传输请求；匿名初始化不构成例外。公开的健康检查、协议认证元数据与 CORS 预检不提供业务数据，单独定义其公开行为。

| 请求 | 结果 |
| --- | --- |
| 有效 OAuth Access Token | 按会话有效性、授权 scope、当前空间和资源权限执行 |
| 有效 API Key | 按 Key 的身份、固定空间、collection/tool scope 和实时权限执行 |
| 只有 Cookie、缺少 Bearer、格式错误或重复认证头 | HTTP 401；不执行工具，也不扣减调用额度 |
| 无效、过期或已撤销的 Bearer，同时存在有效 Cookie | HTTP 401；Cookie 不参与身份选择 |
| 有效受限 Key，同时存在管理员 Cookie | 只按受限 Key 执行 |
| 无凭据，但服务器环境存在 API Key | HTTP 401；不使用服务器身份 |
| 有效 OAuth 身份但缺少所需 scope | HTTP 403；保留明确的授权不足语义 |
| 空间无权访问或资源不可见 | 遵循既有防枚举合同，不把它伪装成认证成功的空结果 |

认证错误在 HTTP 传输层返回，不依赖模型解析一句 MCP 工具错误。401 提供 `WWW-Authenticate`；OAuth 发现按 MCP 受保护资源元数据和授权服务器元数据合同实现。缺 scope、空间不匹配、许可证拒绝、限流和工具执行失败是不同层的问题，不全部改写成 401。

每次受保护请求重新验证身份、会话及空间绑定。MCP 会话 ID 不是登录凭据。校验 Token 的签发者、用途与目标服务，不能接受发给其他资源的令牌，也不能把用户令牌转发给无关第三方。

凭证错误必须先于工具调度、许可证业务能力检查、用户调用限流和计量额度扣减失败。测试同时检查拒绝响应和这些下游的零调用，不能只检查错误文案。通过认证后，既有许可证、限流、额度和资源授权仍全部生效。

无 HTTP 上下文的 stdio / 进程内调用可以保留由启动者明确提供凭据的合同；该路径不得成为 HTTP 认证失败后的回退。普通网站的 Cookie 登录不受此 MCP 入口规则影响。

### 权限与工作空间

认证只确认身份。允许执行的操作由客户端授权范围、账号状态、组织成员关系和角色、具体资源权限、API Key 附加限制以及产品治理规则共同决定，CLI 不能根据显示的角色名称自行授予权限。

OAuth 登录一次即可发现当前用户可访问的个人空间和组织。每次业务请求仍绑定一个明确空间；参数中的组织或资源不能越过该绑定。用户明确要求跨空间查询时，由 CLI 使用同一身份逐空间执行，保留来源和部分失败，不修改默认空间。

成员被移除、组织被停用、Key 被撤销、OAuth 会话被撤销后，后续请求应被服务端拒绝。本地空间快照和先前成功的请求均不替代实时校验。

### OAuth

CLI 是公开原生客户端，不使用 client secret。登录使用 Authorization Code + PKCE，浏览器回调只监听 `127.0.0.1` 的随机端口。设备授权作为无法回跳时的自动兜底。

Access Token 只保存在 CLI 进程内存。Refresh Token 保存到系统凭据库：

- macOS Keychain；
- Windows Credential Manager；
- Linux Secret Service。

没有系统凭据库时，使用加密本地文件，并在 `auth status` 中明确显示降级状态。文件权限是保护措施，不应被描述为加密。

Refresh Token 由 CLI 统一刷新和轮换。并发请求使用系统文件锁协调，锁覆盖服务端刷新、凭据写回与连接状态更新。刷新前持久化轮换意图，收到新令牌后先保存待恢复副本，再更新正式凭据。中断后优先恢复已保存的新令牌；无法确认旧令牌是否被消费时要求重新登录，不重放旧令牌。只有服务端明确拒绝该授权时才清理失效凭据；网络故障或凭据库暂时不可读不应被解释为退出成功。

### API Key

```bash
apemind auth connect --api-key-stdin
apemind connection list --format json
apemind connection remove <name>
```

API Key 从 stdin 读取，不出现在命令行参数、进程列表、shell history 或日志中。连接记录只保留服务地址、绑定工作空间、权限摘要和密钥后四位。

CLI 不自动从任何其他应用、SLOCK、下载目录、环境变量文件或未确认的 profile 猜测 API Key。

### 选型依据

`gh auth login` 的浏览器授权获得 OAuth Token，`--with-token` 和调用方显式设置的 `GH_TOKEN` 提供其他凭据来源；业务 HTTP 客户端统一选择凭据。复用的是用户委托、显式来源和统一客户端的结构，不照搬 GitHub 的 scope、Token 有效期或组织权限模型。

- [GitHub CLI 登录](https://cli.github.com/manual/gh_auth_login)
- [GitHub CLI 环境变量](https://cli.github.com/manual/gh_help_environment)
- [GitHub CLI OAuth 实现](https://github.com/cli/cli/blob/trunk/internal/authflow/flow.go)
- [OAuth Bearer Token：RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html)
- [原生客户端 OAuth：RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)
- [MCP HTTP 授权合同](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## 服务端 API 设计

服务端正式接口统一使用 `/api/v2`。接口名称不绑定某个客户端名称，Desktop 和 CLI 都是同一个公开原生客户端产品的使用方。

### OAuth 接口

推荐的正式命名如下：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/v2/oauth/authorize` | 展示浏览器授权页 |
| POST | `/api/v2/oauth/authorize/consent` | 提交授权同意或拒绝 |
| POST | `/api/v2/oauth/device` | 创建设备授权请求 |
| GET | `/api/v2/oauth/device/verify` | 展示设备码输入和确认页 |
| POST | `/api/v2/oauth/device/approve` | 提交设备授权同意或拒绝 |
| POST | `/api/v2/oauth/token` | 授权码、设备码或 Refresh Token 换取令牌 |
| POST | `/api/v2/oauth/revoke` | 撤销 Refresh Token 或设备会话 |

客户端 ID 使用 `apemind-cli`。`apemind-desktop` 不再出现在 OAuth URL、路由或协议字段中，因为 Desktop 是 CLI 的 UI 和宿主，不是另一种授权产品。

旧的 `/api/v2/auth/desktop/*` 接口可以作为迁移兼容入口，但新客户端不再依赖它。迁移完成后删除旧入口和相关命名，避免服务端长期维护两套协议。

### 当前用户和工作空间

```http
GET /api/v2/me
GET /api/v2/me/workspaces
```

`/me/workspaces` 返回个人空间和组织空间的统一投影。组织成员资格、角色、状态和能力由服务端决定，客户端只保存显示快照。

### 知识库

推荐面向产品语义使用 `knowledge-bases` 命名：

```http
GET /api/v2/workspaces/{workspace_id}/knowledge-bases
POST /api/v2/workspaces/{workspace_id}/knowledge-bases/search
GET /api/v2/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}
GET /api/v2/workspaces/{workspace_id}/knowledge-bases/{knowledge_base_id}/documents
```

如果服务端内部仍使用 `collection`，只在实现层映射。公开接口使用用户理解的“知识库”，避免 CLI、Desktop 和服务端产品术语不一致。

### 写接口

写接口需要独立 scope：

```text
workspace.read
knowledge.read
knowledge.write
document.read
document.write
```

每个写请求都必须支持：

- workspace 权限校验；
- 幂等键；
- 资源版本或 `If-Match`；
- 审计事件；
- 明确的错误代码。

服务端不信任 CLI 传入的角色、权限和用户身份，只信任令牌并重新查询成员关系。

## Desktop 与 CLI 的调用方式

Desktop 使用打包在应用内的 CLI，不依赖用户系统是否安装 CLI。

构建输入必须锁定 CLI 发布版本、源码提交和各平台制品的 SHA-256。打包入口下载并校验该制品，缺少 CLI 或校验失败时不得生成一个功能不完整的安装包。发布清单随二进制进入安装包，供验收核对。

设置页面通过进程接口执行：

```text
apemind auth status --format json
apemind workspace list --format json
apemind workspace use <id> --format json
```

登录页面执行：

```text
apemind auth login --format stream-json
```

DSH Agent 使用同一个二进制。Desktop 启动 Agent 时，将应用内 CLI 目录加入该 Agent 的 PATH，并注入默认连接配置。Agent 可以直接运行 `apemind`，无需理解 Desktop 的 IPC、Renderer Remote 或凭据文件。

Desktop 不把 Access Token 写入环境变量，不把 Refresh Token 传给 Agent，不创建一个“桌面专用 CLI 会话”。CLI 自己通过系统凭据库恢复登录态。

CLI 需要支持单实例刷新锁；多个 Agent 进程可以共享连接，但只有一个进程执行 Refresh Token 轮换。需要跨进程协调时使用系统锁文件或本地锁服务，不建立新的服务端令牌类型。

## Skill 设计

Desktop 随 CLI 安装一份 ApeMind Skill，内容保持短小，重点说明命令和安全边界：

```text
使用 ApeMind 时优先调用 apemind CLI。
查询前确认当前 workspace；结果中保留 workspace 和知识库来源。
不要读取凭据文件、Cookie 或 API Key。
不要用其他 Agent 或本地环境的身份替代当前 ApeMind 登录。
写操作先运行 --dry-run，再请求用户确认。
机器输出优先使用 --format json。
```

Skill 不写死服务端 URL、Token、组织列表或知识库名称。CLI 的 `--help`、能力发现和错误消息是实时事实来源。

## 技术实现选择

CLI 建议重写为 Go 单二进制：

- 适合 macOS、Windows、Linux 跨平台分发；
- 启动快，适合 Agent 高频启动；
- 无需用户安装 Node 或 Python；
- 系统凭据库集成成熟；
- 能随 Desktop 一起签名和更新；
- 便于实现稳定的 stdout、stderr 和退出码合同。

代码分层：

```text
cmd/                 命令和参数
internal/auth/       OAuth、设备码、Refresh Token
internal/credential/ 系统凭据库
internal/api/        OpenAPI 生成客户端与 HTTP 传输
internal/workspace/  工作空间上下文
internal/knowledge/  知识库和文档命令
internal/output/     text、json、stream-json、jq
internal/permission/ dry-run、确认和写操作策略
```

OpenAPI 生成代码在 CI 中校验，不手工修改。业务语义、CLI 命令和 Agent 输出由 CLI 代码维护。Desktop 不引用 CLI 的内部 Go 包，只调用稳定的进程合同。

## 安全边界

- 服务端是最终权限来源；
- CLI 不暴露 `auth token` 命令；
- stdout、stderr、遥测和崩溃报告不得含令牌、Key、Cookie、授权头或文档全文；
- 当前 workspace 显式显示并参与每次请求；
- workspace 切换不改变用户身份；
- 无权限时不自动切换到其他 workspace；
- API Key 连接不覆盖 OAuth 当前用户；
- 写操作默认需要用户确认；
- 批量删除和组织配置必须使用 dry-run、幂等键和审计日志；
- CLI 不读取其他 Agent 的凭据目录；
- Desktop 不把凭据传入模型上下文。

## 迁移与发布顺序

### 第一阶段：CLI 核心

- 选择 Go 和单二进制发布形态；
- 定义命令、JSON schema、错误代码和退出码；
- 实现 OAuth、设备码、系统凭据库和连接管理；
- 实现 `auth`、`workspace`、`knowledge` 只读命令；
- 默认服务地址为 `https://apemind.ai`；
- 删除 SLOCK 自动发现和隐式 API Key 回退。

### 第二阶段：Desktop 接入

- 将 CLI 二进制随 Desktop 打包；
- 设置页改为调用 CLI；
- 登录页改为读取 CLI 的 stream-json 事件；
- workspace UI 改为读取 CLI JSON；
- DSH Agent PATH 指向内置 CLI；
- 安装 ApeMind Skill。

### 第三阶段：服务端协议收敛

- 增加标准化 `/api/v2/oauth/*` 接口；
- 增加 `/api/v2/me` 和 `/api/v2/me/workspaces`；
- 增加 workspace 作用域的知识库 API；
- 将旧 `/api/v2/auth/desktop/*` 标记为兼容入口；
- 完成 Desktop 与 CLI 迁移后删除旧路由。

### 第四阶段：写操作

- 增加 knowledge/document 写 scope；
- 实现 dry-run、确认、幂等键和审计；
- 先支持单资源变更，再支持批量操作；
- 提供复用当前连接、认证和工作空间边界的 `apemind api` 通用入口；默认限定当前服务的 `/api/v2`，高风险写入仍需确认，不允许绕过权限或将凭据发送到其他来源。具体范围见[能力扩展设计](2026-09-16-apemind-cli-gh-capability-design.md)。

## 验收标准

### 用户体验

1. 用户只在 Desktop 中点击一次登录，CLI 和 Agent 立即可用。
2. Desktop 显示的账号、服务地址和当前 workspace 与 `apemind auth status --format json` 一致。
3. 浏览器无法回跳时自动提供设备码，不需要用户理解 OAuth 术语。
4. 用户可以看到个人空间和全部有效组织，并显式切换当前空间。
5. Desktop 和 Agent 执行同一个 CLI 命令得到一致结果。

### Agent 使用

1. 新会话只需知道 `apemind --help` 和 Skill，就能列出 workspace 和知识库。
2. 不需要读取凭据文件、环境变量或 SLOCK 状态。
3. `--format json` 的 schema 稳定，可由 Agent 可靠解析。
4. 401、403、限流、冲突和服务不可用都有稳定错误代码。
5. 写操作没有用户确认时会停止，不会等待不可见的终端输入。

### 安全与服务端

1. Access Token 不进入模型上下文、命令输出、日志或持久化业务状态。
2. Refresh Token 轮换并发安全，旧令牌重放会撤销会话。
3. 服务端根据 token 和 workspace 成员关系重新鉴权。
4. 组织切换不会扩大个人空间或其他组织权限。
5. 所有写操作可以通过审计记录追踪到用户、workspace 和 request ID。

## 不解决什么

本文不设计 ApeMind 的组织创建、邀请、计费、跨组织管理后台、模型供应商配置和新的知识库检索算法。这些能力在 CLI 具备稳定身份和 workspace 边界后，按独立需求扩展。

本文也不把 ApeMind CLI 设计成第二个大模型 Agent。自然语言规划、工具选择和多轮推理继续由 DSH 负责；CLI 只执行明确、可测试和可审计的操作。

## 读完后能回答的问题

- Desktop 为什么不需要独立的 ApeMind SDK？
- Agent 为什么直接使用 `apemind` 命令？
- 登录凭据由谁保存和刷新？
- 如何避免 Desktop、CLI、SLOCK 和 API Key 身份串线？
- 个人空间和组织空间如何隔离？
- OpenAPI、CLI、Skill 和 Desktop 各自维护什么？
- 写操作如何得到用户确认并留下审计记录？
