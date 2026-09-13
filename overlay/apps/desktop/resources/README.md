# ApeMind 品牌资源

本目录保存 ApeMind Desktop 使用的品牌资产。图标由 ApeMind 方形标统一生成，客户端设置页、侧栏、对话页和桌面安装包共用同一套视觉资产。

| 文件 | 用途 |
|---|---|
| `mark-24.png` / `mark-48.png` | Web/桌面 UI 中的 ApeMind 方形标（1x/2x） |
| `icon.icns` | macOS 应用图标 |
| `icon.ico` | Windows 应用图标 |

这些文件由 overlay 注入上游工作树；升级上游时仍由 `sync-upstream.sh` 从本目录复制，避免在派生工作树中手工维护副本。
