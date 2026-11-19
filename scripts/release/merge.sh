#!/bin/bash
# merge.sh <worktree> <branch>: merge <branch> into the release worktree; auto-union only head/asset lines, logs, json. Stops on code conflicts.
KIT="$(cd "$(dirname "$0")" && pwd)"; WT="$1"; B="$2"
cd "$WT" || exit 1
git merge --no-ff --no-edit -q "$B" >/dev/null 2>&1
U=(); while IFS= read -r l; do U+=("$l"); done < <(git diff --name-only --diff-filter=U)
[ ${#U[@]} -eq 0 ] && { echo "clean merge $B"; exit 0; }
manual=()
python3 "$KIT/jsonmerge.py" "$B" >/dev/null 2>&1
for f in "${U[@]}"; do
  case "$f" in
    tours/updates.json|vercel.json) ;;
    project-docs/ai-edit-log.md|package.json|.env.example) python3 "$KIT/union.py" "$f" >/dev/null;;
    *) if python3 - "$f" <<'PY'
import re,sys
s=open(sys.argv[1]).read()
blocks=re.findall(r'^<<<<<<< [^\n]*\n(.*?)^>>>>>>> [^\n]*\n',s,re.S|re.M)
ok=all(all((l.strip()=='' or l.startswith('=======') or re.match(r'\s*<(script|link)\b',l)) for l in b.splitlines()) for b in blocks)
sys.exit(0 if ok else 1)
PY
       then python3 "$KIT/union.py" "$f" >/dev/null; else manual+=("$f"); fi;;
  esac
done
python3 -c "import json;json.load(open('vercel.json'));json.load(open('tours/updates.json'));json.load(open('package.json'))" || { echo "json invalid"; exit 2; }
if [ ${#manual[@]} -gt 0 ]; then echo "MANUAL: ${manual[*]}"; exit 3; fi
if git grep -n '^<<<<<<< \|^>>>>>>> ' -- . >/dev/null; then echo "markers remain"; exit 4; fi
git add -A && git commit -q -m "Merge $B into release" && echo "merged $B"
