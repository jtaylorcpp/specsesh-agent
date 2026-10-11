#!/usr/bin/env bash
# Route-level checks for the Worker and the object, on `wrangler dev --local`. No credentials needed.
#   test/routes.sh [scratch-dir]
# Prints PASS/FAIL per spec scenario (durable/cloudflare); exits non-zero if any failed or errored.
# Not covered offline: "Default Workers AI model" and "AGENTSCRIPT_MODEL picks the Workers AI model"
# (they need the Workers AI binding), and the wrangler.jsonc config scenario (see the static checks below).
set -uo pipefail
cd "$(dirname "$0")/.."
SCRATCH="${1:-$(mktemp -d)}"
FAUX_PORT=8801      # AGENTSCRIPT_FAUX=1, AGENTSCRIPT_FAUX_TPS=abc
PLAIN_PORT=8802     # AGENTSCRIPT_FAUX unset
ZERO_PORT=8803      # AGENTSCRIPT_FAUX=1, AGENTSCRIPT_FAUX_TPS=0
PIDS=()
FAILED=0

cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 -- "-$p" 2>/dev/null; done; true; }
trap cleanup EXIT

start() { # port, name, extra wrangler flags...
  local port=$1 name=$2; shift 2
  setsid npx wrangler dev --port "$port" --local --persist-to "$SCRATCH/state-$name" "$@" >"$SCRATCH/wrangler-$name.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 90); do curl -s -o /dev/null "http://127.0.0.1:$port/" && return 0; sleep 1; done
  echo "wrangler ($name) did not start"; tail -20 "$SCRATCH/wrangler-$name.log"; exit 1
}

# req PORT METHOD PATH [BODY]  → sets STATUS, BODY, HEADERS
req() {
  local port=$1 method=$2 path=$3 data=${4-}
  local args=(-s -m 60 -X "$method" -D "$SCRATCH/headers" -o "$SCRATCH/body" -w '%{http_code}' "http://127.0.0.1:$port$path")
  [ -n "$data" ] && args+=(-H 'content-type: application/json' --data "$data")
  STATUS=$(curl "${args[@]}"); BODY=$(cat "$SCRATCH/body"); HEADERS=$(cat "$SCRATCH/headers")
}

# check NAME CONDITION...  (condition is a command; PASS when it succeeds)
check() {
  local name=$1; shift
  if "$@"; then echo "PASS $name"; else echo "FAIL $name  (status=$STATUS body=$BODY)"; FAILED=1; fi
}
jqt() { printf '%s' "$BODY" | jq -e "$1" >/dev/null 2>&1; }  # jq truthiness test on BODY
status_is() { [ "$STATUS" = "$1" ]; }
is_error() { status_is "$1" && jqt ".error == $(jq -Rn --arg e "$2" '$e')"; }

