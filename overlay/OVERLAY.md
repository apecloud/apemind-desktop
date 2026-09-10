# ApeMind Desktop — overlay 说明
#
# 本目录是**品牌 overlay**：在 checkout 上游 dsh 的锁定 commit 之后，
# 把这里的文件覆盖到上游工作树对应路径上，然后按上游脚本构建。
#
# 设计原则（不可协商）：
#   1. **绝不出现上游代码副本**。这里只放"品牌接线"，不是 fork。
#      任何改动如果碰到上游逻辑（非品牌字符串/资源），就不该放在这里。
#   2. overlay 与上游代码**永不产生 merge 冲突** —— 因为我们从不 merge 上游，
#      只按 upstream.lock 换 commit，再重新覆盖这几个文件。
#   3. 文件数量是有意保持极少的（当前 3 类）。新增一项必须在本文件登记理由。
#
# 覆盖清单（与 docs/branding.md 一致，改这里必须同步改那边）：

overlay:
  # ── 1. 打包配置：产品名与产物文件名 ───────────────────────────────
  - source: apps/desktop/electron-builder.config.mjs
    target: apps/desktop/electron-builder.config.mjs
    kind: replace-file
    touches:
      - "productName（上游 :50）"
      - "artifactName（上游 :51）—— ⚠️ 它决定安装包文件名，与 electron-updater
         channel 元数据、上传校验耦合；改名必须同步改它，否则更新链断"
    upstream_logic_changed: false
    note: >
      本文件其余内容必须与上游逐字一致（只有这两个常量不同）。
      构建脚本会校验这一点：除白名单行外任何差异即失败，防止它悄悄退化成 fork。

  # ── 2. 界面品牌文案 ──────────────────────────────────────────────
  - source: apps/desktop/src/locale.ts
    target: apps/desktop/src/locale.ts
    kind: replace-file
    touches:
      - "4 个 key × en/zh = 8 处品牌文案"
      - "startupFailed / updateTitle / updateDetail / pluginWindowTitle"
    upstream_logic_changed: false
    note: >
      这是**唯一**需要改文案的文件：renderer（plugin-manager.js）全部走
      api.locale() 取 messages，HTML/JS 里 0 处品牌字面量，故不用碰 renderer。
      同样受"除白名单行外必须与上游一致"的校验。

  # ── 3. 图标资源（新增，非替换）────────────────────────────────────
  - source: apps/desktop/resources/
    target: apps/desktop/resources/
    kind: add-files
    touches:
      - "icon.icns（macOS）/ icon.ico（Windows）"
    upstream_logic_changed: false
    status: PENDING-ASSET
    note: >
      ⚠️ 上游仓库**一个图标文件都没有**，所以这是**新增**资源而不是替换。
      当前只有占位说明，**真实图标待品牌/美术提供**。
      缺失不阻塞构建：builder 无 icon 键时 fallback 到 Electron 默认图标（已实测）。
      因此图标是**发版门槛**，不是开发门槛。

# 明确**不在** overlay 里的东西（已被上游 env 化，走 CI 变量即可）：
not_in_overlay:
  - appId            # DSH_DESKTOP_APP_ID
  - 签名身份          # DSH_DESKTOP_MACOS_SIGNING_IDENTITY / _TEAM_ID / Windows 四项
  - 更新源            # DSH_DESKTOP_AUTO_UPDATE_ENV + DOWNLOAD_*_ORIGIN
  - 上游任何逻辑代码
