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
  # ── 01-branding.patch：品牌（不涉及上游逻辑改动）────────────────────
  - file: patches/01-branding.patch
    kind: branding
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
    touches:
      - "apps/desktop/scripts/desktop-release-environment.mjs：新增 isDesktopUnsignedBuild()，开关下短路 resolveDesktopAppId / resolveMacOSSigningEnvironment / resolveMacOSNotarizationEnvironment"
      - "apps/desktop/scripts/desktop-release-environment.d.mts：同步 declare isDesktopUnsignedBuild()（**不放宽** MacOSSigningEnvironment 字段类型，避免污染正常路径）"
      - "apps/desktop/scripts/prepare-seed.ts：开关下跳过 seed 签名（第二道门）"
      - "apps/desktop/electron-builder.config.mjs：开关下跳 forceCodeSigning / notarize / afterSign / dmg sign（第一道门）"
    upstream_logic_changed: true
    reason: >
      owner 已定「Apple 凭据后置」。而缺凭据时上游会在两处硬抛（electron-builder
      config 构造 + prepare-seed）。唯一能在不改上游仓的前提下产出本机可用 .app
      的方式，就是在这里短路这两处。
    guardrail: >
      开关默认关闭（未设 DSH_DESKTOP_UNSIGNED 时行为与上游一致）。
      唯一改到上游既有行的例外：prepare-seed.ts 里 1 处条件加了 `&& !unsignedBuild`。
    note: >
      未签名产物是 ad-hoc 签名（TeamIdentifier=not set），**只能本机使用、不可分发**。

# ── 非补丁类资源（新增文件，非上游逻辑）──────────────────────────────
# 注意：即使是资源也**逐文件**列出（不用目录），与脚本 ALLOWED 一致。
resources:
  - source: apps/desktop/resources/README.md
    kind: add-files
    touches:
      - "占位说明（当前无真实图标）"
    upstream_logic_changed: false
    status: PROVIDED

  - source: apps/desktop/resources/icon.icns
    kind: add-files        # macOS 图标
    upstream_logic_changed: false
    status: PENDING-ASSET
    note: 待品牌/美术提供。拿到后需同时完成下方「双登记」与 builder `icon` 键配置。

  - source: apps/desktop/resources/icon.ico
    kind: add-files        # Windows 图标
    upstream_logic_changed: false
    status: PENDING-ASSET

  - note: >
      ⚠️ 上游仓库**一个图标文件都没有**，所以这是**新增**资源而不是替换。
      缺失不阻塞构建：builder 无 icon 键时 fallback 到 Electron 默认图标（已实测）。
      因此图标是**发版门槛**，不是开发门槛。

# ── 新增 overlay 补丁的双登记规则（重要）──────────────────────────────
#
# 本目录**逐文件授权**，不用目录前缀放行。任何新增补丁必须**同时**完成两道登记：
#
#   1. 在 scripts/verify-overlay.sh 的 ALLOWED / ALLOWED_PATCHED 与
#      scripts/sync-upstream.sh 的 ALLOWED_REGEX 里列出该**确切路径**；
#   2. 在本文件的 patches 清单里新增对应条目（含理由、是否改上游逻辑）。
#
# 两道登记缺一：闸门会拒绝构建（这是有意设计，不是 bug）。
# 另：图标即使进了白名单，**还必须**给 builder 配 `icon` 键，否则不会生效——
# 且要注意让品牌断言能覆盖到图标存在性，避免「加了图标但没生效」静默通过。

# 明确**不在** overlay 里的东西（已被上游 env 化，走 CI 变量即可）：
not_in_overlay:
  - appId            # DSH_DESKTOP_APP_ID
  - 签名身份          # DSH_DESKTOP_MACOS_SIGNING_IDENTITY / _TEAM_ID / Windows 四项
  - 更新源            # DSH_DESKTOP_AUTO_UPDATE_ENV + DOWNLOAD_*_ORIGIN
