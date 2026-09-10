#!/usr/bin/env bash
#
# verify-overlay.sh — 校验 overlay/ 没有退化成 fork。
#
#   ./scripts/verify-overlay.sh
#
# 只回答一个问题：**overlay 里是不是只有"品牌接线"，没有上游代码副本？**
#
# 为什么这条必要：overlay 一旦出现上游文件的整份副本，上游升版时副本会
# **静默落后**（构建照过、逻辑已旧）——这是真实发生过、且最难发现的事故。
# 其他检查（图标一致性、add-files 同名、skip-verify 开关…）在真正需要之前不加。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="${REPO_ROOT}/overlay"

fail=0

# ── 1. overlay 顶层只允许这些（其余一律视为可疑的上游副本）────────────
ALLOWED_TOP=("OVERLAY.md" "patches" "apps")
echo "==> overlay 顶层文件"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  top="${f%%/*}"
  ok=0
  for a in "${ALLOWED_TOP[@]}"; do
    [[ "$top" == "$a" ]] && ok=1 && break
  done
  if [[ $ok -eq 0 ]]; then
    echo "    ✗ 未允许的顶层条目: ${f}" >&2
    fail=1
  else
    echo "    ✓ ${f}"
  fi
done < <(cd "${OVERLAY_DIR}" && find . -mindepth 1 -maxdepth 1 -print | sed 's|^\./||' | sort)

# ── 2. patches/ 只允许 .patch；不允许把上游文件塞进来 ──────────────────
echo "==> patches/ 只含补丁"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    *.patch) echo "    ✓ ${f}" ;;
    *) echo "    ✗ patches/ 里出现非 .patch 文件（疑似上游副本）: ${f}" >&2; fail=1 ;;
  esac
done < <(cd "${OVERLAY_DIR}" && find patches -type f -print 2>/dev/null | sed 's|^\./||' | sort)

# ── 3. 品牌必须体现在补丁里（唯一一条内容断言，防"补丁被清空壳"）───────
# 判据用"增删配平"而不是数总数：数总数有盲区（总数含 productName 那一处，
# 丢一处 locale 仍可能满足阈值）。配平对"漏改一行"敏感。
echo "==> 品牌补丁配平"
BRANDING="${OVERLAY_DIR}/patches/01-branding.patch"
if [[ -f "$BRANDING" ]]; then
  removed="$(grep -c '^-.*DeepSeek Harness' "$BRANDING" || true)"
  added="$(grep -c '^+.*ApeMind Desktop' "$BRANDING" || true)"
  if [[ "${removed}" == "${added}" && "${removed}" != "0" ]]; then
    echo "    ✓ 配平（-${removed} / +${added}）"
  else
    echo "    ✗ 品牌替换未配平：-${removed} / +${added}（疑似漏改或漏删一行）" >&2
    fail=1
  fi
fi

if [[ $fail -ne 0 ]]; then
  echo "FATAL: overlay 校验失败。" >&2
  exit 1
fi
echo "==> overlay 校验通过 ✓"
