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

# 把工作树恢复成**纯净上游**再打补丁。
# 为什么必需：`git checkout --detach` **不会**清理本地修改（也不删未跟踪文件），
# 所以对一棵已经打过 overlay 的树再跑一次时，补丁会因“上下文已改”而失败，
# 并报出**错误的归因**（说“上游变了”，实际是我们自己的残留）。
# 本步让脚本幂等：无论本地工作树什么状态，结果都是“锁定 commit + overlay”。
# （CI runner 可能复用工作区，这条同样必需。）
git -C "${WORK_DIR}" reset --hard --quiet
# 清掉 overlay 引入的未跟踪文件（如 resources/README.md），但不碰 .gitignore 覆盖的构建产物。
git -C "${WORK_DIR}" clean --quiet -fd

ACTUAL="$(git -C "${WORK_DIR}" rev-parse HEAD)"
if [[ "${ACTUAL}" != "${UPSTREAM_COMMIT}" ]]; then
  echo "FATAL: checkout 后 commit 不符：期望 ${UPSTREAM_COMMIT}，实际 ${ACTUAL}" >&2
  exit 1
fi
echo "    HEAD = ${ACTUAL} ✓"

# ── 2. 应用 overlay：补丁（按文件名排序，顺序敏感）────────────────────
# 设计：overlay 里**不放任何上游文件副本**，只放 diff 补丁。
# 任何补丁 apply 失败（上下文不匹配）= 结构性报错，不会静默产生陈旧副本。
PATCH_DIR="${OVERLAY_DIR}/patches"
echo "==> 应用 overlay 补丁"
if [[ -d "${PATCH_DIR}" ]]; then
  while IFS= read -r patch; do
    [[ -z "${patch}" ]] && continue
    echo "    apply $(basename "${patch}")"
    if ! git -C "${WORK_DIR}" apply --whitespace=nowarn "${patch}"; then
      echo "FATAL: 补丁应用失败：$(basename "${patch}")" >&2
      echo "       通常意味着上游在本补丁涉及的上下文处有变更；" >&2
      echo "       请同步更新补丁，不要跳过。" >&2
      exit 1
    fi
  done < <(find "${PATCH_DIR}" -maxdepth 1 -type f -name '*.patch' | sort)
else
  echo "    （无 patches/ 目录，跳过）"
fi

# ── 2b. 应用 overlay：add-files（新增我们自己的文件）─────────────────
# 与 patches/ 的分工（机械可分）：
#   patches/   改上游**已有**文件（diff）
#   add-files/ **新增**我们自己的文件（不得与上游同名，否则应走 patches/）
# “不得同名”由 verify-overlay.sh 断言，此处不重复判定；此处只负责拷入。
ADD_DIR="${OVERLAY_DIR}/add-files"
if [[ -d "${ADD_DIR}" ]]; then
  echo "==> 应用 overlay add-files（新增文件）"
  (cd "${ADD_DIR}" && find . -type f -print0) \
    | while IFS= read -r -d '' rel; do
        rel="${rel#./}"
        src="${ADD_DIR}/${rel}"
        dst="${WORK_DIR}/${rel}"
        mkdir -p "$(dirname "${dst}")"
        cp "${src}" "${dst}"
        echo "    add-files -> ${rel}"
      done
fi

