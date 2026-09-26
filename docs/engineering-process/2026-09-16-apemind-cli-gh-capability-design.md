# ApeMind CLI 对标 gh 的能力分析与产品技术设计

本文回答 ApeMind CLI 如何成为类似 `gh` 的统一客户端：当前使用体验有哪些差距，ApeMind 服务端有哪些能力尚未暴露，以及命令、API、MCP、Desktop 和 Skill 应如何分工。

本文延续 [ApeMind CLI-first 集成设计](2026-09-14-apemind-cli-first-integration.md) 的单一客户端、凭据和工作空间边界，并扩展通用 API、MCP、业务命令和能力发现方案。普通用户命令、organization/workspace/admin 语义和本轮服务端审计以 [ApeMind CLI 命令语义、权限范围与管理能力设计修订](2026-09-24-apemind-cli-command-scope-and-admin-design.md) 为准；个人空间可能不存在，空工作空间也是合法状态，长期数据边界以组织空间为主，具体过渡合同见 [个人空间可选化与组织工作空间迁移设计](2026-09-26-personal-workspace-transition.md)。能力差距分析保留 2026-09-16 的调查快照，不作为今天的完成清单；建议命令和事件示例属于目标设计，不代表已实现。具体参数和输出合同需要在实现对应能力时定稿。ApeMind 当前公开的是工作空间、知识库、文档、Chat、Turn、导入和导出等领域资源，没有统一的 Task 产品对象；CLI 只映射这些真实资源和服务端事件，不把一次命令执行包装成新的 `task` 资源。

当前系统没有统一的 Task 产品对象，因此本文所有“等待”“观看”“取消”都指向具体的服务端资源。CLI 的公共命令、JSON 字段、事件类型和本地状态不能使用一个跨资源的 `task` 名称来代替这些资源；需要统一的地方统一的是传输、错误、分页和输出机制，不是业务对象。

后续实现以 CLI 及其服务端合同为主线，已有功能以主干代码、发布制品和验收证据核对。Desktop 只跟随登录、CLI 打包与调用、结构化结果展示的必要变化；独立业务页面和外观调整不属于本阶段交付范围。

