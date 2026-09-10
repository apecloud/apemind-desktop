# 图标资源 — 待品牌/美术提供

⚠️ **本目录当前为空（只有这份说明）。**

## 为什么空着

上游 dsh 仓库**一个图标文件都没有**（`apps/desktop` 下无 `.icns` / `.ico` / `.png`，
也没有 `build/` 目录），`electron-builder` 配置里同样没有 `icon` 键。
所以品牌图标是**新增**资产，不是"替换上游图标"，**必须从零设计制作**。

我没有、也不应该自造一个图标来充当 ApeMind 品牌资产 —— 那会把一个待办伪装成已完成。

## 需要什么

| 文件 | 平台 | 要求 |
|---|---|---|
| `icon.icns` | macOS | 从 1024×1024 PNG 生成，含 16/32/128/256/512 pt 各倍图 |
| `icon.ico` | Windows | 建议含 16/24/32/48/64/128/256 px |

## 拿到之后怎么做

1. 把两个文件放进本目录；
2. 在 `overlay/apps/desktop/electron-builder.config.mjs` 里给 `mac` 和 `win` 段加 `icon` 键
   （这是 overlay 文件，改它属授权范围）；
3. 在 `overlay/OVERLAY.md` 的图标条目下把 `status: PENDING-ASSET` 改为 `status: PROVIDED`；
4. 跑 `./scripts/verify-overlay.sh` 与 `./scripts/sync-upstream.sh` 确认闸门仍通过。

## 影响范围

- **不阻塞开发/构建**：`electron-builder` 无 `icon` 键时会 fallback 到 Electron 默认图标
  （已实测）。所以图标是**发版门槛**，不是开发门槛。
- **阻塞对外分发**：可分发正式安装包同时还需要 Apple Developer 凭据（见 `docs/branding.md`）。
  两样都齐之前，产物只能本机验证用。
