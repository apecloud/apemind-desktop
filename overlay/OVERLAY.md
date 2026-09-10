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
  # ── 品牌修订号：把 brand_revision 附到版本号（非补丁，由 sync 直接写入）──
  #    ⚠️ 目的：让桌面版的「版本相同即复用 profile」条件不成立（README:44），
  #       否则改品牌后 app 仍加载旧 profile，看起来"改了没生效"。
  versions:
    - target: package.json
    - target: apps/desktop/package.json

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
      （已实测：构建记录里无此变量），所以槽位空着 → 侧栏显示回退（本地构建标签 + 鱼）。
      要显示 ApeMind，必须让 occupant 注册并改其内容。
    guardrail: >
      改动仅限两个 occupant 函数的实现 + 那道 profile 门所在的一行：
      · index.ts：门改为 official | apemind（未设 profile 时上游行为不变）
      · Brand.tsx：name 槽改为文字 "ApeMind"（字体栈取自 brand-spec.md）
      mark 槽**仍指向上游 FishLogo**（未提供 ApeMind mark 前不伪造）。
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
      - target: apps/desktop/scripts/desktop-release-environment.mjs
      - target: apps/desktop/scripts/desktop-release-environment.d.mts
      - target: apps/desktop/scripts/prepare-seed.ts
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
    target: apps/desktop/resources/README.md
    kind: add-files
    touches:
      - "占位说明（当前无真实图标）"
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
