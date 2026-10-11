#!/usr/bin/env bash
# Kill workerd mid-step and check the run finishes after a restart, on local Durable Object storage.
#   test/crash-resume.sh [scratch-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
SCRATCH="${1:-$(mktemp -d)}"
PORT=8798
PERSIST="$SCRATCH/do-state"
LOG="$SCRATCH/wrangler-crash.log"
URL="http://127.0.0.1:$PORT/runs/crash"
rm -rf "$PERSIST"; mkdir -p "$PERSIST"

start() { # args: extra wrangler flags
  setsid npx wrangler dev --port "$PORT" --local --persist-to "$PERSIST" --var AGENTSCRIPT_FAUX:1 "$@" >>"$LOG" 2>&1 &
  echo $! >"$SCRATCH/wrangler.pid"
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && return 0; sleep 1; done
  echo "wrangler did not start"; tail -20 "$LOG"; exit 1
}
kill_hard() { kill -9 -- "-$(cat "$SCRATCH/wrangler.pid")" 2>/dev/null || true; sleep 1; }
trap kill_hard EXIT

body=$(python3 - <<'PY'
import json,re
src=open('../agentscript-durable/__tests__/helpers.ts').read()
pipeline=re.search(r'export const PIPELINE = `(.*?)`;', src, re.S).group(1)
long="Escalating. " * 60
print(json.dumps({"source":pipeline,"entry":["classify","gate","respond"],"faux":[{"result":{"severity":"high"}},{"text":long}]}))
PY
)

echo "== start (slow faux: 4 tokens/s)"
start --var AGENTSCRIPT_FAUX_TPS:4
task=$(curl -s -X POST "$URL" -H 'content-type: application/json' --data "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"])')
echo "task $task"

for _ in $(seq 1 90); do
  s=$(curl -s "$URL/$task")
  if echo "$s" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("phase")=="await" and d.get("step")==1 else 1)'; then break; fi
  sleep 1
done
echo "before crash: $s"
sleep 2
echo "== kill -9 mid-step"
kill_hard
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then echo "still up?"; exit 1; fi

echo "== restart (fresh process, same storage, step 2's answer seeded at construction)"
start --var 'AGENTSCRIPT_FAUX_SEED:[{"text":"Escalated after restart."}]'

for _ in $(seq 1 60); do
  s=$(curl -s "$URL/$task")
  echo "$s" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["status"]=="terminal" else 1)' && break
  sleep 1
done
echo "$s" | python3 -c '
import json,sys
d=json.load(sys.stdin)
o=d.get("outcome",{})
r=o.get("result",{})
print("status:", d["status"], "| outcome:", o.get("status"), "| kind:", r.get("kind"))
print("variables:", r.get("variables"))
print("steps:", [(s["subagent"], s["outcome"].get("kind"), s["outcome"].get("text","")[:40], s["outcome"].get("structured")) for s in r.get("steps",[])])
ok = r.get("kind")=="completed" and r.get("variables",{}).get("urgent") is True and r["steps"][-1]["outcome"].get("text")=="Escalated after restart."
print("PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)'
