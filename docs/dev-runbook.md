# dsh Desktop — dev 模式本机运行指南

零源码改动、可复现的 dev 路径。已在 **macOS arm64** 实测通过（2026-09-10）。

用途：**证明 dsh 桌面版能跑、能看见界面**，且不触碰签名门、不需要任何 Apple 凭据。
出可安装产物是另一条路（需 Apple Developer 凭据），见文末。

## 环境要求

| 项 | 要求 | 实测值 |
|---|---|---|
| OS | macOS（Linux 不是上游受支持的桌面发布目标） | darwin 23.5.0 arm64 |
| Node.js | 仓库 `engines`: `^22.19.0 \|\| >=24.0.0` | v24.15.0 |
| pnpm | **必须匹配仓库 `packageManager` 字段** = `11.7.0` | 11.7.0（corepack 激活） |
| GUI 会话 | 需要 Aqua 图形会话（要弹窗口） | Aqua |

> 用错 pnpm 版本会在 install 或 build 阶段失败，务必用 corepack 激活后再跑。

## 步骤

```bash
# 1. 取代码（pin 到你要的 commit）
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness

# 2. 激活仓库要求的 pnpm（关键，别用系统 pnpm）
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack prepare pnpm@11.7.0 --activate
pnpm --version   # 应为 11.7.0

# 3. 装依赖
pnpm install --frozen-lockfile

# 4. 构建（dev:desktop 依赖已构建产物）
pnpm run build

# 5. 启动桌面壳
pnpm run dev:desktop
```

实测耗时：install **38.5s**、build 产出 **234 个 client artifact**、随后 Electron 窗口拉起。

Electron 二进制（`electron@44.0.0`）**首次调用时按需下载**，不是 install 阶段。

## 预期结果

- 弹出一个 Electron 窗口，窗口标题 **`DSH 本地构建`**。
- 渲染页走自定义协议 `dsh-app://app/index.html`（**不是** localhost 端口）。
- 后端 host 进程的 inspect 端口默认 **9230**；主进程 9229、渲染进程 9222。
- 日志会打印一行调试端口信息，形如
  `desktop development: inspectors main=9229, renderer=9222, host=9230`。

### 无害告警（可以忽略）

- `Electron Security Warning (Insecure Content-Security-Policy)` —— 上游标注**打包后自动消失**。
- `[WARN] Failed to create bin ... node_modules/.bin/dsh: ENOENT ... lib/bin.js`
  —— build 之前生成，dev 启动不受影响。

## 状态落点（不污染真实 home）

- Harness state 默认落在仓库内：
  `apps/desktop/.desktop-build/development/home`
  （含 `.credentials.yaml`、`storages/`；实测约 1.9M）
- **真实用户 home 不会被触碰**：实测运行后既无 `~/.dsh` 也无 `~/.config/dsh`。
- 只有**显式设置 `DSH_HOME`** 才会替换 Harness home。

## 停止

在启动它的终端 Ctrl-C，或结束 Electron 进程。

## 为什么 dev 不需要签名凭据

`apps/desktop/scripts/dev.ts` 用 `require('electron')` 直接拉起**未打包**的壳，
**不 import** `scripts/desktop-release-environment.mjs`，
所以那三个签名/公证硬门槛（`resolveDesktopAppId` / `resolveMacOSSigningEnvironment` /
`resolveMacOSNotarizationEnvironment`）根本不参与。实测印证：全程零凭据提示。

## 出可安装产物是另一条路（本指南不覆盖）

> **`.app` 机位**：已构建的未签名 `.app` **只存在于构建它那台开发机上**，在该机可双击运行；
> **其他机器的 `/Applications` 里没有它**（`/Applications` 各机独立）。
> 需要其他机器使用时必须**单独分发**（体量数百 MB，建议对象存储 + URL）。

`pnpm run package:mac:arm64` 需要 Apple Developer 凭据：

- `DSH_DESKTOP_APP_ID`（reverse-DNS）
- `DSH_DESKTOP_MACOS_SIGNING_IDENTITY`（不带 `Developer ID Application:` 前缀）
- `DSH_DESKTOP_MACOS_TEAM_ID`（10 位）
- 一套完整公证凭据（App Store Connect API key / Apple ID / keychain profile 三选一）

缺凭据时会有**两道门**依次拦住，且第二道在很后面才触发（会白跑一大段下载构建）：

1. `electron-builder.config.mjs` 构造 config 时无条件解析凭据 → 抛错；
   **`--dir` 绕不过去**（`--dir` 只影响 electron-builder 参数，不改 config 构造路径）。
2. `apps/desktop/scripts/prepare-seed.ts:166` 再次解析签名环境 → 抛错。

本仓 overlay 已提供 `DSH_DESKTOP_UNSIGNED=1`，用于本机功能验收。执行目录为同步后的 `work/dsh-desktop`：

```bash
DSH_DESKTOP_UNSIGNED=1 DSH_DESKTOP_APP_ID=com.apemind.desktop \
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ \
pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:dir
```

该构建没有 Apple Developer 签名与公证；完成本机测试不等于已具备公共发行安装包。

## 打包需要外网 —— 国内网络必须配 Electron 镜像（硬阻塞，非偶发）

`package:desktop:*` 全程需要外网，至少三处下载：

1. `prepare:runtime` 下载 **Node 24.17.0**（官方源可达即可）；
2. `prepare:seed` 从 npm 拉依赖；
3. **electron-builder 打包阶段下载 Electron 二进制**（`@electron/get`），
   默认去 **`github.com`**（`electron/electron` releases）。

⚠️ 在 `github.com` 不可达的环境（如部分国内网络），第 3 步会**挂在 0 字节**：
进程不报错、不退出，卡在

```
/tmp/electron-download-XXXX/electron-v<ver>-<os>-<arch>.zip   （大小 0）
```

**解法**：设 `ELECTRON_MIRROR` 指到可达镜像，例如：

```bash
export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
```

设好后 electron 会 100% 下载、打包通过。**CI 与本地打包都应设置**这条，
否则国内网络下打包会随机卡死（看起来像"构建慢"，实际是网络挂起）。

诊断提示：`lsof -nP -p <electron-builder-pid> | grep TCP` 若看到指向 `github.com` 的
`ESTABLISHED` 且 `%CPU` 为 0，即为本例。
