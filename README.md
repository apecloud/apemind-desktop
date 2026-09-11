# ApeMind Desktop

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 ApeMind 品牌桌面客户端。

**本仓不是 dsh 的 fork。** 它持有的是「版本锁 + 品牌 overlay + 发版流水线」，
上游代码按 `upstream.lock` 取固定 commit，overlay 保存品牌、登录插件和必要接线。升级时仍可能需要调整补丁，并重新验证构建与功能。

## 这个仓怎么运作

```
upstream.lock  ──►  checkout 上游锁定 commit  ──►  应用 overlay/  ──►  按上游脚本构建/打包
   (版本唯一事实来源)        (不可变的完整 SHA)      (只碰品牌接线)         (原生 electron-builder)
```

三个设计决定，都是刻意的：

1. **锁 commit，不锁分支/tag。** 分支会移动、tag 可被重打；只有 40 位 commit 不可变。
   升级上游 = 改 `upstream.lock` 一个版本号 + 跑回归。
2. **overlay 是纯补丁、无上游文件副本，且受闸门约束。** overlay 只放 `overlay/patches/*.patch`
   （品牌 + 未签名开关），按固定顺序 `git apply`；补丁上下文不匹配就**结构性失败**，
   不存在"副本静默落后上游"的隐患（见 `overlay/OVERLAY.md`）。
   `scripts/verify-overlay.sh` 会校验：overlay 里无上游副本、每个补丁只碰授权路径。
   这条闸门是防止 overlay 悄悄退化成 fork 的关键。
   `scripts/sync-upstream.sh` 会在构建前校验：除白名单文件外任何差异都直接失败 —— 
   这条闸门是防止 overlay 悄悄退化成 fork 的关键。
3. **依赖不自建版本表。** 全部继承上游 lockfile；`upstream.lock` 记录其 sha256，
   用于确认我们拿到的确实是被验证过的那份依赖图。

## 状态（2026-09-11）

登录产品与技术合同见 [登录与工作空间设计](docs/engineering-process/2026-09-11-apemind-desktop-oauth-workspace.md)，文档入口见 [docs](docs/README.md)。

| 项 | 状态 |
|---|---|
| 仓骨架 / `upstream.lock` / overlay 机制 | ✅ 已建并实测（`sync-upstream.sh` 跑通） |
| dev 模式本机运行 | ✅ 已实测（macOS arm64，无需任何 Apple 凭据） |
| 未签名 `.app` 本机可用 | ✅ 已产出（[见下](#未签名构建)） |
| 品牌（五处用户可见位） | ✅ 已完成：窗口标题 / 侧栏字标 / 侧栏 mark / 中间 hero / app 图标 |
| 可分发正式安装包 | ⛔ 阻塞于 Apple Developer 凭据 |

### 品牌改造怎么生效（安装前必读）

桌面版运行时加载的是 `$DSH_HOME/profiles/desktop` 里的**已安装 profile**，不是构建树。
它的复用判据是「**版本相同即复用、不重装**」（`apps/desktop/src/project-manager.ts`
的 `applyRelease`：seed 版本 = app 版本 = 已装 dsh 版本 = 已装 host 包版本）。

**因此：改完品牌后，如果版本没变，app 会继续用旧 profile 里的旧 UI** ——
看起来像“改了没生效”，而构建日志全绿。

**处置（一步，手工）**：改品牌后清一次 profile 再启动：
```bash
mv ~/.dsh/profiles/desktop ~/.dsh/profiles/desktop.bak   # 先备份，不直接删
# 重开 app → 自动按新构建重建 profile
```

> ⚠️ **为什么不做成自动**：曾尝试把品牌修订号拼进版本号来“自动触发重装”，
> 但实测**不可行** —— 上游要求**整个 monorepo（266 个包）共享同一个 version**
> （`scripts/release/families.ts` 的 `verifyVersions`），
> 只改少数几个 package.json 会让 `release:pack` 直接失败。
> 要真正自动，得改上游的 profile 复用逻辑（属应用逻辑，非品牌呈现），
> 成本大于收益，故**保留为一步手工操作**并在此写明。

## 快速开始（dev 模式，零凭据）

```bash
./scripts/sync-upstream.sh          # 按 upstream.lock 取上游 + 应用 overlay
cd work/dsh-desktop
corepack prepare pnpm@11.7.0 --activate   # 必须匹配上游 packageManager
pnpm install --frozen-lockfile
pnpm run build
pnpm run dev:desktop                # 拉起 Electron 窗口
```

预期：窗口标题为品牌名；渲染走自定义协议 `dsh-app://app/index.html`（不是 localhost）。
Harness state 落在 `apps/desktop/.desktop-build/development/home`，**不污染真实 `$DSH_HOME`**。

详见 [docs/dev-runbook.md](docs/dev-runbook.md)。

## 未签名构建

上游 macOS 打包链**无条件**要求 Apple 凭据，缺凭据会在两处抛错，且第二处在很后面才触发：

1. `apps/desktop/electron-builder.config.mjs` 构造 config 时解析凭据 —— **`--dir` 绕不过**；
2. `apps/desktop/scripts/prepare-seed.ts` 再次解析 —— 此时 `prepare:runtime`、`prepare:packages` 已白跑。

因此本仓提供 `DSH_DESKTOP_UNSIGNED` 开关（见 `overlay/`），短路上述门槛，
用于**本机验证**。⚠️ 未签名产物是 ad-hoc 签名（`TeamIdentifier=not set`），
**只能本机使用，不可分发** —— 可分发正式包必须等 Apple 凭据。

## 依赖形态

| 依赖 | 形态 |
|---|---|
| dsh / Electron / Node / pnpm / 预置插件 | **锁精确版本的产物**（npm 包 / 官方归档），版本表继承上游 lockfile |
| ApeMind CLI | **Go 单二进制** + per-arch sha256 |
| 本仓自有代码 | 只有品牌 + 登录 + 接线，且刻意保持薄 |

构建**需要外网**（`prepare:runtime` 下载 Node、`prepare:seed` 拉 npm），不是离线构建。

## 许可

本仓自有代码见 [LICENSE](LICENSE)。
上游 dsh 为 MIT；再分发产物须遵守上游 `THIRD_PARTY_NOTICES.md` 与
`BRAND_GUIDELINES.md`（**上游明确要求项目名避免直接使用 "DeepSeek Harness" 商标**，
本仓据此使用 "ApeMind Desktop" 并声明 "built on DeepSeek Harness"）。