# 非补丁类资源（图标占位等）仍按文件复制，但**不含上游逻辑**。
# ⚠️ 这里**必须逐文件比对白名单**：否则一个未登记的文件（尤其上游逻辑副本）
# 会被静默拷进构建树。实测过：把上游 prepare-seed.ts 放进 resources/ 下能蒙骗过关 ——
# 因为此处原先是无条件 cp。
RESOURCE_DIR="${OVERLAY_DIR}/apps/desktop/resources"
if [[ -d "${RESOURCE_DIR}" ]]; then
  echo "==> 应用 overlay 资源（非上游逻辑）"
  (cd "${OVERLAY_DIR}" && find apps/desktop/resources -type f -print0) \
    | while IFS= read -r -d '' rel; do
        # 只允许白名单内的资源文件名（与 verify-overlay.sh 的 ALLOWED 同步）
        case "${rel}" in
          apps/desktop/resources/README.md|apps/desktop/resources/icon.icns|apps/desktop/resources/icon.ico) ;;
          *)
            echo "    ✗ 未登记的 overlay 资源: ${rel}" >&2
            echo "      （新增资源必须同时在 verify-overlay.sh 的 ALLOWED 与 OVERLAY.md 登记）" >&2
            exit 1
            ;;
        esac
        src="${OVERLAY_DIR}/${rel}"
        dst="${WORK_DIR}/${rel}"
        mkdir -p "$(dirname "${dst}")"
        cp "${src}" "${dst}"
        echo "    overlay -> ${rel}"
      done
fi

# ── 3. 校验：overlay 不得退化成 fork ───────────────────────────────────
# ⚠️ 这一段**不受 --skip-verify 影响**，永远执行。
#
# 原因（实测过的缺陷）：这段原先包在 `if [[ SKIP_VERIFY -eq 0 ]]` 里，
# 于是 `--skip-verify` 会把「overlay 文件白名单」一并跳过 —— 一个未授权文件
# （例如上游逻辑副本）会 exit 0 静默通过。
#
# 两个开关的语义本来就不同：
#   --skip-verify 的本意是跳过「对上游工作树的 diff 审计」（慢、调试时可能想跳）；
#   白名单校验查的是「overlay 里放了什么」—— 纯本地、极快、**没有跳过的正当理由**。
# 所以：**可以放弃 diff 审计，不可以放弃“只让登记过的文件进树”。**

# 校验（A）：**overlay 源树**本身。
#
# 为何必需：下面那段校验查的是**工作树**（git status）——只能看到“被应用了什么”。
# 一个只存在于 overlay/ 但根本不会被应用的文件（如误放的上游副本）对它是**隐形的**：
# 实测把上游 main.ts 放进 overlay/apps/desktop/src/ 后，工作树仍然干净，两段都无感。
# verify-overlay.sh 走的是 overlay/ 源树，因此能拓住这类；此处直接复用同一逻辑，
# 保证“单跑 sync-upstream.sh”也不漏。
if [[ -x "${REPO_ROOT}/scripts/verify-overlay.sh" ]]; then
  echo "==> 校验 overlay 源树与登记一致（不受 --skip-verify 影响）"
  # 无条件调用：该脚本的检查全是纯本地、亚秒级，没有任何需要跳过的理由。
  if ! "${REPO_ROOT}/scripts/verify-overlay.sh"; then
    echo "FATAL: overlay 源树校验失败（上面已列出具体文件）。" >&2
    exit 1
  fi
fi

if true; then
  echo "==> 校验 overlay 范围"
  # 只允许这些文件出现差异；任何其他改动都是越界。
  # 注意：逐文件列举，**不用目录前缀**——前缀会让任意文件通过。
  # 与 scripts/verify-overlay.sh 的 ALLOWED 保持同步。
  # 品牌 + 开关均通过 patches/ 施加，故此处列出其目标文件。
  # 允许的改动 = 补丁目标（改上游）+ add-files 目标（新增我们的文件）+ 资源。
  # 三者的语义分界见 overlay/OVERLAY.md；新增任一项都需同时登记 ALLOWED / ALLOWED_REGEX / OVERLAY.md。
  ALLOWED_REGEX='(^|/)apps/desktop/electron-builder\.config\.mjs$|(^|/)apps/desktop/src/locale\.ts$|(^|/)apps/desktop/scripts/desktop-release-environment\.mjs$|(^|/)apps/desktop/scripts/desktop-release-environment\.d\.mts$|(^|/)apps/desktop/scripts/prepare-seed\.ts$|(^|/)apps/desktop/resources/(README\.md|icon\.icns|icon\.ico)$|(^|/)packages/client/ui-brand-apemind/(package\.json|src/client/index\.ts|src/client/Brand\.tsx)$'
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
