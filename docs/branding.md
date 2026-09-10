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

## 明确**不**动的（已由上游 env 化）

| 项 | 走什么 |
|---|---|
| `appId` | `DSH_DESKTOP_APP_ID`（CI 变量） |
| macOS 签名身份 / Team ID | `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` / `_TEAM_ID` |
| Apple 公证凭据 | `APPLE_API_KEY` 三件套 / Apple ID 三件套 / `APPLE_KEYCHAIN_PROFILE` |
| Windows 签名 | `DSH_DESKTOP_WINDOWS_*` 四项 |
| 更新源 | `DSH_DESKTOP_AUTO_UPDATE_ENV` + `DOWNLOAD_*_ORIGIN` |

## 两个必须守住的边界

1. **overlay 不得包含上游逻辑改动。** 出现任何非品牌改动，`sync-upstream.sh` 的校验闸门会失败。
   若确有功能需求，**先评估能不能用上游官方扩展点**（`--patch` 配置叠加、官方插件、
   provider 投影、MCP），而不是改上游代码。
2. **图标缺失不阻塞开发。** `electron-builder` 无 `icon` 键时会 fallback 到 Electron 默认图标
   （已实测）。所以图标是**发版门槛**，不是开发门槛 —— 但**可分发正式包必须有正式图标**，
   不要用自造图标冒充品牌资产。

## 图标的处理状态

**待品牌/美术提供**。在位点就绪前：

- 构建照常（用 Electron 默认图标）；
- 产物**不可对外分发**（缺品牌资产 + 未签名，两者都拦着）；
- 拿到正式 `.icns` / `.ico` 后：放进 `overlay/apps/desktop/resources/`，
  并在 overlay 的 `electron-builder.config.mjs` 里给 `mac` / `win` 段加 `icon` 键。
