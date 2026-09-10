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

### 核 overlay 差异时的正确基准（易错，会得到假阴性）

要断言"overlay 只改了那几处"，必须对**纯净上游**比，**不能对 work tree 比**：

```bash
# ✅ 正确：HEAD 就是锁定的上游 commit（sync-upstream.sh 用 checkout --detach）
git -C work/dsh-desktop diff --stat
#   → apps/desktop/electron-builder.config.mjs | 4 ++--   (2 行)
#   → apps/desktop/src/locale.ts               | 16 ++++--- (8 处)

# ✅ 也可：逐文件对纯净上游看
git -C work/dsh-desktop show HEAD:apps/desktop/electron-builder.config.mjs > /tmp/pristine
 diff /tmp/pristine overlay/apps/desktop/electron-builder.config.mjs

# ❌ 错误：work tree 已应用过 overlay，两者本来就相同 → 0 差异假阴性
diff work/dsh-desktop/apps/desktop/electron-builder.config.mjs \
     overlay/apps/desktop/electron-builder.config.mjs      # 恒为 IDENTICAL
```

原因：`sync-upstream.sh` 做的是 `checkout --detach <upstream_commit>`，
所以 work tree 的 HEAD **就是纯净上游**；`git diff`（work tree vs HEAD）恰好等于
上面那个正确基准。而直接 `diff` 两个文件路径会把"已应用 overlay 的副本"
当成上游，得出"没差异"的错误结论。

（仓内的 `verify-overlay.sh` / `sync-upstream.sh` 不受此影响：它们读 `git status`，不读 diff。）

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
