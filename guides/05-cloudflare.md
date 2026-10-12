# Agents on Cloudflare

The durable run task from [Durable agents on Node](03-durable-agents.md) also runs inside a Cloudflare Durable Object. By the end of this guide you will be able to deploy a Worker that accepts Agent Scripts over HTTP and runs them on Workers AI, start a run and poll for its result, pick the model, develop and test it on your own machine with a scripted fake model and no Cloudflare account, and know what a killed object does. You will also know the main limit today: a Cloudflare host runs scripts **without actions**.

## Prerequisites

A Cloudflare Worker project, Node 22.19 or newer, and:

```bash
npm install @specsesh/agent agents @earendil-works/pi-ai @earendil-works/pi-durable @earendil-works/chord
npm install --save-dev wrangler @cloudflare/workers-types typescript
```

`agents` is the Cloudflare Agents SDK (the package needs `^0.28.0`); the three `@earendil-works` packages are the durable peers. The [example Worker](../examples/cloudflare-worker) pins `agents` 0.28.0, the pi packages 1.1.0 and `wrangler` 4.149.0. A Cloudflare account with Workers AI is needed only to deploy. Local development needs none.

## How it fits together

`AgentScriptHost`, from `@specsesh/agent/cloudflare`, is a Durable Object class. Each object holds its own SQLite storage, and each run is an `agentscript.run` task in it: the same task, phases and checkpoints as on Node. Cloudflare's `PiHarness` gives pi-durable the object's SQLite storage, and its `Lifecycle` wakes the object when pi has unfinished work. Steps run on **Workers AI** through the `AI` binding.

You write a thin Worker that sends `/runs/<host>` requests to the object named `<host>`. One name is one object, so one name is one durable store with its own task IDs.

## Configure the Worker

`wrangler.jsonc`:

```jsonc
{
  "name": "my-agents",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "HOST", "class_name": "Agents" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Agents"] }]
}
```

- `nodejs_compat` is required: the pi packages use Node APIs that workerd provides under this flag.
- `ai` binds Workers AI as `env.AI`. The host reads it by that name.
- `durable_objects.bindings` binds your object class as `env.HOST`. `class_name` must equal the class your `src/index.ts` exports.
- `migrations` declares the class under `new_sqlite_classes`. The object must be SQLite-backed, because pi-durable stores everything in the object's SQLite. A class created without this migration cannot be switched to SQLite later.

## Write the Worker entry

`src/index.ts`:

```ts
import { AgentScriptHost, type AgentScriptEnv } from "@specsesh/agent/cloudflare";

interface Env extends AgentScriptEnv {
  HOST: DurableObjectNamespace<Agents>;
}

export class Agents extends AgentScriptHost<Env> {}      // Workers AI; AGENTSCRIPT_MODEL picks the model

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [, root, host] = new URL(request.url).pathname.split("/");
    if (root !== "runs" || !host) return new Response("use /runs/<host>", { status: 404 });
    return env.HOST.getByName(host).fetch(request);    // one object (one durable store) per host name
  },
} satisfies ExportedHandler<Env>;
```

`AgentScriptEnv` declares the two bindings the host reads: `AI` and the optional string `AGENTSCRIPT_MODEL`. Extend it with your own bindings. The Worker must export the class (`export class Agents`) so the runtime can find it, and forwards the request unchanged. The object answers on `/runs/<host>...` itself.

The object installs the same two extensions the Node CLI does (`AgentScript` and `AgentScriptStepExtension`) and exposes `harness` (a `PiHarness`) and `lifecycle` as fields, should you need them in a subclass.

## The HTTP API

Every response is JSON. Replace `<host>` with any name you like (`demo`, a user ID, a project).

| Request | What it does | Success |
|---|---|---|
| `POST /runs/<host>` | Starts a run. Body: `{ "source": "<script text>", "entry": [...], "variables": {...} }`. `entry` and `variables` are optional. | `202` with `{ "task": <id> }` |
| `POST /runs/<host>?wait=1` | The same, but holds the response until the run finishes. | `200` with `{ "task": <id>, "result": <RunResult> }` |
| `GET /runs/<host>/<task>` | Reports progress or the outcome. | `200`, below |

