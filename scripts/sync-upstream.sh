#!/usr/bin/env bash
#
# sync-upstream.sh — 按 upstream.lock 取出上游代码并应用品牌 overlay。
#
# 用法：
#   ./scripts/sync-upstream.sh [--work-dir <path>] [--skip-verify]
#
# 行为：
#   1. 读 upstream.lock（唯一版本事实来源）
#   2. 在 work-dir 里 checkout 上游的锁定 commit（不存在则先 clone）
#   3. 把 overlay/ 覆盖上去
#   4. **校验**：除白名单文件外，overlay 不得与上游有差异
#      （这条是防止 overlay 悄悄退化成 fork 的闸门）
#
# 退出码：0 成功；非 0 失败（含校验失败）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="${REPO_ROOT}/upstream.lock"
OVERLAY_DIR="${REPO_ROOT}/overlay"
WORK_DIR="${REPO_ROOT}/work/dsh-desktop"
SKIP_VERIFY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── 极简 YAML 取值（不引入 yq 依赖；只处理本仓自有格式）────────────────
lock_get() {
  # $1 = 点分路径，如 upstream.commit
  python3 - "$LOCK_FILE" "$1" <<'PY'
import sys
path, key = sys.argv[1], sys.argv[2]
node = None
for raw in open(path, encoding='utf-8'):
    line = raw.split('#', 1)[0].rstrip()
    if not line.strip():
        continue
    if not line[0].isspace():
        node = line.split(':', 1)[0].strip()
    elif node is not None:
        parts = key.split('.')
        if node == parts[0]:
            k = line.strip().split(':', 1)[0].strip()
            if k == parts[-1]:
                print(line.split(':', 1)[1].strip().strip('"').strip("'"))
                sys.exit(0)
sys.exit(1)
PY
}

UPSTREAM_REPO="$(lock_get upstream.repository)"
UPSTREAM_COMMIT="$(lock_get upstream.commit)"
UPSTREAM_VERSION="$(lock_get upstream.version)"
PNPM_VER="$(lock_get toolchain.package_manager)"

echo "==> upstream.lock"
echo "    repository : ${UPSTREAM_REPO}"
echo "    commit     : ${UPSTREAM_COMMIT}"
echo "    version    : ${UPSTREAM_VERSION}"
echo "    pnpm       : ${PNPM_VER}"
echo "    work-dir   : ${WORK_DIR}"

# ── 1. 取上游代码 ──────────────────────────────────────────────────────
if [[ ! -d "${WORK_DIR}/.git" ]]; then
  echo "==> clone 上游（blob:none 以减少体积）"
  mkdir -p "$(dirname "${WORK_DIR}")"
  git clone --filter=blob:none "${UPSTREAM_REPO}" "${WORK_DIR}"
fi

echo "==> checkout 锁定 commit（不用分支/tag，保证不可变）"
git -C "${WORK_DIR}" fetch --filter=blob:none origin "${UPSTREAM_COMMIT}"
git -C "${WORK_DIR}" checkout --detach "${UPSTREAM_COMMIT}"
ACTUAL="$(git -C "${WORK_DIR}" rev-parse HEAD)"
if [[ "${ACTUAL}" != "${UPSTREAM_COMMIT}" ]]; then
  echo "FATAL: checkout 后 commit 不符：期望 ${UPSTREAM_COMMIT}，实际 ${ACTUAL}" >&2
  exit 1
fi
echo "    HEAD = ${ACTUAL} ✓"

# ── 2. 应用 overlay ────────────────────────────────────────────────────
echo "==> 应用 overlay"
# 用 rsync 语义把 overlay/apps/... 映射到 work-dir/apps/...
(cd "${OVERLAY_DIR}" && find . -type f -not -name 'OVERLAY.md' -print0) \
  | while IFS= read -r -d '' rel; do
      src="${OVERLAY_DIR}/${rel#./}"
      dst="${WORK_DIR}/${rel#./}"
      mkdir -p "$(dirname "${dst}")"
      cp "${src}" "${dst}"
      echo "    overlay -> ${rel#./}"
    done

# ── 3. 校验：overlay 不得退化成 fork ───────────────────────────────────
if [[ "${SKIP_VERIFY}" -eq 0 ]]; then
  echo "==> 校验 overlay 范围"
  # 只允许这些文件出现差异；任何其他改动都是越界。
  # 注意：逐文件列举，**不用目录前缀**——前缀会让任意文件通过。
  # 与 scripts/verify-overlay.sh 的 ALLOWED 保持同步。
  ALLOWED_REGEX='(^|/)apps/desktop/electron-builder\.config\.mjs$|(^|/)apps/desktop/src/locale\.ts$|(^|/)apps/desktop/resources/(README\.md|icon\.icns|icon\.ico)$'
  # 用 --untracked-files=all：否则 git 会把新增目录折叠成 `resources/`，
  # 导致逐文件白名单无法匹配（新增文件会被误报为越界）。
  CHANGED="$(git -C "${WORK_DIR}" status --porcelain --untracked-files=all | awk '{print $2}')"
  BAD=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ ! "$f" =~ $ALLOWED_REGEX ]]; then
      echo "    ✗ 越界改动: ${f}" >&2
      BAD=1
    fi
  done <<< "${CHANGED}"
  if [[ "${BAD}" -ne 0 ]]; then
    echo "FATAL: overlay 改到了未授权文件。overlay 只允许品牌接线，不得碰上游逻辑。" >&2
    exit 1
  fi
  echo "    改动文件数: $(echo "${CHANGED}" | grep -c . || true)（全部在允许范围内）✓"
fi

echo "==> 完成。后续构建："
echo "    cd ${WORK_DIR}"
echo "    corepack prepare ${PNPM_VER} --activate"
echo "    pnpm install --frozen-lockfile && pnpm run build"
