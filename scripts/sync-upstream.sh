#!/usr/bin/env bash
#
# sync-upstream.sh — 按 upstream.lock 取上游代码并应用品牌 overlay。
#
#   ./scripts/sync-upstream.sh [--work-dir <path>]
#
# 做的事（四步，每步都对应一个真实需要）：
#   1. 按 upstream.lock 的 commit checkout（锁 commit，不用分支/tag）
#   2. reset 到纯净上游（使脚本幂等：重复跑不会把补丁打在已改过的树上）
#   3. 按序 git apply overlay/patches/（上下文不匹配即报错，不会静默产陈旧改动）
#   4. 校验：改动文件必须都在 overlay/OVERLAY.md 声明的范围内
#
# 退出码：0 成功；非 0 失败。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="${REPO_ROOT}/upstream.lock"
OVERLAY_DIR="${REPO_ROOT}/overlay"
WORK_DIR="${REPO_ROOT}/work/dsh-desktop"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

UPSTREAM_REPO="$(./scripts/lock-get.sh upstream.repository)"
UPSTREAM_COMMIT="$(./scripts/lock-get.sh upstream.commit)"

echo "==> upstream.lock"
echo "    repository : ${UPSTREAM_REPO}"
echo "    commit     : ${UPSTREAM_COMMIT}"

# ── 1. 取上游 ──────────────────────────────────────────────────────────
if [[ ! -d "${WORK_DIR}/.git" ]]; then
  echo "==> clone 上游"
  mkdir -p "$(dirname "${WORK_DIR}")"
  git clone --filter=blob:none "${UPSTREAM_REPO}" "${WORK_DIR}"
fi

echo "==> checkout 锁定 commit"
git -C "${WORK_DIR}" fetch --filter=blob:none origin "${UPSTREAM_COMMIT}"
git -C "${WORK_DIR}" checkout --detach "${UPSTREAM_COMMIT}"

# ── 2. 回到纯净上游（幂等）─────────────────────────────────────────────
# checkout --detach 不会清理本地修改，所以对一棵已打过补丁的树再跑时会失败、
# 并把它错误地归因成"上游变了"。reset 让脚本可重复执行。
git -C "${WORK_DIR}" reset --hard --quiet
git -C "${WORK_DIR}" clean --quiet -fd

ACTUAL="$(git -C "${WORK_DIR}" rev-parse HEAD)"
if [[ "${ACTUAL}" != "${UPSTREAM_COMMIT}" ]]; then
  echo "FATAL: checkout 后 commit 不符：期望 ${UPSTREAM_COMMIT}，实际 ${ACTUAL}" >&2
  exit 1
fi
echo "    HEAD = ${ACTUAL} ✓"

# ── 3. 应用补丁 ────────────────────────────────────────────────────────
echo "==> 应用 overlay 补丁"
PATCH_DIR="${OVERLAY_DIR}/patches"
if [[ -d "${PATCH_DIR}" ]]; then
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if ! git -C "${WORK_DIR}" apply --whitespace=nowarn "$p"; then
      echo "FATAL: 补丁应用失败：$(basename "$p")" >&2
      echo "       上下文不匹配 —— 通常是上游在该处有变更，需同步更新补丁。" >&2
      exit 1
    fi
    echo "    apply $(basename "$p")"
  done < <(find "${PATCH_DIR}" -maxdepth 1 -type f -name '*.patch' | sort)
fi

# ── 3b. 应用资源文件（图标等，非上游逻辑）───────────────────────────
# 只拷 OVERLAY.md 里 resources: 声明的文件。不逐文件登记就不拷——
# 这是“哪些文件能进构建树”的单一事实源。
RES_DIR="${OVERLAY_DIR}/apps/desktop/resources"
if [[ -d "${RES_DIR}" ]]; then
  echo "==> 应用 overlay 资源"
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    rel="${rel#./}"
    if ! grep -qE "^\s*(-\s*)?target:\s*${rel}\s*$" "${OVERLAY_DIR}/OVERLAY.md"; then
      echo "    ✗ 未在 OVERLAY.md 声明的资源: ${rel}" >&2
      exit 1
    fi
    mkdir -p "$(dirname "${WORK_DIR}/${rel}")"
    cp "${RES_DIR}/${rel#apps/desktop/resources/}" "${WORK_DIR}/${rel}"
    echo "    resource -> ${rel}"
  done < <(cd "${RES_DIR}" && find . -type f -print | sed 's|^\./||' | sort | sed 's|^|apps/desktop/resources/|')
