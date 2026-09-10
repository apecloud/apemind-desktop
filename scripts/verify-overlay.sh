#!/usr/bin/env bash
# verify-overlay.sh — 校验 overlay/ 的内容与 overlay/OVERLAY.md 的声明一致。
#
# 这条闸门回答两个问题：
#   1. overlay 里**没有**出现上游代码副本（那会退化成 fork）；
#   2. overlay 声明的文件与磁盘上实际存在的文件一致（防止有人偷加文件绕过声明）。
#
# 用法：./scripts/verify-overlay.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="${REPO_ROOT}/overlay"

# 允许出现在 overlay 里的文件（与 overlay/OVERLAY.md 的清单一一对应）
# 注意：这里**逐文件列举，不用目录前缀放行**。前缀匹配会让任何人往该目录
# 丢任意文件都通过闸门（包括不该入库的东西），而本闸门的目的正是强制范围。
# 新增文件必须先在本数组 + OVERLAY.md 同时登记。
ALLOWED=(
  "OVERLAY.md"
  "apps/desktop/electron-builder.config.mjs"
  "apps/desktop/src/locale.ts"
  "apps/desktop/resources/README.md"
)

# 品牌图标：拿到正式资产后，把它加进 ALLOWED **并**同步改 overlay/OVERLAY.md
# 的 status（PENDING-ASSET → PROVIDED）。两道登记都做完才算授权。
# 有意不在现在预先放行：图标尚未存在，提前放行等于给"任意 icns 都可入库"开永久的门。

fail=0

echo "==> 校验 overlay 文件清单"
# 注意：macOS 自带 bash 3.2 无 mapfile/readarray，用 while-read 代替。
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  ok=0
  for a in "${ALLOWED[@]}"; do
    [[ "$f" == "$a" ]] && ok=1 && break
  done
  # 品牌资源已改为逐文件列举（见 ALLOWED），不再用目录前缀放行。
  if [[ $ok -eq 0 ]]; then
    echo "    ✗ 未在 OVERLAY.md 声明的文件: $f" >&2
    fail=1
  else
    echo "    ✓ $f"
  fi
done < <(cd "${OVERLAY_DIR}" && find . -type f -print | sed 's|^\./||' | sort)

echo "==> 校验 overlay 包含的是上游文件（防手写伪造）"
for a in "${ALLOWED[@]}"; do
  [[ "$a" == "OVERLAY.md" ]] && continue
  if [[ ! -f "${OVERLAY_DIR}/${a}" ]]; then
    echo "    ✗ 声明存在但磁盘缺失: $a" >&2
    fail=1
  fi
done

echo "==> 校验 overlay 未触碰上游逻辑（白名单行校验）"
# 这里只做**结构性**检查：确认真实改动发生在预期的语义位置。
# 逐行的严格比对由 sync-upstream.sh 完成（它有上游工作树可 diff）。
BUILDER="${OVERLAY_DIR}/apps/desktop/electron-builder.config.mjs"
LOCALE="${OVERLAY_DIR}/apps/desktop/src/locale.ts"

if [[ -f "$BUILDER" ]]; then
  # productName 与 artifactName 必须都已品牌化
  grep -q "productName: 'ApeMind Desktop'" "$BUILDER" \
    || { echo "    ✗ productName 未品牌化" >&2; fail=1; }
  grep -q "artifactName: 'apemind-desktop-" "$BUILDER" \
    || { echo "    ✗ artifactName 未品牌化（只改 productName 会断更新链）" >&2; fail=1; }
  # 不应残留上游品牌名
  if grep -q "DeepSeek Harness" "$BUILDER"; then
    echo "    ✗ builder 配置里仍残留 'DeepSeek Harness'" >&2; fail=1
  fi
fi

if [[ -f "$LOCALE" ]]; then
  n="$(grep -c 'ApeMind Desktop' "$LOCALE" || true)"
  [[ "$n" == "8" ]] || { echo "    ✗ locale 品牌文案应为 8 处，实际 ${n}" >&2; fail=1; }
fi

echo "==> 校验图标一致性（防「加了图标但没接进 builder」静默通过）"
# 规则：图标文件存在 ⇒ builder 必须配 icon 键；反之也建议一致。
# 这道校验防的是一个具体失败模式：图标进了 overlay 白名单，但忘了给 electron-builder
# 配 icon，结果产物仍用 Electron 默认图标，而所有其他断言都绿。
HAS_ICNS=0; [[ -f "${OVERLAY_DIR}/apps/desktop/resources/icon.icns" ]] && HAS_ICNS=1
HAS_ICO=0;  [[ -f "${OVERLAY_DIR}/apps/desktop/resources/icon.ico" ]] && HAS_ICO=1
HAS_ICON_KEY=0
[[ -f "$BUILDER" ]] && grep -qE '^\s*icon:' "$BUILDER" && HAS_ICON_KEY=1

if [[ $HAS_ICNS -eq 1 || $HAS_ICO -eq 1 ]]; then
  if [[ $HAS_ICON_KEY -eq 0 ]]; then
    echo "    ✗ 图标资源已存在，但 builder 配置里没有 icon 键 —— 图标不会生效" >&2
    echo "      （在 overlay 的 electron-builder.config.mjs 里给 mac/win 段加 icon:）" >&2
    fail=1
  else
    echo "    ✓ 图标资源与 builder icon 键同时存在"
  fi
else
  if [[ $HAS_ICON_KEY -eq 1 ]]; then
    echo "    ✗ builder 配了 icon 键，但 overlay 里没有图标文件（构建会找不到资源）" >&2
    fail=1
  else
    echo "    ○ 尚无图标资源，builder 也未配 icon —— 与 PENDING-ASSET 一致"
  fi
fi

if [[ $fail -ne 0 ]]; then
  echo "FATAL: overlay 校验失败。" >&2
  exit 1
fi
echo "==> overlay 校验通过 ✓"
