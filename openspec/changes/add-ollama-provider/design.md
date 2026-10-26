## Context

pi-ai 1.1.0 has no `ollama` provider, but it has the pieces: `createProvider` with `fetchModels` for a dynamic catalog, `Models.refresh({ providers, allowNetwork, force })`, and the `openai-completions` API with per-model `compat` flags. Ollama serves `/v1/chat/completions` (OpenAI-compatible, tools included) and lists pulled models at `/api/tags`. The CLIs and harnesses resolve models with the synchronous `getModel`, so a dynamic catalog must be loaded before they look.

## Goals / Non-Goals

**Goals:** `--provider ollama` on `agentscript-pi`; a provider and a `registerOllama` helper that `add-ollama-durable` reuses; tests with no live server.

**Non-Goals:** the durable and task CLIs (next change); Ollama's native `/api/chat`; pulling models; Cloudflare.

## Decisions

1. **`src/pi/ollama.ts`, exported from `./pi`.** It is provider code like the rest of `src/pi`; the core stays free of network code. No new dependency.
2. **Reuse pi-ai's `openai-completions` implementation.** `createProvider({ id: "ollama", api: lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions")…) })`, or however pi-ai's own OpenAI-compatible providers wire it; read `providers/*` for the pattern before writing it. No hand-written HTTP client for chat.
3. **Compat flags are fixed on every model:** `supportsStore: false`, `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `maxTokensField: "max_tokens"`. Ollama rejects or ignores the others; pi's URL auto-detection doesn't know `localhost:11434`.
4. **Keyless auth.** The auth entry resolves to a placeholder API key (`ollama`), which the OpenAI-compatible path sends as a bearer token and Ollama ignores. Nothing reads an env var for it.
5. **The catalog.** `fetchModels` calls `GET <baseUrl>/api/tags` with `fetch` and maps each `models[].name` through `ollamaModel`. `options.models` (ids) is the static baseline. `registerOllama` calls `refresh({ providers: ["ollama"], allowNetwork: true, force: true })` and reads `errors.get("ollama")` for `reason`; a non-2xx or malformed body is an error with the status or parse message.
6. **Fixed limits.** `contextWindow` 32768 and `maxTokens` 8192 for every model. `/api/show` could give the real context length per model, at one request per model; not worth it here.
7. **The CLI.** `agentscript-pi` calls `registerOllama(models)` only when the provider is `ollama` (for `run` and `models`), so no other command touches the network. Unreachable → `ollama: not reachable at <url>: <reason>`, exit 1.

## Testing

A fake Ollama server in `__tests__/pi/fake-ollama.ts` (`node:http` on port 0): `/api/tags` from a list, `/v1/chat/completions` answering with a scripted text or tool-call response in the streaming SSE shape pi-ai's client expects, recording each request body. `add-ollama-durable` reuses it. Unreachable: listen, close, use the port.

## Risks

- **Forced tools on small models.** Ollama passes `tool_choice` to models whose template supports tools; others may answer in text. That fails the step by the existing rule ("received none"). Verified live on `qwen3.5:latest` by hand after the build; record the result in this file.
- **pi-ai's compat detection** may still set fields by URL; the explicit `compat` on each model wins.