`GET` answers one of two shapes:

```json
{ "task": 7, "status": "running", "phase": "await", "step": 1 }
```

while the run is going (`phase` is one of `next`, `dispatch`, `await`, `act`, as in the Node guide; `step` is the zero-based index of the model step being run, and is absent at `next`), and

```json
{ "task": 7, "status": "terminal", "outcome": { "status": "completed", "result": { "kind": "completed", "steps": [], "actions": [], "variables": {} } } }
```

once it is done. (Abbreviated: `result` is the full `RunResult`.) Check `outcome.result.kind` too. A run whose step failed is still a completed task with `kind: "failed"`.

Status codes:

| Code | When |
|---|---|
| `202` | A run was started (without `?wait=1`). |
| `200` | `?wait=1` finished, or a `GET` found the task. |
| `422` | The script was refused before anything ran: a construct outside the supported subset, a parse error, a bad `entry`, an undeclared variable, or a declared action (see [Limits](#limits-today)). The body is `{ "error": "<why>" }`. |
| `404` | Unknown task (`{ "error": "no task <id>" }`), any other request the object does not handle (`{ "error": "not found" }`), or, from the Worker, a path that is not `/runs/<host>` (`{ "error": "use /runs/<host>" }`). |
| `400` | Only in the example Worker: a start request carrying `faux` responses, or a `POST /runs/<host>/faux`, when faux mode is off. The published host never returns it. |

Task IDs are numbers, and they are not necessarily `1`, `2`, `3`. Read the ID from the start response; do not guess it.

With `curl` and `jq`, run `hello.agent` from the [README](../packages/agent/README.md#a-script) (the host is `demo`):

```bash
BASE=https://my-agents.example.workers.dev

# start, then poll
TASK=$(curl -s -X POST "$BASE/runs/demo" -H 'content-type: application/json' \
  -d "$(jq -n --rawfile s hello.agent '{source: $s, entry: ["greet", "decide", "sign_off"], variables: {name: "Ada"}}')" \
  | jq .task)
curl -s "$BASE/runs/demo/$TASK"

# or start and wait for the result
curl -s -X POST "$BASE/runs/demo?wait=1" -H 'content-type: application/json' \
  -d "$(jq -n --rawfile s hello.agent '{source: $s, entry: ["greet", "decide", "sign_off"]}')"
```

`?wait=1` holds one HTTP request open for the whole run. Model steps can take long, so for anything beyond a quick script start the run, keep the ID, and poll. The start route reads `source`, `entry` and `variables` only; it does not pass `choices`.

There is no authentication in the base host. Anyone who can reach the Worker can run a script on your Workers AI account. Put access control in front of it: [Add your own checks](#add-your-own-checks).

## Choose the model

By default every step runs on the Workers AI model `@cf/moonshotai/kimi-k2.7-code`. Set the variable `AGENTSCRIPT_MODEL` to run on another Workers AI model, in `wrangler.jsonc`:

```jsonc
{
  "vars": { "AGENTSCRIPT_MODEL": "@cf/qwen/qwen3-coder" }
}
```

(or as a secret or `--var` in other environments). To choose in code, or to use another provider, override `createModel()` and return a provider and a model reference. This sketch picks a model through `createAI` explicitly:

```ts
import { createAI } from "agents/models/pi-ai";
import { AgentScriptHost, type AgentScriptEnv, type ModelChoice } from "@specsesh/agent/cloudflare";

interface Env extends AgentScriptEnv {
  HOST: DurableObjectNamespace<Agents>;
}

export class Agents extends AgentScriptHost<Env> {
  protected override createModel(): ModelChoice {
    const ai = createAI({ binding: this.env.AI as Ai });
    const model = ai("@cf/qwen/qwen3-coder");
    return { provider: ai.provider, model: { provider: model.provider, modelId: model.id } };
  }
}
```

`createModel()` runs once, from the base class constructor, before pi resumes any unfinished work. Two consequences: it may read `this.env` and nothing else of your own (your subclass's fields are not initialised yet), and it must return the one provider the object registers and the model every step uses. Whatever `createModel()` chose is available afterwards as `this.modelChoice`.

The model is the object's, not the request's: a request cannot pick it, and there is no `model` field in the body.

## Add your own checks

`beforeRoutes(request, pi)` runs first on every request that reaches the object. Return a `Response` to answer it yourself, or `undefined` to fall through to the routes above. It is the place for authentication, rate limits and extra routes.

```ts
import { AgentScriptHost, type AgentScriptEnv } from "@specsesh/agent/cloudflare";

interface Env extends AgentScriptEnv {
  HOST: DurableObjectNamespace<Agents>;
  API_TOKEN?: string;
}

export class Agents extends AgentScriptHost<Env> {
  protected override async beforeRoutes(request: Request): Promise<Response | undefined> {
    const token = this.env.API_TOKEN;
    if (token === undefined || request.headers.get("authorization") !== `Bearer ${token}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }, null, 2), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return undefined;
  }
}
```

The second argument, `pi`, is the live `Harness`, if your extra route needs the tasks. Set the token with `wrangler secret put API_TOKEN`. With no token set, this sketch refuses everything.

## Develop locally

`wrangler dev --local` runs your Worker and the object on your machine, with the Durable Object's SQLite on local disk. Workers AI is not available locally (wrangler lists the `AI` binding as not supported), so a real model cannot answer. The example Worker therefore adds a **faux mode**: a scripted fake model that answers with the responses you give it. It exists only in the example (`FauxAgentScriptHost` in `examples/cloudflare-worker/src/index.ts`); the published `AgentScriptHost` has none.

From a checkout of this repository:

```bash
cd examples/cloudflare-worker
npx wrangler dev --local --var AGENTSCRIPT_FAUX:1 --persist-to ./.wrangler/state
```

(Or `pnpm --filter cloudflare-worker-example dev` from the root, adding the flags after it. The example's Worker is named `agentscript-cloudflare` and its object class is `FauxAgentScriptHost`.)

Faux mode is on only when `AGENTSCRIPT_FAUX` is `1`. With it off the example behaves like the published host, on Workers AI.

Run a script by sending the script and the answers for its model steps together. Each model step takes the next queued response in order. A response is `{ "text": "..." }` for plain text, or `{ "result": { ... } }` for a step that writes variables (the fields of its `submit_result`). `hello.agent` has two model steps, so two responses:

```bash
BASE=http://127.0.0.1:8787
jq -n --rawfile s hello.agent '{
  source: $s,
  entry: ["greet", "decide", "sign_off"],
  variables: { name: "Ada" },
  faux: [ { result: { greeting: "Hello, Ada!" } }, { text: "Calm goodbye." } ]
}' | curl -s -X POST "$BASE/runs/demo?wait=1" -H 'content-type: application/json' --data @-
```

`wrangler dev` listens on port 8787 unless you pass `--port`. The reply is `200` with a `RunResult` whose `kind` is `completed` and whose `sign_off` step says `Calm goodbye.` If you queue too few responses, the step that finds the queue empty fails with `No more faux responses queued`, the run ends `failed`, and the request still answers `200`.

Other faux knobs, all example-only:

| Setting | Effect |
|---|---|
| `AGENTSCRIPT_FAUX=1` | Turns faux mode on. |
| `POST /runs/<host>/faux` with a JSON array of responses | Queues responses on their own, answering `{ "queued": <count> }`. Without faux mode: `400`. |
| `AGENTSCRIPT_FAUX_TPS=<n>` | Streams faux output at `n` tokens per second, so a step takes long enough to interrupt. Zero, negative or non-numeric values are ignored. |
| `AGENTSCRIPT_FAUX_SEED=<json array>` | Queues responses when the object is constructed, before pi resumes unfinished work. Needed after a restart: the queue lives in memory, so a restarted object has nothing to answer a resumed step unless you seed it. |

Set variables with `--var NAME:VALUE`.

### Test the routes

The example has a script that exercises every route against `wrangler dev --local`, with no credentials:

```bash
pnpm test:cloudflare              # from the repository root: crash/resume, then the routes
bash examples/cloudflare-worker/test/routes.sh   # the routes only
```

`test/routes.sh` starts three local servers (ports 8801 to 8803), prints `PASS` or `FAIL` per scenario of the `durable/cloudflare` spec, and exits non-zero on any failure. It skips the two scenarios that need the real Workers AI binding (default model and `AGENTSCRIPT_MODEL`).

## Durability on Cloudflare

Every phase of a run is committed to the object's SQLite storage, so an object that is evicted, crashes or is killed resumes its runs, and a step whose answer was committed is not asked again ([What "never repeated" means](03-durable-agents.md#what-never-repeated-means)).

You can watch it locally. Start with slow faux output so the second step takes a while, kill the process hard, and start it again on the same storage:

```bash
# 1. a slow run: 4 tokens per second
npx wrangler dev --local --persist-to ./.wrangler/state --var AGENTSCRIPT_FAUX:1 --var AGENTSCRIPT_FAUX_TPS:4
# start a run whose second faux response is a long text, note the task ID, and poll
# GET /runs/demo/<task> until it reports "phase": "await", "step": 1