PIPELINE=$(python3 - <<'PY'
import re
src=open('../agentscript-durable/__tests__/helpers.ts').read()
print(re.search(r'export const PIPELINE = `(.*?)`;', src, re.S).group(1),end="")
PY
)
[ -n "$PIPELINE" ] || { echo "could not read PIPELINE source"; exit 1; }
start_body() { # faux-json
  jq -n --arg s "$PIPELINE" --argjson f "$1" '{source:$s, entry:["classify","gate","respond"], faux:$f}'
}
FAUX_TWO='[{"result":{"severity":"high"}},{"text":"ok"}]'
BAD_SOURCE=${PIPELINE/agent_name: \"pipeline\"/agent_name: \"pipeline\"$'\n\nmodel_config:\n    model: "model://x"'}

start $FAUX_PORT faux --var AGENTSCRIPT_FAUX:1 --var AGENTSCRIPT_FAUX_TPS:abc
start $PLAIN_PORT plain
start $ZERO_PORT zero --var AGENTSCRIPT_FAUX:1 --var AGENTSCRIPT_FAUX_TPS:0

F=$FAUX_PORT

echo "== Worker routing"
req $F GET /
check "A path outside /runs is refused" is_error 404 'use /runs/<host>'
req $F POST /runs/
check "/runs with no host is refused" is_error 404 'use /runs/<host>'
req $F GET /other/x
check "A path outside /runs is refused (other root)" is_error 404 'use /runs/<host>'

echo "== Every response is pretty-printed JSON"
req $F GET /
ct_ok() { printf '%s' "$HEADERS" | tr -d '\r' | grep -qi '^content-type: application/json'; }
pretty_ok() { [ "$BODY" = "$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s),null,2)))')" ]; }
json_error_ok() { ct_ok && pretty_ok && jqt '.error|type=="string"'; }
check "An error response is JSON" json_error_ok

echo "== Start route"
req $F POST /runs/crash "$(start_body "$FAUX_TWO")"
check "A run is started and acknowledged" bash -c "[ '$STATUS' = 202 ] && printf '%s' '$BODY' | jq -e '(.task|type==\"number\") and (.task==(.task|floor))' >/dev/null"
TASK=$(printf '%s' "$BODY" | jq -r .task)

req $F POST "/runs/waiter?wait=1" "$(start_body "$FAUX_TWO")"
check "?wait=1 returns the result" bash -c "[ '$STATUS' = 200 ] && printf '%s' '$BODY' | jq -e '(.task|type==\"number\") and (.result.kind|IN(\"completed\",\"failed\",\"cut-short\"))' >/dev/null"
WAIT_OUT=$BODY

req $F POST /runs/refuse "$(jq -n --arg s "$BAD_SOURCE" '{source:$s, entry:["classify","gate","respond"]}')"
check "A refused script is 422" bash -c "[ '$STATUS' = 422 ] && printf '%s' '$BODY' | jq -e '.error|contains(\"unsupported by this runtime\")' >/dev/null"

req $PLAIN_PORT POST /runs/p "$(start_body "$FAUX_TWO")"
check "faux outside faux mode is 400" is_error 400 'faux responses need AGENTSCRIPT_FAUX=1'
# no task was created: the next start on that object gets the first task id
req $PLAIN_PORT GET /runs/p/1
check "faux outside faux mode is 400 (no task created)" is_error 404 'no task 1'

echo "== Faux responses in the start body are queued, in order"
req $F POST "/runs/ordered?wait=1" "$(start_body '[{"result":{"severity":"high"}},{"text":"second step text"}]')"
check "Faux responses in the body are queued in faux mode" bash -c "printf '%s' '$BODY' | jq -e '.result.kind==\"completed\" and .result.variables.severity==\"high\" and .result.variables.urgent==true and (.result.steps|last|.outcome.text)==\"second step text\"' >/dev/null"

echo "== POST /faux"
req $F POST /runs/q/faux '[{"text":"a"},{"result":{"severity":"high"}}]'
check "Responses are queued" bash -c "[ '$STATUS' = 200 ] && [ \"\$(printf '%s' '$BODY' | jq -c .)\" = '{\"queued\":2}' ]"
req $PLAIN_PORT POST /runs/q/faux '[{"text":"a"}]'
check "Outside faux mode the route is refused" is_error 400 'faux responses need AGENTSCRIPT_FAUX=1'

echo "== GET"
# let the first run finish (it was started without wait)
for _ in $(seq 1 30); do req $F GET "/runs/crash/$TASK"; jqt '.status=="terminal"' && break; sleep 1; done
check "A finished run reports its outcome" bash -c "[ '$STATUS' = 200 ] && printf '%s' '$BODY' | jq -e '.status==\"terminal\" and .outcome.status==\"completed\" and (.outcome.result.kind|type==\"string\")' >/dev/null"
req $F GET /runs/crash/999
check "An unknown task is 404" is_error 404 'no task 999'

echo "== Two host names are two objects"
req $F POST /runs/a "$(start_body "$FAUX_TWO")"
A_TASK=$(printf '%s' "$BODY" | jq -r .task)
req $F POST "/runs/b/faux" '[]'   # touch b so it exists with an empty queue
req $F GET "/runs/b/$A_TASK"
check "Two host names are two objects" bash -c "[ '$STATUS' = 404 ] && printf '%s' '$BODY' | jq -e '.error==\"no task $A_TASK\"' >/dev/null"
req $F GET "/runs/a/$A_TASK"
check "Two host names are two objects (a still has its task)" status_is 200
req $F POST /runs/b "$(start_body "$FAUX_TWO")"
B_TASK=$(printf '%s' "$BODY" | jq -r .task)
check "Two host names are two objects (task ids are independent)" bash -c "[ '$B_TASK' = '$A_TASK' ]"

echo "== Any other request to the object is 404"
req $F DELETE /runs/crash/1
check "An unsupported method" is_error 404 'not found'

echo "== Faux mode / pacing"
check "Faux mode replaces Workers AI" bash -c "printf '%s' '$WAIT_OUT' | jq -e '.result.kind==\"completed\"' >/dev/null"
# TPS=abc on the faux instance: 120 tokens of text would take ~30s at 4 tps; it must finish at the default pace.
LONG=$(python3 -c 'print("Escalating. "*60,end="")')
SECONDS=0
req $F POST "/runs/pace?wait=1" "$(start_body "$(jq -nc --arg t "$LONG" '[{"result":{"severity":"high"}},{"text":$t}]')")"
check "An invalid pace is ignored (abc)" bash -c "[ '$STATUS' = 200 ] && [ $SECONDS -lt 15 ] && printf '%s' '$BODY' | jq -e '.result.kind==\"completed\"' >/dev/null"
SECONDS=0
req $ZERO_PORT POST "/runs/pace?wait=1" "$(start_body "$(jq -nc --arg t "$LONG" '[{"result":{"severity":"high"}},{"text":$t}]')")"
check "An invalid pace is ignored (0)" bash -c "[ '$STATUS' = 200 ] && [ $SECONDS -lt 15 ] && printf '%s' '$BODY' | jq -e '.result.kind==\"completed\"' >/dev/null"

echo "== wrangler.jsonc"
check "The object uses SQLite storage" node -e '
const c=JSON.parse(require("fs").readFileSync("wrangler.jsonc","utf8").replace(/^\s*\/\/.*$/gm,""));
const ok=c.name==="agentscript-cloudflare"&&c.main==="src/index.ts"&&c.compatibility_date==="2026-10-01"&&c.compatibility_flags.includes("nodejs_compat")&&c.ai.binding==="AI"&&c.durable_objects.bindings.some(b=>b.name==="HOST"&&b.class_name==="AgentScriptHost")&&c.migrations.some(m=>m.tag==="v1"&&m.new_sqlite_classes.includes("AgentScriptHost"));
process.exit(ok?0:1)'

echo "== Workers AI default / AGENTSCRIPT_MODEL"
echo "SKIP Default Workers AI model (needs the Workers AI binding)"
echo "SKIP AGENTSCRIPT_MODEL picks the Workers AI model (needs the Workers AI binding)"

[ $FAILED = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
