# workers-ai

Cloudflare Workers AI through the Worker's `AI` binding, for scripts hosted in a Durable Object.

## Setup

Bind Workers AI in `wrangler.jsonc` and hand the binding to the host:

```jsonc
{ "ai": { "binding": "AI" } }
```

```ts
import { defineAgentHost, workersAI } from "@specsesh/agent/cloudflare";
import { memoryWorkspace } from "@specsesh/agent/durable";

export class Host extends defineAgentHost<Env>({
  models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") },
  workspace: () => memoryWorkspace(),
}) {}
```

`workersAI(binding, modelId)` is a `ModelFactory` result: a pi-ai provider built with `createAI({ binding })` from `agents/models/pi-ai`, and the model on it. Building one never calls the binding. There is no key: the binding is the credential.

`AgentScriptHost`, the fixed host, uses Workers AI by default with the same binding, on `AGENTSCRIPT_MODEL` or `@cf/moonshotai/kimi-k2.7-code`.

## Models

Any Workers AI model id (`@cf/...`). Name several under `models`; a `POST` to a `defineAgentHost` host picks one with `model` in the body (`default` when absent), and an unknown name answers `400`. `AgentScriptHost` runs every step on its one model and ignores `model`.

## Where it runs

Only in a Cloudflare Worker, inside an `AgentScriptHost` or `defineAgentHost` Durable Object: the `AI` binding exists nowhere else. The `specsesh` commands don't register it, so `--provider workers-ai` is refused on Node. pi-ai's own `cloudflare-workers-ai` provider is a different thing, reached on an API key, and is one of the [API-key providers](api-keys.md). Locally, `wrangler dev --local` runs the Worker.

## Limits

- Cloudflare only, and nothing in this package has been deployed yet. The binding's real shape is checked at the first deploy.
- `workers-ai.ts` imports only `agents/models/pi-ai`, so it loads in plain Node, but a model built from it needs a real `AI` binding to answer.
- A model that answers a structured step without calling `submit_result` fails the step; how reliably it calls the tool depends on the model.
