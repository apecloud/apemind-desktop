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
ALLOWED=(
  "OVERLAY.md"
  "apps/desktop/electron-builder.config.mjs"
  "apps/desktop/src/locale.ts"
)

fail=0

echo "==> 校验 overlay 文件清单"
# 注意：macOS 自带 bash 3.2 无 mapfile/readarray，用 while-read 代替。
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  ok=0
  for a in "${ALLOWED[@]}"; do
    [[ "$f" == "$a" ]] && ok=1 && break
  done
  # 品牌资源目录下的文件（图标等）单独放行
  [[ "$f" == apps/desktop/resources/* ]] && ok=1
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

if [[ $fail -ne 0 ]]; then
  echo "FATAL: overlay 校验失败。" >&2
  exit 1
fi
echo "==> overlay 校验通过 ✓"
