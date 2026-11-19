#!/bin/bash
# run-suite.sh: run every scripts/test-*.mjs and scripts/check-*.mjs.
# Logs go to $SUITE_LOGS (default: a temp folder). Exits 1 if anything fails
# beyond the known, accepted failures below.
#   bash scripts/release/run-suite.sh            # everything (~15-25 min)
#   bash scripts/release/run-suite.sh gen video  # only files whose name contains one of these words
cd "$(dirname "$0")/../.." || exit 1
ALLOWED="test-color-swatch-states test-newsletter-header-options test-reels-transcription-framework"
LOGS="${SUITE_LOGS:-$(mktemp -d -t frameup-suite)}"
mkdir -p "$LOGS"
fails=""; n=0
for t in scripts/test-*.mjs scripts/check-*.mjs; do
  name=$(basename "$t" .mjs)
  if [ $# -gt 0 ]; then hit=0; for w in "$@"; do case "$name" in *"$w"*) hit=1;; esac; done; [ $hit = 1 ] || continue; fi
  n=$((n+1))
  if node "$t" >"$LOGS/$name.log" 2>&1; then echo "ok   $name"; else echo "FAIL $name"; fails="$fails $name"; fi
done
unexpected=""; for f in $fails; do case " $ALLOWED " in *" $f "*) ;; *) unexpected="$unexpected $f";; esac; done
echo "ran $n files; logs in $LOGS"
echo "failed:${fails:- none}"
if [ -n "$unexpected" ]; then
  echo "NEW FAILURES:$unexpected"
  echo "(UI sweeps can be flaky under load: rerun one alone with node scripts/<name>.mjs before treating it as real)"
  exit 1
fi
echo "suite OK (only the known, accepted failures)"
