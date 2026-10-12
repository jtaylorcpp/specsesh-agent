# cloudflare-worker example

A Worker that runs Agent Script as crash-safe tasks inside a Cloudflare Durable Object, using `AgentScriptHost` from `@specsesh/agent/cloudflare`. Runs go to Workers AI in production. For local development it adds a **faux mode**: a scripted fake model, so you can run, test and kill-and-resume scripts without a Cloudflare account.

The full walkthrough is the guide [Agents on Cloudflare](../../guides/05-cloudflare.md).

## What is here

| File | What it is |
|---|---|
| `src/index.ts` | The Worker. `FauxAgentScriptHost` subclasses the published `AgentScriptHost` and adds faux mode through `createModel()` and `beforeRoutes()`; `fetch` forwards `/runs/<host>` to the object named `<host>`, and `/agent/...` to `FauxAgentHost`. |
| `src/agent-host.ts` | `FauxAgentHost`, built with `defineAgentHost` from an `AgentConfig`: faux models `default` and `reviewer`, an in-memory workspace. See [A host built from a config](#a-host-built-from-a-config). |
| `wrangler.jsonc` | Worker `agentscript-cloudflare`: `nodejs_compat`, the `AI` binding, the Durable Object bindings `HOST` and `AGENT_HOST`, and migrations `v1` and `v2` declaring both classes SQLite-backed. |
| `test/routes.sh` | Checks every route and status code on `wrangler dev --local`. |
| `test/crash-resume.sh` | Kills the process mid-step and checks the run finishes after a restart. |

## Run it locally

From the repository root, install and build once (`pnpm install`, `pnpm build`), then:

```bash
cd examples/cloudflare-worker
npx wrangler dev --local --var AGENTSCRIPT_FAUX:1
```

`--local` keeps the Durable Object's storage on your disk. Workers AI is not available locally, which is why you turn on faux mode with `AGENTSCRIPT_FAUX=1`. With it off, steps need Workers AI, which `--local` does not provide.

Run a script by posting it with the faux answers for its model steps, in order. `{ "result": { ... } }` answers a step that writes variables, `{ "text": "..." }` a plain step. For `examples/hello-world/hello.agent`:

```bash
jq -n --rawfile s ../hello-world/hello.agent '{
  source: $s,
  entry: ["greet", "decide", "sign_off"],
  variables: { name: "Ada" },
  faux: [ { result: { greeting: "Hello, Ada!" } }, { text: "Calm goodbye." } ]
}' | curl -s -X POST "http://127.0.0.1:8787/runs/demo?wait=1" -H 'content-type: application/json' --data @-
```

## Routes

| Request | Answer |
|---|---|
| `POST /runs/<host>` with `{ source, entry?, variables?, faux? }` | `202` `{ "task": <id> }` |
| `POST /runs/<host>?wait=1` | `200` `{ "task": <id>, "result": <RunResult> }` |
| `GET /runs/<host>/<task>` | `200` `{ task, status: "running", phase, step }`, or `{ task, status: "terminal", outcome }`; `404` `no task <id>` if unknown |
| `POST /runs/<host>/faux` with an array of responses | `200` `{ "queued": <count> }` (faux mode only) |

Also: `422` with an `error` when the script is refused before it runs; `400` when `faux` is sent and faux mode is off; `404` for any other path or method. `<host>` names a Durable Object: each name has its own storage and its own task IDs. Task IDs are numbers; read yours from the start response.

Faux settings, all `--var NAME:VALUE`: `AGENTSCRIPT_FAUX` (`1` turns it on), `AGENTSCRIPT_FAUX_TPS` (tokens per second, to make a step slow enough to interrupt), `AGENTSCRIPT_FAUX_SEED` (a JSON array of responses queued when the object starts, so a restarted object can finish a resumed step).

## A host built from a config

`FauxAgentHost` (`src/agent-host.ts`) is the other way to host scripts: `defineAgentHost<Env>(config)` builds the Durable Object class from the same `AgentConfig` a Node host uses, so a run gets the config's workspace actions (`read_file`, `edit_file`, …) and any granted `agent` delegates. It needs no `AGENTSCRIPT_FAUX`: its models are always faux.

- **Models.** `default` and `reviewer`, two models of one faux provider. In each step the model first calls the step's tool with `{ content: "new" }`, then answers `done by <model>`, so a result's steps show which model ran.
- **Workspace.** `memoryWorkspace({ "notes.txt": "old" })`, one per object.
- **Delegates.** None, so the runners are the default `{ agent }`.

For real models, swap the factories for Workers AI:

```ts
models: { default: (env) => workersAI(env.AI!, "@cf/meta/llama-4-scout") },
```

Its routes are the ones above under `/agent`, without `faux`, plus `model` and a workspace read:

| Request | Answer |
|---|---|
| `POST /agent/runs/<host>[?wait=1]` with `{ source, entry?, variables?, model? }` | as `POST /runs/<host>`; `model` is `default` or `reviewer` (`default` when absent), anything else `400` naming it and listing the models |
| `GET /agent/runs/<host>/<task>` | as `GET /runs/<host>/<task>` |
| `GET /agent/workspace/<host>/<path>` | `200` `{ path, content }` from that object's workspace; `404` if there is no such file (a test hook of this example, not part of `defineAgentHost`) |

## Test it

```bash
pnpm test:cloudflare                        # from the repository root: crash-resume.sh, then routes.sh
bash examples/cloudflare-worker/test/routes.sh   # the routes only
```

`routes.sh` starts three local servers on ports 8801 to 8803, prints `PASS` or `FAIL` for each spec scenario and exits non-zero if any failed. It needs `curl`, `jq`, `python3` and `node`, and no credentials. It skips the two scenarios that need the real Workers AI binding. Nothing here runs `wrangler deploy`.

## Limits

`AgentScriptHost` runs scripts without actions: it has no workspace. `FauxAgentHost` has one, but only in memory, so it is lost when the object is evicted. See the [roadmap](../../packages/agent/README.md#roadmap).
