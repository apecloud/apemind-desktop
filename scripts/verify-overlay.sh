#!/usr/bin/env bash
# verify-overlay.sh — 校验 overlay/ 的形态与 overlay/OVERLAY.md 的声明一致。
#
# overlay 的设计：**只放补丁，不放任何上游文件副本。**
# 本脚本回答四个问题：
#   1. overlay 里**没有**上游代码副本（那会退化成 fork），且文件都在声明范围内；
#   2. 声明的文件与磁盘实际存在的文件一致（防偷加文件绕过声明）；
#   3. 每个补丁**只触及授权路径**（防补丁偷偷改到别处）；
#   4. 品牌断言 + 图标一致性断言。
#
# 用法：./scripts/verify-overlay.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="${REPO_ROOT}/overlay"
PATCH_DIR="${OVERLAY_DIR}/patches"

# 允许出现在 overlay 里的文件（与 overlay/OVERLAY.md 的清单一一对应）。
# 注意：这里**逐文件列举，不用目录前缀放行**（前缀会让任意文件通过）。
# 新增文件必须先在本数组 + OVERLAY.md 同时登记。
ALLOWED=(
  "OVERLAY.md"
  "patches/01-branding.patch"
  "patches/02-desktop-unsigned.patch"
  "apps/desktop/resources/README.md"
  # 图标：拿到正式资产后，把它加进 ALLOWED **并**同步改 overlay/OVERLAY.md
  # 的 status（PENDING-ASSET → PROVIDED）。两道登记都做完才算授权。
  # 有意不在现在预先放行：图标尚未存在，提前放行等于给"任意 icns 都可入库"开永久的门。
)

# 补丁允许触及的上游路径（逐文件列举，不用目录前缀）。与 sync-upstream.sh 的
# ALLOWED_REGEX 保持同步。
ALLOWED_PATCHED='^(a/|b/)(apps/desktop/electron-builder\.config\.mjs|apps/desktop/src/locale\.ts|apps/desktop/scripts/desktop-release-environment\.mjs|apps/desktop/scripts/desktop-release-environment\.d\.mts|apps/desktop/scripts/prepare-seed\.ts)$'

fail=0

echo "==> 校验 overlay 文件清单（无上游副本）"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  ok=0
  for a in "${ALLOWED[@]}"; do
    [[ "$f" == "$a" ]] && ok=1 && break
  done
  if [[ $ok -eq 0 ]]; then
    echo "    ✗ 未在 OVERLAY.md 声明的文件（疑似上游副本）: $f" >&2
    fail=1
  else
    echo "    ✓ $f"
  fi
done < <(cd "${OVERLAY_DIR}" && find . -type f -print | sed 's|^\./||' | sort)

echo "==> 校验声明存在（防只声明不落盘）"
for a in "${ALLOWED[@]}"; do
  [[ "$a" == "OVERLAY.md" ]] && continue
  # 图标尚未提供，允许缺失；其余声明的文件必须存在
  case "$a" in
    apps/desktop/resources/icon.*) continue ;;
  esac
  if [[ ! -f "${OVERLAY_DIR}/${a}" ]]; then
    echo "    ✗ 声明存在但磁盘缺失: $a" >&2
    fail=1
  fi
done

echo "==> 校验每个补丁只触及授权路径"
if [[ -d "${PATCH_DIR}" ]]; then
  shopt -s nullglob
  patches=("${PATCH_DIR}"/*.patch)
  if [[ ${#patches[@]} -eq 0 ]]; then
    echo "    ✗ patches/ 目录为空" >&2; fail=1
  fi
  for p in "${patches[@]}"; do
    while IFS= read -r fpath; do
      [[ -z "$fpath" ]] && continue
      if [[ ! "$fpath" =~ $ALLOWED_PATCHED ]]; then
        echo "    ✗ $(basename "$p") 触及越界路径: $fpath" >&2; fail=1
      fi
    done < <(grep -E '^\+\+\+ ' "$p" | awk '{print $2}' | grep -v '^/dev/null$' | sort -u)
    echo "    ✓ $(basename "$p")"
  done
else
  echo "    ✗ 缺少 patches/ 目录" >&2; fail=1
fi

echo "==> 校验品牌断言（补丁内容层面）"
# 品牌必须体现在补丁里：builder productName/artifactName + locale 8 处。
if ! grep -rq "productName: 'ApeMind Desktop'" "${PATCH_DIR}" 2>/dev/null; then
  echo "    ✗ 补丁里没有 productName 品牌化" >&2; fail=1
fi
if ! grep -rq "artifactName: 'apemind-desktop-" "${PATCH_DIR}" 2>/dev/null; then
  echo "    ✗ 补丁里没有 artifactName 品牌化（只改 productName 会断更新链）" >&2; fail=1
fi
if grep -E '^\+.*DeepSeek Harness' "${PATCH_DIR}/01-branding.patch" >/dev/null 2>&1; then
  echo "    ✗ 品牌补丁新增行仍残留 'DeepSeek Harness'" >&2; fail=1
fi
brand_hits="$(grep -rh '^+.*ApeMind Desktop' "${PATCH_DIR}" 2>/dev/null | wc -l | tr -d ' ')"
[[ "${brand_hits}" -ge 8 ]] || { echo "    ✗ locale 品牌文案补丁少于 8 处（实际 ${brand_hits}）" >&2; fail=1; }

echo "==> 校验图标一致性（防「加了图标但没接进 builder」静默通过）"
# 规则：图标文件存在 ⇒ 品牌补丁必须给 builder 配 icon 键；反之也建议一致。
# 这道校验防的是：图标进了 overlay 白名单，但忘了给 electron-builder 配 icon，
# 结果产物仍用 Electron 默认图标，而所有其他断言都绿。
HAS_ICNS=0; [[ -f "${OVERLAY_DIR}/apps/desktop/resources/icon.icns" ]] && HAS_ICNS=1
HAS_ICO=0;  [[ -f "${OVERLAY_DIR}/apps/desktop/resources/icon.ico" ]] && HAS_ICO=1
HAS_ICON_KEY=0
grep -rqE '^\+[[:space:]]*icon:' "${PATCH_DIR}" 2>/dev/null && HAS_ICON_KEY=1

if [[ $HAS_ICNS -eq 1 || $HAS_ICO -eq 1 ]]; then
  if [[ $HAS_ICON_KEY -eq 0 ]]; then
    echo "    ✗ 图标资源已存在，但补丁里没有 builder icon 键 —— 图标不会生效" >&2
    echo "      （在 01-branding.patch 里给 mac/win 段加 icon:）" >&2
    fail=1
  else
    echo "    ✓ 图标资源与 builder icon 键同时存在"
  fi
else
  if [[ $HAS_ICON_KEY -eq 1 ]]; then
    echo "    ✗ 补丁配了 icon 键，但 overlay 里没有图标文件（构建会找不到资源）" >&2
    fail=1
  else
    echo "    ○ 尚无图标资源，补丁也未配 icon —— 与 PENDING-ASSET 一致"
  fi
fi

if [[ $fail -ne 0 ]]; then
  echo "FATAL: overlay 校验失败。" >&2
  exit 1
fi
echo "==> overlay 校验通过 ✓"
