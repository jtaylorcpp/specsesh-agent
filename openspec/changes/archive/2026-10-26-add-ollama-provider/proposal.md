## Why

Every way to run a script today needs either a hosted provider's API key or a Claude subscription. A local model is the missing option: free to iterate on, offline, and with nothing leaving the machine. Ollama is the common way to run one, and it serves an OpenAI-compatible API, but pi-ai has no `ollama` provider, and its models are whatever the user has pulled, so no static model list can name them. `--provider ollama` should just work.

## What Changes

- A new `ollamaProvider({ baseUrl?, models? })` in `./pi`: a pi-ai provider with id `ollama`, keyless, on pi-ai's `openai-completions` API against `<baseUrl>/v1`. `baseUrl` defaults to `OLLAMA_HOST`, else `http://localhost:11434`.
- Its models are the ones the server reports (`GET /api/tags`), fetched when the provider is refreshed, and any id can be used through `ollamaModel(id)`, the way `claudeCodeModel` works.
- `registerOllama(models, options?)` sets the provider on a pi-ai collection and refreshes it, so every pulled model then resolves through the synchronous `getModel` the CLIs and harnesses use. An unreachable server leaves the provider registered with no models and answers the URL it tried; it never throws.
- `agentscript-pi` registers it: `--provider ollama --model <id>` runs a script on a local model, and `models ollama` lists the pulled models, or says the server is unreachable at the URL it tried.
- A step that gets no `submit_result` call back fails with the port's existing categories. Ollama's handling of a forced tool varies by model, so the design records which models were verified live.

## Out of scope

- Registering `ollama` in `agentscript-durable` and the task loop. That is `add-ollama-durable`, which builds on `registerOllama`.
- Ollama's native `/api/chat` API, pulling models, and managing the Ollama server.
- Cloudflare: a Worker can't reach a local server.
- Other local servers (LM Studio, vLLM, llama.cpp), even where they speak the same API.

## Capabilities

- **New:** `pi/ollama`.
- **Modified:** `pi/cli`.

## Impact

- `packages/agent/src/pi/ollama.ts` (new), exported from `src/pi/index.ts`. Network code stays in `src/pi`, outside the core; no new dependency.
- `packages/agent/src/bin/agentscript-pi.ts` (registration, `models ollama`, the unreachable message) and its usage text.
- Tests in `__tests__/pi/` against a local fake HTTP server; no live Ollama in `pnpm test`.
- README and `docs/llm/agent.md`: the provider list.
