# Run the e2e gate on a chosen free port, killing the harness itself when done.
# Usage: bash e2e-gate.sh PORT
set -u
PORT="${1:?port}"
cd "$(dirname "$0")/.."
E2E_PORT="$PORT" node test/e2e-client.mjs
RC=$?
# harness cleanup is in its finally block; give it a moment, then verify the
# port is free (kill any straggler listening on our exact port as a safety net)
sleep 2
STRAGGLER=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | sort -u || true)
if [ -n "$STRAGGLER" ]; then
  for p in $STRAGGLER; do kill "$p" 2>/dev/null || true; done
  sleep 1
fi
# puppeteer chromium leftovers from this harness: chromium is launched with a
# user-data-dir under /tmp by puppeteer; kill only PIDs whose cmdline matches
# that ephemeral profile (no blanket pkill -f e2e).
for p in $(pgrep -f "puppeteer-chromium\|chrome.*--user-data-dir=/tmp" 2>/dev/null); do kill "$p" 2>/dev/null || true; done
if ss -ltn | grep -q ":$PORT "; then
  echo "PORT $PORT STILL BOUND after cleanup"
  exit 9
fi
echo "PORT $PORT free after cleanup"
exit $RC
