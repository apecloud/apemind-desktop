#!/usr/bin/env bash
# allowed-paths.sh — 从 overlay/OVERLAY.md 生成"授权改动路径"正则。
#
# 单一事实源：授权清单只写在 OVERLAY.md，脚本从这里读，
# 避免同一份清单在多个脚本里各写一份（那样必然一处严一处松）。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "${REPO_ROOT}/overlay/OVERLAY.md" <<'PY'
import re, sys

paths = []
for raw in open(sys.argv[1], encoding='utf-8'):
    line = raw.split('#', 1)[0]
    # 认 `target: <path>`，包括列表项形式（`- target: <path>`）
    m = re.match(r'\s*(?:-\s*)?target:\s*(\S+)\s*$', line)
    if m:
        paths.append(m.group(1).strip())

if not paths:
    sys.exit("allowed-paths: OVERLAY.md 里没有解析到任何 target:")

alts = '|'.join(re.escape(p) for p in sorted(set(paths)))
print(r'(^|/)(' + alts + r')$')
PY
