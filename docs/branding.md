# 品牌化说明

本文记录 ApeMind Desktop 相对上游 dsh 做了哪些品牌改动、依据是什么、以及**不能**碰什么。
改动清单以 `overlay/OVERLAY.md` 为准（那份是机器可读的上游校验基准），本文解释**为什么**。

## 命名与商标合规

上游 `BRAND_GUIDELINES.md` 明确要求：

- ✅ **允许**在描述性文字里说明关系，例如 "built on DeepSeek Harness" / "compatible with DeepSeek Harness"。
- ✅ **推荐**用缩写 "DSH" 指代生态。
- ⛔ **避免**在**项目名**里直接使用 "DeepSeek Harness" 全称（它是 DeepSeek 的注册商标，
  擅自用于项目名可能构成商标侵权）。
- ⛔ **避免**使用官方品牌材料造成"官方背书/合作/授权"的误解。

**因此本项目命名为 `ApeMind Desktop`**，并在描述文字中声明 "built on DeepSeek Harness"。
这不是可选的风格问题，是上游商标要求 + 许可合规。

## 改动清单（当前）

| 文件 | 改什么 | 为什么 |
|---|---|---|
| `apps/desktop/electron-builder.config.mjs` | `productName` → `ApeMind Desktop`；`artifactName` → `apemind-desktop-${version}-...` | 产品名与安装包文件名。**`artifactName` 必须同步改**：它与 electron-updater 的 channel 元数据、上传校验耦合，只改 `productName` 会把更新链改断。 |
| `apps/desktop/src/locale.ts` | 4 个 key × en/zh = 8 处文案 | 窗口标题与更新弹窗等用户可见文案。这是**唯一**需要改文案的文件 —— renderer（`plugin-manager.js`）全部走 `api.locale()` 取 messages，HTML/JS 里 0 处品牌字面量。 |
| `apps/desktop/resources/` | 新增 `icon.icns` / `icon.ico` | ⚠️ 上游仓库**一个图标文件都没有**，`electron-builder` 配置里也没有 `icon` 键。所以这是**新增**资源，须从零制作并给 builder 加 `icon` 键。 |
| `apps/desktop/src/main.ts` | 设置包内 CLI 路径与 Agent 的 `PATH` | 设置页和 Agent 使用同一二进制。 |
| `apps/desktop/scripts/package-target.ts`、`apps/desktop/scripts/apemind-cli-runtime.mjs` | 根据版本锁下载并校验 CLI，交给打包配置收录 | 防止产物缺少 CLI 或带入错误平台、错误版本的二进制。 |
| `apps/desktop/resources/apemind-cli.lock.json` | 固定 CLI 版本、源码提交、平台制品与摘要 | 构建不依赖本机偶然存在的 CLI。 |
| `apps/desktop/src/project-manager.ts` | 比较已校验的核心包内容清单，触发既有安装事务 | 上游版本相同但 overlay 内容变化时，更新运行目录并保留用户插件，失败时回滚。 |

ApeMind 登录插件及其界面位于 `overlay/add-files/`，通过上游插件与设置导航扩展点接入。
完整的补丁目标、新增文件及资源仍以 `overlay/OVERLAY.md` 为唯一清单。

## 明确**不**动的（已由上游 env 化）

| 项 | 走什么 |
|---|---|
| `appId` | `DSH_DESKTOP_APP_ID`（CI 变量） |
| macOS 签名身份 / Team ID | `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` / `_TEAM_ID` |
| Apple 公证凭据 | `APPLE_API_KEY` 三件套 / Apple ID 三件套 / `APPLE_KEYCHAIN_PROFILE` |
| Windows 签名 | `DSH_DESKTOP_WINDOWS_*` 四项 |
| 更新源 | `DSH_DESKTOP_AUTO_UPDATE_ENV` + `DOWNLOAD_*_ORIGIN` |

## 两个必须守住的边界

### 核 overlay 差异时的正确基准（易错，会得到假阴性）

要断言"overlay 只改了那几处"，必须对**纯净上游**比，**不能对 work tree 比**：

```bash
# HEAD 是锁定的上游 commit；显示全部补丁差异。
git -C work/dsh-desktop diff --stat
# 逐文件核对上游与已应用补丁的内容。
git -C work/dsh-desktop diff -- apps/desktop/electron-builder.config.mjs
```

原因：`sync-upstream.sh` 做的是 `checkout --detach <upstream_commit>`，
所以 work tree 的 HEAD **就是纯净上游**；`git diff`（work tree vs HEAD）恰好等于
上面那个正确基准。而直接 `diff` 两个文件路径会把"已应用 overlay 的副本"
当成上游，得出"没差异"的错误结论。

（仓内的 `verify-overlay.sh` / `sync-upstream.sh` 不受此影响：它们读 `git status`，不读 diff。）

1. **功能优先使用上游扩展点。** 打包、进程环境和运行目录更新等没有合适扩展点的行为，
   可以使用最小补丁，但必须在 `overlay/OVERLAY.md` 声明目标文件、原因与逻辑影响，
   并验证真实构建或运行路径。未登记的文件改动会使校验失败。
2. **图标缺失不阻塞开发。** `electron-builder` 无 `icon` 键时会 fallback 到 Electron 默认图标
   （已实测）。所以图标是**发版门槛**，不是开发门槛 —— 但**可分发正式包必须有正式图标**，
   不要用自造图标冒充品牌资产。

## 图标的处理状态

`overlay/apps/desktop/resources/` 已提供 ApeMind 的 `.icns`、`.ico` 与 PNG 资源，
打包配置引用应用图标，侧栏与首页使用 ApeMind 方形标。公共发行的签名、公证和更新源
要求见 [本机运行与打包指南](dev-runbook.md)。
