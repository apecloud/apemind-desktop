# 产物验收（打包版）

本文给出**打包后的产物验收判据与命令**。原则：**每条判据都要能被执行、且结果可判"通过/不通过"**，
不写"应该没问题"这类无法证伪的表述。

配套：`scripts/verify-overlay.sh` 保证"源码侧真的按这些判据检查了"；
本文说明"产物侧该查什么"。**两者是一回事**，改动时应一起提。

---

## 一、身份层

```bash
APP="/Applications/ApeMind Desktop.app"
plutil -extract CFBundleName       raw "$APP/Contents/Info.plist"
plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist"
plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist"
```

| 项 | 期望 |
|---|---|
| `CFBundleName` | `ApeMind Desktop`（来自补丁的 `productName`） |
| `CFBundleIdentifier` | 由 `DSH_DESKTOP_APP_ID` 注入（本地验证版形如 `com.apemind.desktop-unsigned`） |
| 版本 | 与 `upstream.lock` 的 `version` 一致 |

⚠️ **`appId` 属"品牌四项"之一**。本地未签名验证版带 `-unsigned` 后缀是**有意**的占位；
**正式包必须换成不带 `-unsigned` 的正式 id** —— 它会永久烙进签名身份与更新归属。

---

## 二、品牌层

```bash
# 用户可见品牌串：应为 8 处（4 key × en/zh），且全为 ApeMind Desktop
```

| 项 | 期望 |
|---|---|
| locale 的 4 个 key（`startupFailed`/`updateTitle`/`updateDetail`/`pluginWindowTitle`）× en/zh | **8/8 均为 `ApeMind Desktop`** |
| locale 值中的 `DeepSeek Harness` | **0 处** |

### ⚠️ 已知非问题：asar 内的 JSDoc 注释残留

```bash
grep -r "DeepSeek Harness" "$APP/Contents/Resources/app.asar"   # 可能命中 4 处
```

**实测这 4 处全是 JSDoc 注释**，形如：

```
/** Directory name for the default DeepSeek Harness home under the OS home. */
/** Environment variable that overrides the default DeepSeek Harness home. */
```

**不是用户可见字符串 → 不该改。** 改它们属于无意义的内联改动，还会平添与上游的差异。

**判据**：`/** ... */` 或 `//` 开头的是注释，忽略；
**只查 locale 的 4 个 key 值**是否已品牌化。

**为什么特意写出来**：否则将来有人 `grep -r "DeepSeek Harness" app.asar` 看到 4 处，
会**误报成"品牌没替换干净"**，然后去改注释。这是**假阳性**，不是缺陷。

---

## 三、边界层（未签名本地验证版）

```bash
# ① 未签名
codesign -dv "$APP" 2>&1 | grep -E 'Signature|TeamIdentifier'

# ② 自动更新元数据必须缺席
ls "$APP/Contents/Resources/" | grep -E 'app-update\.yml|latest.*\.yml'

# ③ dummy 更新源不得漂进产物
grep -rl "example.invalid" "$APP/Contents/Resources/"
```

| 项 | 期望 | 理由 |
|---|---|---|
| 签名 | `Signature=adhoc`、`TeamIdentifier=not set` | 未签名版为 ad-hoc，**只能本机用，不可分发** |
| `app-update.yml` / `latest*.yml` | **不存在** | 未签名版不应带真实更新链 |
| `example.invalid`（dummy origin） | **0 命中** | 否则"本机验证版"会带一个打不通的更新源 |

---

## 四、图标

```bash
grep -r "application icon is not set" <build log>   # 已知：当前会命中
```

| 状态 | 说明 |
|---|---|
| 当前 | **报 `application icon is not set` 是正确行为** —— 图标资产尚未提供，electron-builder 回退到 Electron 默认图标 |
| 提供后 | 放进 `overlay/apps/desktop/resources/`（`icon.icns` / `icon.ico`）+ 补丁里给 builder 加 `icon` 键 |

**「给图标不会静默漏接」已由闸门保证**：`verify-overlay.sh` 的图标一致性断言会拦下
"有图标文件但没配 `icon` 键"（实测 `EXIT=1`）。所以现在没图标是预期的；将来给图标会被正确接住。

---

## 五、$DSH_HOME 落点

| 形态 | 落点 | 是否预期 |
|---|---|---|
| 打包版（`.app`） | 默认 `~/.dsh`（`profiles/desktop`），**未设 `DSH_HOME`** | ✅ 预期 |
| `dev:desktop`（仓库内开发） | `apps/desktop/.desktop-build/development/home` | ✅ 预期（有意隔离） |

**若 `~/.dsh` 早已存在**（owner 的真实 DSH home），打包版写入其中**不是污染**，
是设计行为；两者行为不同且都正确。
