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
    if not line[0].isspace():
        node = line.split(':', 1)[0].strip()
    elif node == parts[0]:
        k = line.strip().split(':', 1)[0].strip()
        if k == parts[-1]:
            print(line.split(':', 1)[1].strip().strip('"').strip("'"))
            sys.exit(0)
sys.exit(f'key not found in upstream.lock: {key}')
PY