# 2. in another terminal, kill the whole process group
kill -9 -- -<wrangler-pid>

# 3. start again on the same storage, seeding the answer the resumed step needs
npx wrangler dev --local --persist-to ./.wrangler/state --var AGENTSCRIPT_FAUX:1 \
  --var 'AGENTSCRIPT_FAUX_SEED:[{"text":"Calm goodbye after restart."}]'
# GET /runs/demo/<task> now reaches "status": "terminal", and the last step's text is the seeded one
```

Nothing started the run again: the first step's answer was already committed, and the restarted object finished the second step. `pnpm test:cloudflare` runs this exact sequence (`test/crash-resume.sh`).

What is verified is a killed process restarted and sent a request. Waking an idle object by Lifecycle's alarm, with no request at all, is how it is designed to work but is not yet verified here. Until it is, poll the run (any request to the object constructs it) rather than relying on an alarm.

## Limits today

- **No actions and no workspace.** `AgentScriptHost` installs the plain extensions, which register no host actions, and a Worker has no directory to confine them to. A script that declares an action is refused up front: the start route answers `422` with an `error` saying `mcpTool://<name> is not registered on this host`, and nothing runs. Scripts with only model steps and logic lines work in full. Actions on Cloudflare are on the [roadmap](../packages/agent/README.md#roadmap), together with a workspace backed by a Cloudflare Sandbox.
- **The model is fixed per object**, as above.
- **No authentication** in the base host; add it in `beforeRoutes`.
- **Workers AI model quality varies.** A step that writes variables needs the model to call `submit_result` correctly; it gets up to three tries, then the step fails.
- **Idle-wake by alarm is unverified**, as above.

## Deploy

When you have tested locally and are ready, deploying is your own final step:

```bash
npx wrangler deploy
```

That publishes the Worker and creates the SQLite-backed object class from your migration. This guide, the example and the repository's tests never run it for you.

## Next

- [Durable agents on Node](03-durable-agents.md): the run task and its guarantees, which are the same here.
- [Actions: letting an agent do work](04-actions.md): what a Node host can do that a Cloudflare host cannot yet.
- [Executing changes with the task loop](07-task-loop.md): the OpenSpec loop that runs on top of durable runs.
- [The OpenSpec ontology](06-openspec.md): the typed records for changes and loops.
- [Writing Agent Script](01-agent-script.md) and [Running a script](02-running-scripts.md): the language and the interpreter.
