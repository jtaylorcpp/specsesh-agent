# gemini

Gemini through pi-ai's built-in `google` provider, on `GEMINI_API_KEY`.

## Setup

Export the key and name the model; the provider id is `google`, not `gemini`:

```bash
export GEMINI_API_KEY=...
specsesh agent run triage.agent --provider google --model gemini-3.5-flash
```

`--model` is required: `google` has no default model. `AGENTSCRIPT_PROVIDER=google` and `AGENTSCRIPT_MODEL`, or `task.provider` and `task.model` in `agentscript.config.json`, work as for any provider.

`GEMINI_BASE_URL` is optional and points the provider at a compatible gateway; the default is `https://generativelanguage.googleapis.com/v1beta`, and a trailing `/` is dropped.

The CLIs check the key before anything starts, whenever a command needs a model on `google` (the run's model, the stored model on `resume` or `answer`, or a model named in `agentscript.config.json`). Without it they print `google: GEMINI_API_KEY is not set`: `specsesh agent run` exits `1` before any request, and `durable`, `task` and `change` exit `2` before a task or loop exists. From code, `registerGemini(models)` from `@specsesh/agent/pi` does the same check and applies `GEMINI_BASE_URL`; it never throws and makes no request.

## Models

pi-ai's static catalog for `google`, listed without a key:

```bash
specsesh agent models google
```

`gemini-3.5-flash` is the recommended model, and the one the examples and `pnpm test:gemini` use. A model the catalog doesn't list is refused before the run starts: `no model "<id>" on provider "google"`.

## Where it runs

Everywhere: `specsesh agent`, `durable`, `task` and `change` on Node, and a Cloudflare host built with `defineAgentHost`. `durable resume` and `task resume` run on the model the run started on. On Cloudflare, store the key as a Worker secret (`wrangler secret put GEMINI_API_KEY`) and hand it to the provider from `env`:

```ts
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { defineAgentHost } from "@specsesh/agent/cloudflare";
import { memoryWorkspace } from "@specsesh/agent/durable";

export class Host extends defineAgentHost<Env>({
  models: {
    default: (env) => ({
      // pi's google provider, its key from the Worker's env instead of the process's.
      provider: {
        ...googleProvider(),
        auth: { apiKey: { name: "Gemini API key", resolve: async () => ({ auth: { apiKey: env.GEMINI_API_KEY } }) } },
      },
      model: { provider: "google", modelId: "gemini-3.5-flash" },
    }),
  },
  workspace: () => memoryWorkspace(),
}) {}
```

The [matrix](README.md) has every pair, and [running on Cloudflare](../deploy/cloudflare.md) the rest of the host.

## Limits

- Every failed Google request is categorised `unknown`: pi-ai's Google adapter reports no HTTP status, and categories never come from the message text. A key missing at request time shows as `unknown: Provider is not configured: google`; the CLIs' check makes that rare.
- No reasoning-level option: Gemini uses its default thinking.
- Vertex AI (`google-vertex`) is not covered, nor the Gemini CLI as a runner.
- Billed per token to the key's account; the key is read from the environment only and never stored or printed.