认证以 CLI-first 设计的[统一身份合同](2026-09-14-apemind-cli-first-integration.md#统一身份合同)为准：Desktop 浏览器登录的所有业务调用使用 OAuth Access Token；API Key 是显式配置的另一种来源；REST 与 MCP 共用身份和权限检查，HTTP MCP 不接受 Cookie-only，也不回退到服务器环境凭据。接口尚未开放 OAuth 的缺口必须逐项修复，不能以自动创建 Key 或放宽 scope 替代。

## 现状与结论

`apemind-cli` 的方向应该是“像 `gh` 一样成为 ApeMind 的统一命令行客户端”。当前实现还处于“Desktop 登录状态的知识库读写工具”阶段。它已有安全的身份和凭据基础，却缺少 `gh` 最关键的产品能力：稳定命令语言、完整帮助系统、通用 API 入口、可组合输出、对服务端既有状态和事件的等待能力，以及广泛的服务能力覆盖。

本轮调查实际使用了当前 CLI，并对照本机 `gh 2.89.0`。当前 `apemind` 已提供以下基础命令：

```bash
apemind auth status --format json
apemind workspace list --format json
apemind knowledge list --format json
apemind knowledge search "..."
apemind document list --knowledge-base ID
apemind document content DOCUMENT_ID --knowledge-base ID
```

本轮实测中，登录状态正常，当前账户可看到 6 个工作空间，当前空间知识库列表返回 5 个结果。这个结果证明本轮账户下的认证、工作空间发现和基础读取链路可用，不代表已完成所有跨平台、写入和故障恢复场景的验收。

代码调查依据为 `aperag-enterprise` 中的 CLI 命令入口 `tools/apemind-cli/internal/nativecli/root.go`、CLI README、服务端 OpenAPI 和 MCP 注册表。调查快照中的 OpenAPI 包含 304 个路径，其中 296 个为 `/api/v2` 路径，共有 384 个 HTTP 操作；MCP 注册表列出 17 个内置工具。接口存在不等于当前 CLI OAuth 身份已经能够调用，后续接入必须同时验证认证、scope、空间上下文和部署状态。

## 一、gh 真正解决的是什么

`gh` 提供了一套稳定的命令行协议：

```text
gh <领域> <动作> [对象] [参数]
```

例如：

```bash
gh pr list
gh pr view 123
gh issue create
gh repo clone owner/repo
gh run watch
gh api repos/{owner}/{repo}/issues
```

### 1. 命令树是可发现的

```bash
gh auth --help
gh pr --help
gh pr create --help
gh api --help
```

每一级都有自己的帮助、参数校验、示例和说明。

当前 `apemind` 的问题是：

```bash
apemind auth --help
apemind document update --help
```

都会返回顶层帮助。解析器通过前两个命令单词分发操作，没有真正的命令树。

这对 Agent 是功能问题。Agent 无法可靠知道：

- 当前命令接受哪些参数；
- 哪些参数互斥；
- 哪些参数是必需的；
- 是否支持输入文件；
- 写操作的确认语义是什么；
- 当前版本到底支持哪些能力。

### 2. 有通用 API 入口

`gh api` 是整个 `gh` 的扩展基础：

```bash
gh api repos/{owner}/{repo}/issues
gh api -X POST repos/{owner}/{repo}/issues -f title='...'
gh api --paginate repos/{owner}/{repo}/issues
gh api ... --jq '.[].title'
gh api ... --template '...'
```

这意味着 GitHub 新增一个受支持认证方式保护的 API 后，调用者通常可以通过 `gh api` 使用，而不必等待 `gh` 增加专用命令。

当前 `apemind` 没有 `api` 命令。它只能调用已经写死在 `root.go` 中的命令。当前实现实际只覆盖：

- 认证；
- 连接；
- 工作空间；
- 知识库列表、详情、搜索；
- 文档列表、详情、内容读取；
- 文档内容更新。

当前生成的 Go API 客户端也只有少量请求构造函数，远远没有覆盖服务端能力。

这是最大的结构性缺口。

### 3. 输出可以同时服务人和程序

`gh` 默认给人看：

```text
#123  Fix login flow       feature/login
#124  Add API support      main
```

需要机器处理时再显式使用：

```bash
gh pr list --json number,title,author
gh pr list --json title --jq '.[].title'
gh pr list --json ... --template '...'
```

当前 `apemind` 的 `--format text` 实际上只是缩进 JSON：

```json
{
  "items": []
}
```

这会导致两个问题：

- 人类阅读体验差；
- Agent 需要处理大量包装字段和无关字段。

当前 `--jq` 只对 `data` 做筛选，也没有 `--json field1,field2` 和 `--template`。

建议最终支持：

```bash
apemind knowledge list
apemind knowledge list --json id,name,status
apemind knowledge list --jq '.items[] | .name'
apemind knowledge list --template '{{range .items}}{{.name}}{{"\n"}}{{end}}'
```

保留现有 JSON envelope（包含请求上下文的结果对象）作为 `--format json` 的稳定模式，增加面向命令结果的简洁 JSON 模式。字段选择、模板和 jq 的处理顺序需要形成统一合同；跨空间结果即使投影为简洁输出，也必须保留足以识别来源的字段。

### 4. 有统一配置和环境模型

`gh config` 管理：

- 默认浏览器；
- 编辑器；
- 分页器；
- 交互提示；
- 颜色；
- HTTP socket。

账号与主机还通过 `gh auth` 和环境变量统一管理。

当前 `apemind` 有：

- `APEMIND_SERVER_URL`；
- `APEMIND_CONFIG_DIR`；
- `APEMIND_VAULT_FD`；
- 连接和工作空间状态。

当前凭据设计已包含系统凭据库、刷新锁和刷新失败恢复，但缺少：

```bash
apemind config list
apemind config get KEY
apemind config set KEY VALUE
apemind config clear-cache
```

因此用户和 Agent 缺少统一方式来诊断：

- 当前默认服务地址；
- 当前默认连接；
- 当前工作空间；
- 是否启用交互；
- 当前使用的 CLI 版本、可执行文件位置和配置目录；
- 当前缓存和能力清单来自哪里。

这些诊断不需要引入 Desktop 专用模式。

### 5. 有补全、别名和扩展机制

`gh` 支持：

```bash
gh completion -s zsh
gh alias set ...
gh extension list
gh extension install ...
```

当前 `apemind` 都没有。

补全对于人类不是核心，但与命令树共享的元数据对 Desktop 命令生成、Agent 命令发现和 IDE 集成很有价值。别名也有价值，例如：

```bash
apemind collection list
```

可以作为：

```bash
apemind knowledge list
```

的兼容别名。

扩展机制暂时不应优先做。ApeMind 目前能力本身尚未稳定覆盖，先把核心命令、API 入口和 MCP 入口做好。

## 二、当前 apemind-cli 做得好的地方

这部分不应该重写掉。

### 1. 凭据安全性

当前实现具备：

- OAuth 和设备码登录；
- Access Token 只保存在进程内存；
- Refresh Token 使用系统凭据库；
- macOS Keychain、Windows Credential Manager、Linux Secret Service；
- 多进程刷新锁；
- Refresh Token 轮换恢复；
- 不读取浏览器 Cookie；
- 不读取其他 Agent 的凭据；
- 连接和工作空间隔离；
- 服务端每次重新校验权限。

这些是正确的基础设施，应保留。各平台的运行验收仍需与代码中的支持能力分开记录。

### 2. 工作空间边界设计是正确方向

当前请求会带工作空间上下文，服务端也会重新检查成员关系和权限。

这是 ApeMind 和 GitHub 的重要区别之一：

- GitHub 通常以 repository、organization 为主要资源上下文；
- ApeMind 必须把当前身份实际可访问的工作空间作为一等边界；遗留个人空间是可选项，长期以组织空间为主；
- Agent 不能因为某个空间访问失败，就自动切换到另一个空间；
- 不能为了“找到结果”偷偷遍历所有组织。

当前的显式 `--workspace` 设计是正确的，只是还需要更好的聚合能力和输出。

### 3. 写操作的预览和幂等设计是正确的

当前文档更新提供预览：

```bash
apemind document update ID \
  --knowledge-base KB_ID \
  --input change.json \
  --dry-run
```

确认时使用：

```bash
apemind document update ID \
  --knowledge-base KB_ID \
  --input change.json \
  --confirm \
  --idempotency-key change-123
```

这个模型为 Agent 的写操作提供明确边界。

相同的确认、版本校验、幂等和审计原则应扩展到高影响写操作：

- 删除知识库；
- 删除文档；
- 上传文档；
- 修改 Bot；
- 修改组织成员；
- 创建 API Key；
- 发布知识库；
- 发送 Agent Turn；
- 执行管理操作。

具体操作按风险定义确认和预览内容，不机械地要求所有读取或普通调用都增加确认步骤。已有用户授权可以由 Desktop 或调用方转化为明确执行参数；CLI 不等待不可见的终端输入。

## 三、当前 CLI 与 gh 的差距

| 能力 | gh | 当前 apemind | 判断 |
| --- | --- | --- | --- |
| 命令级帮助 | 完整 | 只有顶层帮助 | 必须修复 |
| shell 补全 | 有 | 没有 | 应补齐 |
| 认证 | 完整 | 安全基础较好 | 保留并补诊断 |
| 多主机、多账号 | 有 | 有连接模型 | 需要统一体验 |
| 配置管理 | 有 | 没有 | 必须补齐 |
| 通用 API | `gh api` | 没有 | 最高优先级 |
| JSON 字段选择 | 有 | 没有 | 必须补齐 |
| jq | 有 | 有，但只作用于 `data` | 扩展 |
| Go template | 有 | 没有 | 应补齐 |
| 自动分页 | 有 | 手动 cursor | 必须补齐 |
| 人类文本输出 | 表格和摘要 | 缩进 JSON | 必须修复 |
| 浏览器跳转 | `browse` | 只有登录跳转 | 应补齐 |
| 状态和事件等待 | `run watch` 等 | 基本没有 | 必须补齐，但沿用服务端资源语义 |
| 扩展 | 有 | 没有 | 后置 |
| 领域覆盖 | GitHub 资源广泛覆盖 | 仅知识库有限读写 | 严重不足 |
| API 新增后的可用性 | 可通过 `gh api` 调用适用接口 | 必须改 CLI | 严重不足 |
| Agent 使用体验 | 命令和输出稳定 | 命令发现困难 | 必须修复 |

## 四、服务端已经有很多 CLI 没暴露的能力

调查快照中的服务端 OpenAPI 文件包含：

- 304 个路径；
- 296 个 `/api/v2` 路径；
- 384 个 HTTP 操作。

此外，服务端注册了 17 个内置 MCP 工具。

这些数量描述调查时的接口规模，不是产品覆盖率。不同路径的重要性不同，HTTP 操作数量也不能与 CLI 叶子命令数量直接相除。当前 CLI 只覆盖服务端能力的一小部分。

### 1. 知识库和文档

服务端已有大量知识库能力，但 CLI 目前只有查询和文档内容更新。

缺失或不完整的能力包括：

- 知识库创建；
- 知识库更新；
- 知识库删除；
- 知识库发布；
- 文档上传；
- 文档导入；
- 文档预览；
- 文档下载；
- 文档删除；
- 文档索引状态查询；
- 文档等待；
- 文档重新解析；
- 文档重建索引；
- 文档版本和冲突处理；
- 知识库设置；
- 知识库导出；
- 知识库分享；
- Marketplace 知识库订阅。

历史 CLI 曾经有较完整的 collection/document 命令，当前 native CLI 收缩后，这些能力没有迁移回来。

不建议直接把历史命令全部原样恢复。应该复用历史的领域边界，重新统一参数、输出、权限和服务端已有状态模型。CLI 不把所有异步操作包装成一个新的 `task` 资源。

### 2. 检索和证据能力

服务端 MCP 已经提供：

- `list_collections`；
- `list_documents`；
- `get_collection_metadata`；
- `get_document_metadata`；
- `read_document`；
- `read_document_chunks`；
- `read_evidence_refs`；
- `search_knowledge`；
- `grep_documents`；
- `diff_documents`；
- `analyze_knowledge_image`；
- 图谱实体搜索；
- 图谱路径查询；
- 图谱扩展；
- 网页搜索；
- 网页读取。

当前 CLI 只提供有限的 `knowledge search`，没有把证据链、原文分段读取、章节扩展、差异比较、图谱和网页能力充分暴露出来。

这正是 Agent 最需要的部分。

建议分成两个入口。高频操作通过稳定命令提供：

```bash
apemind search ...
apemind evidence ...
apemind graph ...
apemind web ...
```

同时提供通用 MCP 入口：

```bash
apemind mcp tools list
apemind mcp tools describe search_knowledge
apemind mcp tools call search_knowledge --input request.json
```

高频能力做成稳定高层命令，低频或快速演进能力通过 MCP 入口使用。两种入口复用服务端同一份业务实现，不能各自实现一套搜索算法。

MCP 接入需要验证现有 OAuth 令牌是否被传输层接受、如何绑定 workspace，以及工具依赖的运行上下文是否可用于原生客户端。缺失能力应在服务端补齐；不能从浏览器复制 Cookie，也不能自动创建替代 API Key。

HTTP 认证失败、scope 不足与 MCP 工具执行失败必须可区分。受保护请求的 401/403、认证发现与匿名请求边界遵循[HTTP MCP 的认证边界](2026-09-14-apemind-cli-first-integration.md#http-mcp-的认证边界)，不把错误字符串或当前实现的偶然行为当成产品策略。

### 3. Agent、Bot、Chat 和 Turn

服务端已有：

- Bot 生命周期；
- Agent 模板；
- 子 Agent；
- Chat；
- Turn；
- Turn 事件流；
- Turn 取消；
- 工具调用同意；
- 用户补充信息；
- 附件；
- 导出；
- 分享；
- 公共分享；
- Turn 分享；
- HTML/PDF 等产物分享。

CLI 按服务端资源逐项覆盖这些能力；命令名、参数和授权范围必须与已经实现的
CLI 合同一致，不能继续使用历史 CLI 中的另一套参数。

目标是让 Desktop 的 ApeMind 图形入口和 Agent 能通过同一 CLI 契约使用这些服务端能力。

建议最终支持：

```bash
apemind bot list [--workspace ID]
apemind bot get BOT_ID [--workspace ID]
apemind chat create --bot-id BOT_ID [--workspace ID] [--dry-run | --confirm]
apemind chat list --bot-id BOT_ID [--workspace ID]
apemind chat get CHAT_ID --bot-id BOT_ID [--workspace ID]
apemind turn create --chat-id CHAT_ID --query "..."
apemind turn watch TURN_ID --chat-id CHAT_ID [--after-sequence N]
apemind turn cancel TURN_ID --chat-id CHAT_ID
apemind turn approve ...
apemind turn respond ...
```

`chat create` 使用单独的 `chat.write` 授权。CLI 默认只生成创建预览，
明确传入 `--confirm` 才请求服务端；`chat list` 和 `chat get` 继续使用
`chat.read`。`turn create`、`turn watch` 和 `turn cancel` 分别使用服务端
Turn 的写入、事件和取消合同，不把 Chat 或 Turn 包装成新的客户端任务。

创建 Turn 成功只代表服务端接受请求，不能等同于 Turn 已经结束。流式 Turn 应该提供稳定的事件协议，例如：

```json
{
  "type": "turn.event",
  "sequence": 12,
  "event": "tool_call",
  "data": {}
}
```

同时保留统一的身份和来源上下文，并提供以下语义：

```text
--follow
--after-sequence
--timeout
--cancel-on-interrupt
```

连接断开、停止观看和取消 Turn 必须区分。事件重连、授权同意和补充信息接口也需要支持 CLI 的认证方式。CLI 可以提供 `turn watch`、`turn wait` 或 `document wait` 这样的资源命令，但不提供跨资源的 `task list`、`task get` 或 `task cancel`。

### 4. 异步能力的边界：沿用服务端资源，不新增 CLI task

服务端当前并没有一个覆盖索引、导入、导出、Turn 和同步操作的统一任务资源。CLI 不应为了让命令看起来统一，就在客户端虚构一个 `task` 领域，也不应把它作为内部状态表、事件类型或帮助文案中的通用名。这样会产生第二套状态机、重复的权限判断和无法与服务端事实对应的任务 ID。

命令设计遵循下面的规则。这里的“等待命令”是一次命令执行过程，不是一个可以被列出、读取或取消的 CLI 资源：

- 服务端返回文档索引状态时，由 `document get/status/wait` 等资源命令读取或等待；没有取消接口时不提供 `document cancel`，停止等待也不代表停止索引；
- 服务端实际提供独立的导入或导出对象时，在对应资源下提供查询与等待，复用其 ID 和状态字段；如果服务端没有独立对象，就沿用文档、知识库等已有资源，不虚构导入或导出对象；
- Agent 执行使用 `turn watch`、`turn wait` 和 `turn cancel`，事件序号和 Turn 状态以服务端为准；
- 服务端只支持一次请求和最终结果时，CLI 直接返回结果，不添加本地任务层；
- 只有服务端未来公开统一任务资源后，CLI 才映射该资源，并保持服务端字段和状态语义，不再套一层自定义模型。

等待命令可以由 CLI 统一实现轮询、退避、超时和中断处理，但这些是客户端行为，不构成公共 API 资源。每个命令必须说明它等待的是哪个服务端资源、使用哪个状态字段、哪些状态代表成功、失败或需要人工处理。服务端内部的导出记录、抓取作业或队列任务可以按既有接口暴露，不因内部出现 `task` 或 `job` 字样就统一成新的 CLI 公共领域。

实现每个等待命令前，必须在命令帮助和结构化输出中回答三个问题：

1. 它等待的服务端资源是什么，资源 ID 从哪里来；
2. 哪些服务端状态表示成功、失败、继续等待或需要人工处理；
3. 用户按下中断后，CLI 停止了哪一部分，服务端是否仍会继续执行。

如果这三个问题无法由现有 `/api/v2` 合同回答，就先补齐服务端资源或事件合同，或者让命令直接返回最终响应；不要用本地生成的 ID、临时文件或隐藏线程把缺失的服务端状态伪装出来。

### 4.1 Chat 历史必须跟随 API Key 连接边界

CLI 的 API Key 连接是一个明确的自动化身份。一个用户即使处在同一个工作空间，也不能用 Key B 读取 Key A 创建的 Chat 历史，更不能把 Key B 的旧回答、输入、摘要、附件或证据带入新 Turn。服务端在 Chat 上保存创建连接的 Key 身份和权限快照；CLI 只负责携带当前连接，不能自行绕过这个检查。

当当前 Key 仍是同一个连接且权限覆盖创建时快照时，CLI 可以继续使用该 Chat。Key 权限收窄、连接切换、Key 撤销或旧历史缺少可靠权限来源时，CLI 应把服务端的拒绝原样转换为可操作错误，并建议新建 Chat。OAuth 连接可按用户当前权限读取这些 Chat，但 OAuth 也不会把其更宽的历史自动暴露给受限 API Key。

这一条适用于 `chat list/get/export`、`turn list/toc/get/evidence`、附件、摘要和 Turn 历史组合；检查必须发生在模型调用、配额扣减和业务写入之前。CLI 不保存另一套历史权限表，也不把这类边界包装成 `task`。

### 5. 组织和治理能力

服务端已有：

- 组织；
- 组织成员；
- 角色；
- 邀请；
- Join Link；
- API Key；
- 配额；
- 限流；
- 审计；
- 用量；
- 管理员用户；
- 模型账户；
- 模型用途；
- Marketplace；
- 组织设置。

当前 CLI 基本没有这些能力。

普通用户及具备相应权限的组织管理者至少需要：

```bash
apemind org list
apemind org get ID
apemind org member list
apemind org invite accept
apemind api-key list
apemind api-key create
apemind api-key revoke
apemind usage show
```

API Key 创建需要单独设计密钥交付方式，避免完整密钥默认进入 Agent 输出或日志。

平台管理员命令必须单独分组：

```bash
apemind admin ...
```

能力可用性和执行权限以服务端真实权限为准，不能靠 CLI 自己判断“是不是管理员”。静态帮助应保持离线可用，权限不足时给出明确错误和恢复建议。

### 6. 模型、提示词和配置能力

服务端还暴露了：

- 模型提供商；
- 模型账户；
- 模型列表；
- 模型用途；
- 用户提示词；
- 系统提示词；
- Bot 提示词；
- 解析器配置；
- 检索配置；
- 网页搜索配置；
- 运行时默认值；
- 标签；
- 嵌入映射。

这些不应该全部直接做成顶层命令。应该按使用者分层：

- 普通用户：Agent、知识库、文档、搜索、Chat；
- 组织管理员：成员、角色、模型、配额、API Key；
- 平台管理员：系统配置、审计、限流、运行状态；
- Agent：在当前身份权限内执行检索、证据读取、文档读写和 Turn 操作。

## 五、最合理的整体架构

建议把 ApeMind CLI 设计成四层。

### 第一层：稳定的高层命令

这是日常使用的命令，参数和输出需要长期稳定：

```text
auth
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
usage
```

命名建议：

- `knowledge` 为正式名称；
- `collection` 作为别名；
- `agent` 为正式名称；
- `bot` 作为兼容别名；
- `search` 作为 `knowledge search` 的便利入口；
- `workspace` 统一表示当前身份可访问的空间，可能是遗留个人空间、组织空间，也可能为空；
- `org` 作为组织治理入口。

### 第二层：通用 REST API

必须增加类似 `gh api` 的：

```bash
apemind api <path>
```

建议支持：

```bash
apemind api /api/v2/workspaces/{workspace}/knowledge-bases
apemind api ... --method GET
apemind api ... --field key=value
apemind api ... --input request.json
apemind api ... --paginate
apemind api ... --jq '.items[] | .name'
apemind api ... --template '...'
apemind api ... --include
apemind api ... --verbose
```

默认规则：

- 基础地址来自当前连接；
- 默认限制在当前连接的 `/api/v2`；
- 不允许通过参数修改认证头或把凭据发送到其他来源；
- 不输出 Access Token、Refresh Token、Cookie 和 API Key，`--verbose` 同样需要脱敏；
- 高风险写入要求显式确认；
- 支持从 stdin 读取 JSON；
- 支持服务端分页协议；
- 保留请求 ID 和工作空间上下文；
- 路径中的工作空间与显式参数不一致时拒绝执行；
- OAuth scope 和服务端权限仍然生效，通用入口不绕过鉴权。

这样，当服务端新增接口且支持当前认证和权限合同时，Agent 可以使用通用入口，不需要等待 CLI 增加专用命令。

`api` 的支持范围必须包含已有分页类型的明确适配。不能对未知分页协议猜测“已经取完”，也不能把 401、403、404 都描述成资源不存在。

### 第三层：MCP 能力入口

MCP 与 REST 的职责不同：

- REST 适合资源生命周期和精确写入；
- MCP 适合 Agent 检索、证据、图谱和工具调用；
- Skills 只负责告诉 Agent 什么时候调用哪种能力；
- Skills 不应该承担认证、权限、请求构造和数据一致性。

建议提供：

```bash
apemind mcp tools list
apemind mcp tools describe TOOL
apemind mcp tools call TOOL --input request.json
apemind mcp resources list
apemind mcp guide
```

Agent 不需要自己拼 MCP 协议，也不需要读取 Desktop 内部对象。

OpenAPI 继续作为 REST 传输合同；MCP 的工具定义和 schema 作为工具调用合同。CLI 复用它们，不再维护第三份手写接口说明。

### 第四层：Desktop 集成

Desktop 应该是 CLI 的图形化语法糖，同时区分公开契约和内部实现：

- Agent 通过 `apemind` 命令调用；
- Desktop UI 通过 CLI 的进程合同调用同一套核心；
- 认证、连接、工作空间、权限、错误和写入语义只有一份；
- Desktop 不应维护第二套 ApeMind SDK；
- Desktop 不应直接读取 OAuth Token；
- Desktop 不应自己拼接 `/api/v2` 请求。

实现上先使用子进程调用 CLI，统一使用 JSON 或 JSON Lines。后续如果启动开销和流式交互成为问题，再评估本地 JSON-RPC/stdio 服务，并复用同一个 Go 核心。没有实际瓶颈时，不预先引入守护进程。

对外只有一个 ApeMind 客户端契约；Desktop、Agent、终端都是不同调用方式。

## 六、是否要把 296 个 API 全部做成命令

不应该。

机械映射会产生三个问题：

1. 命令数量过大，帮助系统难以使用；
2. 服务端内部和管理员接口会污染普通用户体验；
3. API 一变，CLI 命令树全部跟着不稳定。

推荐的划分是：

- 高频、稳定、面向用户的能力：高层命令；
- 快速演进或低频能力：`apemind api`；
- 面向 Agent 的检索和工具能力：`apemind mcp`；
- 管理和运维能力：同一 `apemind` 二进制下显式的 `admin` 命名空间；具体边界见 [命令语义修订](2026-09-24-apemind-cli-command-scope-and-admin-design.md)；
- 未授权能力：由服务端权限拒绝，不在 CLI 中硬编码假权限。

## 七、需要优先修复的 CLI 基础问题

### 第一优先级

1. 重写命令解析层，采用真正的命令树；
2. 支持每个命令和子命令的 `--help`；
3. 支持 shell completion；
4. 支持 `config`；
5. 支持人类可读表格；
6. 支持 `--json field1,field2`；
7. 支持 `--jq` 和 `--template`；
8. 支持 `api`；
9. 支持统一的错误、退出码和请求上下文；
10. 支持自动分页。

保留 Go、凭据库和现有认证实现。命令注册与参数解析使用成熟命令树库，避免在扁平解析器中继续增加特例。

### 第二优先级

1. 知识库和文档完整生命周期；
2. 文档上传、导入、索引等待、预览、下载、删除；
3. `search`、`grep`、`evidence`、`diff`；
4. `mcp tools list/call`；
5. `--all-workspaces` 聚合查询；
6. 统一的写操作预览和确认。

`--all-workspaces` 是用户明确请求跨空间查询时使用的只读聚合能力。每条结果保留来源；某个空间失败时报告部分失败，不能把其余空间的成功结果描述为完整结果。聚合调用不得改变当前默认空间。

### 第三优先级

1. Agent/Bot；
2. Chat/Turn；
3. 流式事件；
4. 取消；
5. 审批和补充信息；
6. 附件和导出。

### 第四优先级

1. 组织成员和角色；
2. API Key；
3. 用量、配额和限流；
4. 模型和提示词；
5. Marketplace；
6. 审计。

### 第五优先级

1. 别名；
2. 本地缓存；
3. 扩展机制；
4. 本地 MCP Server；
5. 更完整的浏览器和交互式 UI。

这些优先级描述实现顺序，不代表本文已经实现或验收其中的能力。

### CLI 交付路线

本路线把 CLI 作为主要交付面，Desktop 只跟随 CLI 合同做集成。每一阶段完成后都要有可下载制品和真实命令验收，不能只以源码或单元测试作为完成依据。

#### 阶段一：稳定命令合同

- 用真正的命令树替代继续扩展扁平解析器；
- 完成每层 `--help`、补全、参数互斥检查和命令建议；
- 统一 `--server`、`--connection`、`--workspace`、`--format`、`--jq`、分页参数；
- 完成 `config`、`doctor` 和 `capabilities`；
- 完成稳定的 JSON、JSONL、文本输出、错误代码和请求上下文；
- 完成自动分页、超时、重试、限流和中断处理。

#### 阶段二：知识库、文档和检索

- 补齐知识库创建、修改、删除和状态读取；
- 补齐文档上传、URL 导入、确认、索引状态、等待、删除、下载和版本冲突；
- 补齐 `search`、`grep`、`evidence`、`diff`、图谱和网页读取；
- 统一服务端已有状态字段和事件，不增加公共 `task` 资源；
- 完成显式跨空间查询和部分失败输出。

#### 阶段三：Agent、Chat 和 Turn

- 暴露 Agent/Bot/模板的读取和经授权的修改；
- 暴露 Chat、Turn、流式事件、取消、审批、补充信息和证据；
- 使用 `turn wait/watch/cancel` 等资源命令，不增加跨资源任务命令；
- 完成非交互运行和可恢复事件读取。

#### 阶段四：组织治理与自动化

- 暴露组织成员、角色、邀请、API Key、用量、配额和审计；
- 区分普通用户命令与管理员命令；
- 支持明确的 CI/API Key 使用方式；
- 最后再评估别名、缓存、扩展和本地守护进程。

## 八、当前 Skills 应该怎么改

当前 Skill 承担了过多命令记忆：

```text
先 auth status
再 workspace list
再 workspace current
再 knowledge list
再手动处理 cursor
```

这会导致 Agent：

- 每次重复执行多个命令；
- 不知道哪些命令当前版本真的存在；
- 遇到分页、空间、权限时容易混淆；
- 无法使用服务端已经存在的 MCP 能力。

新的 Skill 应该只描述：

1. 身份和空间边界；
2. 命令发现方式；
3. 读写安全规则；
4. 高层命令和 `api`、`mcp` 的选择；
5. 失败时如何解释；
6. 绝不跨空间猜测；
7. 绝不读取凭据文件。

具体命令参数应由以下入口提供：

```bash
apemind <command> --help
apemind capabilities
apemind mcp tools describe TOOL
```

其中 `capabilities` 是待实现的发现入口，需要区分当前 CLI 支持的命令、服务端提供的能力、当前身份被授予的能力；不能根据角色字符串推断全部可用操作。静态帮助不依赖登录，动态发现失败时明确返回未确认状态。

Skills 是 Agent 的使用说明，不应成为 API 的第二份实现。

## 九、最终产品定位

ApeMind CLI 的正确定位是：

> ApeMind 的统一命令行客户端和 Agent 操作协议。

它应该具备三种使用方式：

```text
人类：
apemind knowledge list

Agent：
apemind knowledge search "..."

高级调用：
apemind api ...
apemind mcp tools call ...
```

Desktop 则提供：

```text
登录、空间切换、资源浏览、预览、确认和可视化反馈
```

所有实际认证、权限、资源定位、服务端调用和写入一致性，都应落到同一套 CLI 核心与服务端合同。

## 当前交付重点（2026-09-19）

实现顺序以 CLI 的生产可用性为准，Desktop 的新需求暂时让位于 CLI 能力。当前优先收口命令树、OAuth/API Key 的统一请求边界、工作空间权限、知识库与文档生命周期，以及 Agent/Chat/Turn/Export 的资源级读写和等待。

Turn 的命令面已经确定为资源命令：`turn create`、`turn cancel`、`turn watch`、`turn consent`、`turn elicit` 和 `turn wait`。这些命令共享服务端的 Chat、Turn 和事件合同；`turn wait` 只在当前 CLI 进程内轮询 Turn 状态，不生成本地任务记录，也不把 CLI 的一次执行暴露为跨资源对象。

后续路线中，任何“等待”“取消”“查看进度”的提案都必须绑定到服务端已有资源。只有服务端已经公开独立资源、状态、权限和生命周期时，CLI 才映射该资源；服务端内部的队列、作业或数据库记录不能直接变成 CLI 公共命令。Desktop 需要展示进度时，读取 CLI 的结构化输出或服务端资源快照，不能重新实现第二套状态机。

第一步应重写 CLI 基础层，补齐命令树、帮助、输出、分页、配置和 `api`；然后按知识库、Agent、治理三个业务层逐步暴露服务端能力。继续向当前扁平解析器中添加业务命令，会扩大重复逻辑和维护成本。

## 不解决什么

本文不设计新的检索算法，不把 CLI 做成第二个大模型 Agent，不新增 Desktop 专用认证模式，也不要求为每个 HTTP 路由生成一个用户命令。

扩展市场、本地守护进程和本地 MCP Server 都是后续选项，不是第一阶段的前置条件。本文不把设计批准当作已完成代码、构建、发布或线上验收。

## 持续交付目标（Goal 文案）

以下文案用于持续执行本设计，恢复执行时以代码、公开制品、环境状态和验收记录判断已完成范围，不依据历史口头声明重新开始或提前收尾。

```text
以 apecloud/apemind-desktop 的 docs/engineering-process/2026-09-24-apemind-cli-command-scope-and-admin-design.md 为当前 CLI 命令语义、organization/workspace/admin 边界和授权矩阵，以同目录 2026-09-14-apemind-cli-first-integration.md 的统一身份合同和 2026-09-16 文档的 gh 能力分析为背景，持续完成 ApeMind CLI 及其服务端合同所需的实现、合并、发布与验收。

CLI 是本阶段唯一主线。Desktop 只保留登录入口、CLI 打包、结构化结果展示和必要的集成回归；除非 CLI 合同要求，不新增 Desktop 专用功能、独立 SDK、独立业务 API 或第二套凭据逻辑。

先核对现有分支、PR、已发布版本、实际安装和实际服务端能力，保留已有正确实现及用户数据，建立剩余事项清单；不要重做已验收的工作，不把“命令存在”“CI 通过”或“代码合并”视为功能交付。

产品约束：
1. CLI 是 ApeMind 面向 Agent 的正式客户端，命令、输出、退出码、帮助和能力发现是公开合同。Desktop、终端、脚本和其他 Harness 共用这套合同。
2. 浏览器登录建立 OAuth 连接，所有需要身份的 REST/MCP 业务操作使用 OAuth Access Token。CLI 统一维护刷新、撤销和恢复；不自动创建任何 API Key。
3. API Key 只用于调用方显式选择的连接或自动化。凭据来源和冲突规则明确可诊断，认证失败不得换账号、Cookie、其他 profile 或服务器环境 Key。
4. HTTP MCP 只接受显式 Bearer；受保护请求在 HTTP 层区分 401、scope 不足的 403 与业务/工具错误。实现并验证认证发现合同，保留普通网站 Cookie 登录。
5. 认证不替代授权。服务端逐次检查 scope、组织成员/状态、资源权限和 Key 限制；每次操作固定身份与空间。跨空间查询必须显式、保留来源和部分失败，不改默认空间。
6. Skills 只负责使用指引，命令帮助、能力发现和服务端合同提供真实能力。不能声称本地命令存在就代表部署支持或当前身份已获授权。
7. 当前系统没有统一 `task` 资源，`task` 不是 ApeMind 的产品概念。CLI 不创建公共的 `task list/get/wait/cancel` 抽象，不把一次命令执行记录保存成任务，也不把 `task` 作为命令、输出字段、事件类型、缓存键或本地状态名。服务端响应中如果出现内部 `job`、队列记录或其他实现字段，只能在对应资源的原始数据中按原名透传，不能借此拼出新的跨资源客户端模型。等待、查看进度和取消必须使用服务端已经定义的文档、导入、导出、Turn 或其他资源状态和事件；CLI 只提供对应资源的轮询、退避和中断处理。没有取消接口就不提供取消命令，停止等待不代表取消服务端执行。

执行顺序：
先修复认证边界及实际阻断；然后完成命令树、帮助、配置、输出、通用 API、MCP 和分页基础；继续知识库、文档、检索和证据的完整生命周期；再完成 Agent/Chat/Turn 与组织治理能力。每项异步能力先寻找并复用服务端已有状态接口，不为统一命令外观新增客户端状态机。按设计把扩展、缓存、本地守护进程和本地 MCP Server 后置，不把可选项变成第一阶段前置条件。服务端 OAuth 覆盖必须随每项业务能力一同完成，不使用 blanket scope 绕过授权。

执行授权与质量：
可以直接修改相关仓库、创建 PR、合并主干并发布已经授权的 ApeMind 环境。使用独立分支和工作区，尊重正在进行的其他工作；不覆盖用户改动，不读取或借用其他身份的凭据。已有授权范围内自主推进，不重复请求相同许可；发现授权外操作或实质性不可恢复风险时明确说明。
验证与风险匹配。CLI 命令、输出、认证、权限、持久化、跨仓合同和生产路径必须通过直接相关的回归、负例和集成验证，不能把安全断言改宽来取得绿色。Desktop 只运行受 CLI 合同影响的最小集成测试，不等待与 CLI 无关的慢 CI。遵守实际分支保护。
部署先核对目标环境与回滚依据，在 staging 验证后再发布新加坡生产。确认 CLI 制品、服务端镜像、部署收据和实际运行版本一致，不以工作流启动代替发布成功。

完成标准：
公开 CLI 制品可下载且版本/摘要正确；CLI 能在 OAuth 和显式 API Key 连接下完成已承诺的读取和经授权的写入；知识库、文档、检索、证据、Agent 和治理能力按路线逐项验收。验证分页、显式跨空间、部分失败、注销/过期/撤销、权限不足、错误身份、服务端资源状态和零副作用；测试数据范围明确并清理。
逐项区分代码、合并、制品发布、环境部署和最终验收状态。在 Issue/PR 留下可恢复的证据与剩余事项，持续推进到已承诺范围交付；有未完成项时不得把整个 Goal 标记完成。Desktop 内置 CLI 的版本锁定和本机打包单独记录；正式分发签名和跨平台运行验收不能用本机 unsigned 构建代替。
```

## 读完后能回答的问题

- gh 的哪些设计应当复用，哪些不需要照搬？
- 当前 CLI 已经具备什么基础，主要差距在哪里？
- ApeMind 服务端还有哪些能力没有通过 CLI 暴露？
- 高层命令、通用 API 和 MCP 的职责如何划分？
- Desktop 为什么不需要第二套业务 SDK？
- 跨空间查询、写入确认和凭据安全如何保持一致？
- 服务端没有统一任务资源时，CLI 如何等待和取消已有资源，而不发明新的任务资源？
- Skills 应当承载哪些说明，哪些事实应由命令动态提供？
- 下一步先做什么，哪些能力需要后置？