fi

# ── 3c. 应用 add-files（我们自己新增的源码文件）─────────────────────
# 与 resources/ 的区别：resources 是图标类资产（全路径写在 apps/desktop/resources 下）；
# add-files 是**我们自己的源码包**（如 ApeMind 登录插件），路径即上游树里的真实落点。
# 两者共用同一条纪律：未在 OVERLAY.md 声明的文件**不拷且报错**。
ADD_DIR="${OVERLAY_DIR}/add-files"
if [[ -d "${ADD_DIR}" ]]; then
  echo "==> 应用 overlay add-files"
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    rel="${rel#./}"
    if ! grep -qE "^\s*(-\s*)?target:\s*${rel}\s*$" "${OVERLAY_DIR}/OVERLAY.md"; then
      echo "    ✗ 未在 OVERLAY.md 声明的 add-files: ${rel}" >&2
      exit 1
    fi
    mkdir -p "$(dirname "${WORK_DIR}/${rel}")"
    cp "${ADD_DIR}/${rel}" "${WORK_DIR}/${rel}"
    echo "    add-files -> ${rel}"
  done < <(cd "${ADD_DIR}" && find . -type f -print | sed 's|^\./||' | sort)
fi

# ── 5. 派生 lockfile（仅当 add-files 非空）────────────────────────
# 为什么需要：add-files 里是**新的 workspace 包**，它们会改变 pnpm 解析输入，
# 使上游 pnpm-lock.yaml 失效 → `--frozen-lockfile`（CI 与打包链都使用）会直接报
# ERR_PNPM_OUTDATED_LOCKFILE。
#
# 处置选择「派生」而非「在仓里存 lock 补丁」：
#   · 升版时不会因我们那几行与上游冲突（无补丁即无冲突）；
#   · lock 永远与 overlay 的 package.json 一致；
#   · 实测新增一个包的 lock 变化仅 ~5 行、全是 `link:` 本地记录，零 registry 解析。
if [[ -d "${ADD_DIR}" ]] && [[ -n "$(find "${ADD_DIR}" -type f -print -quit)" ]]; then
  echo "==> 派生 lockfile（add-files 引入新的 workspace 包）"
  if command -v pnpm >/dev/null 2>&1; then
    (cd "${WORK_DIR}" && pnpm install --lockfile-only --ignore-scripts 2>/dev/null) \
      && echo "    pnpm-lock.yaml 已派生" \
      || echo "    ⚠️ 派生失败（pnpm 不可用或网络受限）—— 后续 pnpm install 需自行处理" >&2
  else
    echo "    ⚠️ 未找到 pnpm，跳过派生（需先 corepack prepare 上游要求的版本）" >&2
  fi
fi

# ── 6. 校验改动范围 ────────────────────────────────────────────────────
# overlay 只允许改 OVERLAY.md 里声明的文件（单一事实源，不在这里重复维护清单）。
echo "==> 校验 overlay 范围"
ALLOWED_REGEX="$(./scripts/allowed-paths.sh)"
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
  echo "FATAL: overlay 改到了未授权文件（授权清单见 overlay/OVERLAY.md）。" >&2
  exit 1
fi
echo "    改动文件数: $(echo "${CHANGED}" | grep -c . || true)（全部在允许范围内）✓"

echo "==> 完成。后续构建："
echo "    cd ${WORK_DIR}"
echo "    corepack prepare pnpm@11.7.0 --activate"
echo "    pnpm install --frozen-lockfile && pnpm run build"
