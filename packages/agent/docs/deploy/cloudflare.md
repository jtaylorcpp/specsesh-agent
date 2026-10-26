# Running on Cloudflare

Inside a Durable Object, where each run is a pi-durable task in the object's SQLite storage, with a Sandbox or Artifacts workspace for its actions; not deployed yet.

## Setup

`@specsesh/agent/cloudflare` needs the durable peers and `agents`. Bind Workers AI and a SQLite-backed Durable Object in `wrangler.jsonc`:

```jsonc
{
  "name": "my-agents",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "HOST", "class_name": "Host" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Host"] }]
}
```

Then pick one of the two host classes and forward requests to it from the Worker's `fetch` (`env.HOST.getByName(name).fetch(request)`: each name is one object, with its own storage and task ids):

- `AgentScriptHost`, the fixed host. It runs every step on one model, Workers AI on `AGENTSCRIPT_MODEL` by default, which a subclass replaces with `createModel()`. It registers no actions.
- `defineAgentHost<Env>(config)`, a class built from the same `AgentConfig` a Node host uses: named model factories (`default` required), a workspace, `allow`, `checks`, the host's own actions and delegate grants.

```ts
import { defineAgentHost, workersAI } from "@specsesh/agent/cloudflare";
import { memoryWorkspace } from "@specsesh/agent/durable";

export class Host extends defineAgentHost<Env>({
  models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") },
  workspace: () => memoryWorkspace(),
}) {}
```

Both serve `POST /runs/<host>` with `{ source, entry?, variables? }` (`202` `{ task }`, or `200` with the result on `?wait=1`) and `GET /runs/<host>/<task>`. A `defineAgentHost` body may also name `model`, a key of `models`: `400` for an unknown one, `422` for a refused start.

## Providers

See the [matrix](../providers/README.md). Each model is a `ModelFactory`, `(env) => { provider, model }`, built once in the object's constructor:

- [workers-ai](../providers/workers-ai.md): `workersAI(env.AI, modelId)` on the `AI` binding; the default for `AgentScriptHost`.
- [API-key providers](../providers/api-keys.md): any pi-ai provider, with its key from `env`.
- [claude-code](../providers/claude-code.md) doesn't run here: a Worker can't start a process. A `defineAgentHost` host's only runner is `agent`, so a delegate granted with runner `claude-code` refuses the harness with `DelegateGrantError`.
- [ollama](../providers/ollama.md) doesn't run here: there is no local server to reach.

## Running and resuming

pi-durable checkpoints every step in the object's storage, and the object's Lifecycle wakes it when pi has unfinished work, so a run survives eviction and a crash and finishes on the model it started on.

A `defineAgentHost` run acts through its config's workspace:

- `memoryWorkspace(files)`: in memory, lost when the object is evicted.
- `sandboxWorkspace(sandbox, { dir, secrets? })`: real files, git and processes in a Cloudflare Sandbox. Reads and writes are confined to `dir`, commands run under `timeout -s KILL`, `publish` commits and pushes, and every secret is redacted as `***`.
- `artifactsSandboxWorkspace(artifacts, sandbox, { repo, fork, dir })`: a `sandboxWorkspace` over a checkout of one Artifacts fork per task, reused after a restart, with a write token for the fork only, always redacted.

Both take the bindings through `SandboxLike` and `ArtifactsLike`, the slices of the SDKs they call, adapted at the host.

Test locally on `wrangler dev --local`, which keeps the object's storage on disk. Workers AI isn't available there, so [`examples/cloudflare-worker`](../../../../examples/cloudflare-worker/README.md) adds faux models: `AGENTSCRIPT_FAUX=1` for its `AgentScriptHost`, and an always-faux `defineAgentHost` host under `/agent`. Its `test/routes.sh` checks every route; `pnpm test:cloudflare` also kills workerd mid-step and checks the run finishes after a restart.

## Limits

- Nothing has been deployed yet: every host, workspace and binding here has run only on `wrangler dev --local` and against fakes. The first deploy must check:
  - the `AI` binding's real shape behind `workersAI`;
  - the Sandbox SDK against `SandboxLike`, and whether its `exec` goes through a shell;
  - the Artifacts binding against `ArtifactsLike`, and whether the write token belongs in a git header or the remote URL;
  - that Lifecycle's alarm wakes an idle object with unfinished work and no incoming request.
- `AgentScriptHost` registers no actions; a script that uses `run` or `reasoning.actions` needs `defineAgentHost`.
- No `claude-code` and no `ollama`, as above.
