# ApeMind Desktop

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 ApeMind 品牌桌面客户端。

**本仓不是 dsh 的 fork。** 它持有的是「版本锁 + 品牌 overlay + 发版流水线」，
上游代码按 `upstream.lock` 取固定 commit，overlay 只覆盖品牌接线，**双方永不产生 merge 冲突**。

## 这个仓怎么运作

```
upstream.lock  ──►  checkout 上游锁定 commit  ──►  应用 overlay/  ──►  按上游脚本构建/打包
   (版本唯一事实来源)        (不可变的完整 SHA)      (只碰品牌接线)         (原生 electron-builder)
```

三个设计决定，都是刻意的：

1. **锁 commit，不锁分支/tag。** 分支会移动、tag 可被重打；只有 40 位 commit 不可变。
   升级上游 = 改 `upstream.lock` 一个版本号 + 跑回归。
2. **overlay 极小且受闸门约束。** 当前只覆盖 2 个文件 + 图标资源（见 `overlay/OVERLAY.md`）。
   `scripts/sync-upstream.sh` 会在构建前校验：除白名单文件外任何差异都直接失败 —— 
   这条闸门是防止 overlay 悄悄退化成 fork 的关键。
3. **依赖不自建版本表。** 全部继承上游 lockfile；`upstream.lock` 记录其 sha256，
   用于确认我们拿到的确实是被验证过的那份依赖图。

## 状态（2026-09-10）

| 项 | 状态 |
|---|---|
| 仓骨架 / `upstream.lock` / overlay 机制 | ✅ 已建并实测（`sync-upstream.sh` 跑通） |
| dev 模式本机运行 | ✅ 已实测（macOS arm64，无需任何 Apple 凭据） |
| 未签名 `.app` 本机可用 | ✅ 已产出（[见下](#未签名构建)） |
| 图标资源 | ⚠️ **待品牌/美术提供**（上游仓库一个图标都没有，需从零做） |
| 可分发正式安装包 | ⛔ 阻塞于 Apple Developer 凭据 |

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
