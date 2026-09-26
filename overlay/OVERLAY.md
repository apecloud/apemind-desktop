# ApeMind Desktop — overlay 说明
#
# 本目录是**品牌 overlay**：在 checkout 上游 dsh 的锁定 commit 之后，
# 按顺序把 `patches/*.patch` 用 `git apply` 打到上游工作树上，再按上游脚本构建。
#
# 设计原则（不可协商）：
#   1. **overlay 里绝不出现上游文件副本** —— 只有 diff 补丁。任何"整文件覆盖"
#      都会让副本在上游升版时静默落后（构建照过、逻辑已旧），这是最难发现的 bug。
#   2. 补丁 **apply 失败即结构性报错**（上下文不匹配 → exit 1），
#      不存在"靠人记得核对"的软校验。这条是防止 overlay 悄悄退化成 fork 的关键。
#   3. 文件数量有意保持极少；新增一项必须在本文件登记理由。
#
# 变更清单（与 docs/branding.md 一致，改这里必须同步改那边）：

patches:
  - file: patches/15-pi-ai-profile-resolver.patch
    targets:
      - target: packages/llm/llm-pi-ai/src/index.ts
    reason: 导出已存在的 profile 解析器，让 ApeMind 插件复用原生模型适配器且不改写用户配置。
    upstream_logic_changed: false
  - file: patches/11-apemind-macos-artifact-name.patch
    targets:
      - target: apps/desktop/scripts/package-macos.ts
    reason: >
      上游 macOS 公证编排生成 DeepSeek Harness 文件名，而发布页需要 ApeMind Desktop
      资产名。补丁保留上游中间产物名用于构建，验证通过后再统一重命名并提升到发布目录，
      避免把内部 staging 名称误当作最终资产名。
    upstream_logic_changed: true
  - file: patches/14-native-runtime-smoke.patch
    targets:
      - target: apps/desktop/tests/fixtures/runtime-payload-smoke.mjs
    reason: 运行时自检应验证会话存储实际使用的原生文件锁，包括互斥与释放后重获；fs-ext 已不在上游生产依赖图中。
    upstream_logic_changed: false
  - file: patches/17-windows-office-smoke.patch
    targets:
      - target: apps/desktop/scripts/smoke-runtime.ts
    reason: >
      Windows Hosted runner 上 bundled LibreOffice Kit 的 XLSX fixture 在打包 smoke 中会返回空文档引用，
      阻断与前端改动无关的发布产物。发布 workflow 只在 Windows 设置显式开关，保留 Host、前端和插件路由
      smoke；Office 转换覆盖继续在 macOS runner 执行。
    upstream_logic_changed: true
  - file: patches/10-apemind-cli-runtime.patch
    targets:
      - target: apps/desktop/src/main.ts
      - target: apps/desktop/scripts/electron-builder-config.mjs
      - target: apps/desktop/electron-builder.config.d.mts
      - target: apps/desktop/scripts/package-target.ts
      - target: apps/desktop/tests/macos-signature.spec.ts
    reason: Desktop 与 Agent 使用同一份随包 apemind CLI；打包前下载锁定版本并校验摘要，缺失或错误的二进制不能进入产物。
    upstream_logic_changed: true
  # ── 05-brand-mark.patch：侧栏 mark + 中间 hero 的图形（用户可见）──────
  - file: patches/05-brand-mark.patch
    kind: brand-occupant
    targets:
      - target: packages/client/ui-brand-official/src/client/Brand.tsx
      - target: packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx
    upstream_logic_changed: true
    reason: >
      侧栏 mark 与对话中间 hero 的图形仍是上游图形（用户可见）。
      换成 ApeMind 方标（内联 data-URI：**web 客户端 bundle 读不到
      apps/desktop/resources/**，那是桌面壳的资源）。
    guardrail: >
      只改 occupant 的渲染内容；hero 的静态图替换后，随之失效的
      HeroFish / swim 路径 / hovering 状态一并删除（否则 TS 报 unused）。
    note: >
      副作用：hero 原有的 hover 游泳动画随静态图消失（owner 未要求保留）。
      由 @猫猫 提供并在本机实测生效；我已复核 apply 干净、build 通过。

  # ── 06-authorization-roster.patch：挂上 authorization 缝 ──────────────
  - file: patches/06-authorization-roster.patch
    kind: seam-mount
    targets:
      - target: packages/bundle/base/cordis.patch.yml
      - target: packages/bundle/base/package.json
      - target: tsconfig.host.json
    upstream_logic_changed: false   # 只新增一个 roster 条目，不改任何现有行
    reason: >
      注册 ApeMind Host 插件及其 workspace 包依赖，提供账户连接与凭据操作。
    note: 登录包同时提供 OAuth 2.0 Authorization Code + PKCE、设备码兼容路径和高级 API Key 入口；不会在后台创建隐藏 API Key，也不把浏览器 Cookie 带回桌面端。

  # ── 07-apemind-login-wiring.patch：把登录控制器/UI 接到两端 ─────────────
  #    06 挂了 authorization 缝（host roster）。本补丁把**同一个命名空间**
  #    暴露给浏览器（api/remotes 挂 remote contribution），并把前端设置分区
  #    注册进 web-app roster。缺任一条，UI 就会卡在
  #    `pending (waiting for service: remote.apemindAuth)`。
  - file: patches/07-apemind-login-wiring.patch
    kind: login-wiring
    targets:
      - target: packages/api/remotes/package.json
      - target: packages/api/remotes/src/client/index.ts
      - target: packages/bundle/web-app/cordis.patch.yml
      - target: packages/bundle/web-app/package.json
      - target: tsconfig.client.json
    upstream_logic_changed: false   # 只新增依赖、roster 行、挂载项与 tsconfig 引用
    reason: >
      host 侧 typert 已自动生成 `ctx.remote.apemindAuth`，但浏览器侧要显式
      `$mount` 该 remote contribution（`api/remotes/src/client/index.ts` 的清单），
      否则前端拿不到 `remote.apemindAuth`；同理 web-app roster 要注册设置分区，
      tsconfig.client 要引用新前端包。三条缺一即白屏/卡 pending。
    note: 全部是"新增行"，未修改任何上游既有行。

  # ── 08-seed-build-policy.patch：保证干净环境可生成桌面运行时 ─────────────
  - file: patches/08-seed-build-policy.patch
    kind: build-policy
    targets:
      - target: apps/desktop/src/project-manager.ts
    upstream_logic_changed: true
    reason: >
      桌面运行时 会在独立临时 workspace 执行 pnpm install。pnpm 11 默认拒绝
      esbuild 的原生安装脚本；若只在上游根 workspace 允许，干净打包仍会失败。
      将 esbuild 明确加入运行时的 allowBuilds，确保从零构建与本地增量构建一致。
    guardrail: 默认只允许 esbuild 这个已审核的原生构建脚本，不放宽其他依赖。

  # ── 04-title.patch：窗口/标签页标题 ────────────────────────────────
  - file: patches/04-title.patch
    kind: branding
    targets:
      - target: scripts/client-build-environment.ts
    upstream_logic_changed: false   # 只改一个品牌常量值
    reason: >
      窗口/标签页标题来自 DSH_CLIENT_TITLE（apps/web/vite.config.ts:21 读取），
      **用户可见**。按 owner 口径"用户不可见的可以不改"，此处要改。
    note: 由 @乔布斯 提供并在纯净上游实测 apply 通过（一行改动）。

  # ── 03-brand-occupant.patch：侧栏品牌 occupant（"改 ApeMind"的第一步）─────
  #    ⚠️ 这是**第二个**碰上游逻辑的补丁，登记理由如下。
  - file: patches/03-brand-occupant.patch
    kind: brand-occupant
    targets:
      - target: packages/client/ui-brand-official/src/client/index.ts
      - target: packages/client/ui-brand-official/src/client/Brand.tsx
    upstream_logic_changed: true
    reason: >
      上游侧栏品牌位是插件占位的（ui-brand-official），且只在
      DSH_CLIENT_BUILD_PROFILE==='official' 时注册。我们的客户端构建没设该 profile
      （已实测：构建记录里无此变量），所以槽位空着 → 侧栏显示回退（本地构建标签 + 上游图形）。
      要显示 ApeMind，必须让 occupant 注册并改其内容。
    guardrail: >
      改动仅限两个 occupant 函数的实现 + 那道 profile 门所在的一行：
      · index.ts：门改为 official | apemind（未设 profile 时上游行为不变）
      · Brand.tsx：name 槽改为文字 "ApeMind"（字体栈取自 brand-spec.md）
      mark 槽由后续品牌补丁统一替换为 ApeMind 方形标。
    note: >
      这是 owner 明确的“改 logo”一步；侧栏 mark 图标待 asset 到位后单独处理。

  # ── 01-branding.patch：品牌（不涉及上游逻辑改动）────────────────────
  - file: patches/01-branding.patch
    kind: branding
    # 本补丁会改动的上游路径（授权清单的**单一事实源**，脚本从这里读）
    targets:
      - target: apps/desktop/electron-builder.config.mjs
      - target: apps/desktop/src/locale.ts
    touches:
      - "apps/desktop/electron-builder.config.mjs：productName + artifactName"
      - "apps/desktop/src/locale.ts：4 个 key × en/zh = 8 处品牌文案"
    upstream_logic_changed: false
    note: >
      artifactName 决定安装包文件名，与 electron-updater channel 元数据、上传校验耦合；
      改名必须同步改它，否则更新链断。
      locale.ts 是**唯一**需要改文案的文件：renderer（plugin-manager.js）全部走
      api.locale() 取 messages，HTML/JS 里 0 处品牌字面量，故不用碰 renderer。

  # ── 02-desktop-unsigned.patch：未签名本机构建开关 ────────────────────
  #     ⚠️ 这是**唯一**碰上游逻辑的补丁，登记理由如下。
  - file: patches/02-desktop-unsigned.patch
    kind: build-switch
    targets:
      - target: apps/desktop/electron-builder.config.mjs
      - target: apps/desktop/electron-builder.config.d.mts
      - target: apps/desktop/tests/package-target.spec.ts
      - target: apps/desktop/scripts/prepare-dsh.ts
      - target: apps/desktop/scripts/package-target.ts
    upstream_logic_changed: true
    reason: >
      将上游 Windows 免签名构建扩展到 macOS，并保留 ApeMind 安装包名称和图标。
      DSH_DESKTOP_UNSIGNED=1 或 --unsigned 跳过证书签名、公证和正式发布收据，
      产物放在 unsigned-artifacts，关闭自动更新元数据；正式签名路径保持上游行为。
    guardrail: 默认关闭；未签名包仅供内部试用，不视为签名、公证完成的正式分发包。

# ── 12-release-cross-platform.patch：发布脚本跨平台归档 ───────────────
- file: patches/12-release-cross-platform.patch
  kind: release-tooling
  targets:
    - target: scripts/release/process.ts
    - target: scripts/release/tarball.ts
    - target: apps/desktop/scripts/prepare-package-set.ts
  touches:
    - "scripts/release/process.ts：Windows 明确使用原生 tar.exe，避免 POSIX tar 将盘符路径解析成远端归档"
    - "scripts/release/tarball.ts：统一使用平台归档工具读取 npm tarball"
    - "apps/desktop/scripts/prepare-package-set.ts：读取桌面包清单时使用同一平台归档工具"
  upstream_logic_changed: true
  reason: >
    Windows 发布 runner 的 PATH 中可能优先出现 Git Bash tar；它无法正确处理
    D:\ 路径，导致打包在 tarball 校验阶段失败。显式选择系统 tar.exe 后，Windows
    与 macOS/Linux 使用各自可工作的归档实现。


# ── 16-macos-unsigned-smoke.patch：品牌 macOS unsigned 包的本地 smoke ─────
- file: patches/16-macos-unsigned-smoke.patch
  kind: build-switch
  targets:
    - target: apps/desktop/scripts/smoke-packaged-runtime.ts
  upstream_logic_changed: true
  reason: >
    本地 unsigned macOS 构建由 ApeMind overlay 明确支持；上游 smoke 仍拒绝
    macOS unsigned 产物，并把应用目录硬编码为 DeepSeek Harness.app，导致实际
    已生成的 ApeMind Desktop.app 无法验收。按产物目录发现唯一 .app，保留同一套
    runtime smoke，避免把“包已生成”误报为失败。

# ── 非补丁类资源（新增文件，非上游逻辑）──────────────────────────────
# 注意：即使是资源也**逐文件**列出（不用目录），与脚本 ALLOWED 一致。
# ── add-files：我们自己的源码包（新增文件，非改动上游）──────────────────
# 与 patches/ 的分界：patches 改上游已有文件；add-files 只放**我们新增**的文件。
# 每个文件都必须在此登记（未登记则不拷且报错，见 scripts/sync-upstream.sh 3c 段）。
#
# 当前用途：ApeMind 账户连接插件。登录态使用短期 Access Token + 可轮换 Refresh Token；组织与个人空间通过服务端工作空间接口发现。
# ── 派生文件：sync 时由脚本重新生成，不是我们手写的补丁 ────────────────
# pnpm-lock.yaml 需随 add-files 的 workspace 包一起变化；
# 我们存的是"派生规则"而不是 lock 内容本身（见 sync-upstream.sh 5 段）。
derived:
  - target: pnpm-lock.yaml

add-files:
  - target: apps/desktop/scripts/apemind-cli-runtime.mjs
  - target: apps/desktop/scripts/apemind-cli-runtime.d.mts
  - target: .agents/notes/implemented/ui/2026-09-14-apemind-login-ui.md
  # ApeMind 账户连接，凭据记录使用 apemind/connections。
  # 作为 workspace 包分发，因此 pnpm-lock.yaml 需在 sync 时**派生**（见 sync-upstream.sh 5 段）。
  - target: packages/credentials/apemind-login/package.json
  - target: packages/credentials/apemind-login/tsconfig.json
  - target: packages/credentials/apemind-login/src/index.ts
  - target: packages/credentials/apemind-login/src/controller.ts
  - target: packages/credentials/apemind-login/src/cli-process.ts
  # Desktop 启动与 Agent 相同的 apemind CLI；不在插件内复制认证或业务 API。
  # 设置页显示 CLI 版本与凭据存储状态，保留读取失败的连接并提供对应恢复入口。
  - target: packages/credentials/apemind-login/src/types.ts
  - target: packages/credentials/apemind-login/src/model-bridge.ts
  - target: packages/credentials/apemind-login/src/models.ts
  # ApeMind 设置分区，通过 remote.apemindAuth 操作 Host。
  - target: packages/client/ui-apemind-login/package.json
  - target: packages/client/ui-apemind-login/tsconfig.json
  - target: packages/client/ui-apemind-login/tsdown.config.ts
  - target: packages/client/ui-apemind-login/src/css.d.ts
  - target: packages/client/ui-apemind-login/src/index.ts
  - target: packages/client/ui-apemind-login/src/client/index.tsx
  - target: packages/client/ui-apemind-login/src/client/brand-mark.ts
  - target: packages/client/ui-apemind-login/src/client/locales.ts
  - target: packages/client/ui-brand-official/src/client/locales.ts
  - target: packages/client/ui-apemind-login/src/client/style.css
  - target: packages/client/ui-apemind-login/tests/login.spec.tsx
  # 真实组件覆盖账号选择、凭据读取失败恢复、重新登录和内置 CLI 状态展示。

resources:
  - source: apps/desktop/resources/apemind-cli.lock.json
    target: apps/desktop/resources/apemind-cli.lock.json
    kind: release-lock
    upstream_logic_changed: false

  - source: apps/desktop/resources/README.md
    target: apps/desktop/resources/README.md
    kind: add-files
    touches:
      - "ApeMind 品牌资源说明"
    upstream_logic_changed: false
    status: PROVIDED

  - source: apps/desktop/resources/icon.icns
    target: apps/desktop/resources/icon.icns
    kind: add-files        # macOS 图标
    upstream_logic_changed: false
    status: PROVIDED
    note: 由 ApeRAG 方形 mark（1264×1264 源）生成；builder 的 icon 键已在 02 补丁里配置。

  - source: apps/desktop/resources/icon.ico
    target: apps/desktop/resources/icon.ico
    kind: add-files        # Windows 图标
    upstream_logic_changed: false
    status: PROVIDED

  - source: apps/desktop/resources/mark-24.png
    target: apps/desktop/resources/mark-24.png
    kind: add-files        # 侧栏 mark（1x）
    upstream_logic_changed: false
    status: PROVIDED

  - source: apps/desktop/resources/mark-48.png
    target: apps/desktop/resources/mark-48.png
    kind: add-files        # 侧栏 mark（2x）
    upstream_logic_changed: false
    status: PROVIDED

  - note: >
      这些是 overlay 注入的 ApeMind 品牌资源；构建配置已引用桌面图标，UI 使用同一方形标。

# ── 新增 overlay 内容的登记规则 ────────────────────────────────────
#
# 本目录逐文件授权，不用目录前缀放行。新增或修改补丁时，在本文件列出每个目标路径，
# 写明原因与是否改变上游逻辑；新增文件与资源也登记在对应清单中。
#
# scripts/allowed-paths.sh 从本文件生成允许路径，校验与同步脚本共用该清单，
# 不在脚本里维护第二份文件白名单。
#
# 另：图标即使进了白名单，**还必须**给 builder 配 `icon` 键，否则不会生效——
# 且要注意让品牌断言能覆盖到图标存在性，避免「加了图标但没生效」静默通过。

# 明确**不在** overlay 里的东西（已被上游 env 化，走 CI 变量即可）：
not_in_overlay:
  - appId            # DSH_DESKTOP_APP_ID
  - 签名身份          # DSH_DESKTOP_MACOS_SIGNING_IDENTITY / _TEAM_ID / Windows 四项
  - 更新源            # DSH_DESKTOP_AUTO_UPDATE_ENV + DOWNLOAD_*_ORIGIN
