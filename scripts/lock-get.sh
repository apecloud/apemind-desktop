#!/usr/bin/env bash
# 从 upstream.lock 取一个值。用法：./scripts/lock-get.sh upstream.commit
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# -eq 1 ]] || { echo "usage: $0 <dotted.key>" >&2; exit 2; }
python3 - "${REPO_ROOT}/upstream.lock" "$1" <<'PY'
import sys
path, key = sys.argv[1], sys.argv[2]
parts = key.split('.')
node = None
for raw in open(path, encoding='utf-8'):
    line = raw.split('#', 1)[0].rstrip()
    if not line.strip():
        continue
    k = line.strip().split(':', 1)[0].strip()
    if ':' not in line:
        continue
    val = line.split(':', 1)[1].strip().strip('"').strip("'")
    if not line[0].isspace():
        node = k
        # 顶层键：支持单层查询（brand_revision）
        if len(parts) == 1 and k == parts[0]:
            print(val)
            sys.exit(0)
    else:
        # 嵌套键：node 匹配首段且当前键匹配末段
        if node == parts[0] and k == parts[-1]:
            print(val)
            sys.exit(0)
sys.exit(f'key not found in upstream.lock: {key}')
PY
