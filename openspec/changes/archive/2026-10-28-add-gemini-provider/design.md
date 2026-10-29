## Context

`google` is in pi-ai's `builtinModels()` (`@earendil-works/pi-ai` 1.1.0): a static catalog of 22 models on the `google-generative-ai` API, base URL `https://generativelanguage.googleapis.com/v1beta`, auth `envApiKeyAuth` on `GEMINI_API_KEY` only. The step, tool loop and streaming paths in `src/pi/port.ts` are provider-neutral; `forceTool` already maps `google-generative-ai` to `toolChoice: "any"`. pi-ai's adapter rejects a custom `fetch` but honours `model.baseUrl` (through `GoogleGenAI`'s `httpOptions`), so a fake server works once the models point at it.

Ollama's surface (from `add-ollama-provider`), which this change mirrors: `src/pi/ollama.ts`, `withOllama` in `src/bin/models.ts` and its call sites in every bin and `spec-cli.ts`, `docs/providers/ollama.md`, the matrix row, `llm providers ollama`, `fake-ollama.ts`, two crash fixtures, CLI scenarios in `pi/cli`, `durable/cli` and `task/cli`, and `scripts/test-ollama.mjs`.

## Decisions

1. **Names.** The provider id stays pi's `google`: renaming it would break `--provider google` and every stored durable ref. The page, the matrix row and the `llm providers` name are `gemini`, which is what users search for; the page says the provider id is `google`. The usage-docs test maps row `gemini` to provider `google`.
2. **No default model.** Like Ollama, a run on `google` names `--model`. A per-provider default would change three CLI resolution requirements and `DEFAULT_MODEL` for one provider. The docs and the live test use `gemini-3.5-flash`, the newest Flash in the catalog without "preview" in its id.
3. **`GEMINI_BASE_URL`.** The counterpart of `OLLAMA_HOST`: the option, else the env var, else pi's default, trailing `/` removed. It lets the CLI tests point at a fake server, and a user point at a compatible gateway. When it equals the default, `registerGemini` changes nothing.
4. **`registerGemini(models, { baseUrl?, env? })`.** When the URL differs from the default, it re-sets the `google` provider (the same provider object, every model's `baseUrl` replaced) with `setProvider`. Then it checks the key with `geminiKeyIssue`. It resolves `{ ok: true, baseUrl, models: <count> }` or `{ ok: false, baseUrl, reason }` and never rejects. It makes no request: the catalog is static, and listing models would need the key and cost a round trip.
5. **When the CLIs call it.** At the same points as `withOllama`, under a `withGemini` beside it, and only when a needed ref is on `google`: the run's model, the stored model on `resume` and `answer`, and the config's `models` entries.
   - `agent run` prints `google: GEMINI_API_KEY is not set` and exits `1`, as `ensureOllama` does.
   - `durable`, `task` and `change` print the same line and exit `2`, before a task or loop exists.
   - `agent models google` does not check the key: the catalog is local.
6. **The fake server** (`__tests__/pi/fake-gemini.ts`). It serves `POST /v1beta/models/<id>:streamGenerateContent?alt=sse` (and the path without `/v1beta`, for a base URL with none). It answers queued replies as SSE `data:` chunks of `GenerateContentResponse`: text parts, or a `functionCall` part, with `finishReason: "STOP"` and `usageMetadata`. It records each request body, so tests can assert `toolConfig.functionCallingConfig.mode` and the `functionResponse` parts sent back.
7. **Failure categories.** The Google adapter attaches no HTTP status, so `toOutcome` reports every Google failure as `unknown`, and a missing key at request time as `Provider is not configured: google`. The pre-run check makes that second case rare from the CLIs. The page's Limits say so. A status mapping is parked, since it needs a pi-ai change or parsing message text, which `pi/port` forbids.
8. **The live test** (`scripts/test-gemini.mjs`, `pnpm test:gemini`). It is `test-ollama.mjs`'s structure:
   - It needs the built bins, and skips (exit 0) when `GEMINI_API_KEY` is unset.
   - The model is `GEMINI_TEST_MODEL`, else `gemini-3.5-flash`.
   - A durable `triage.agent` run is killed after the first step starts, then resumed.
   - Then a one-task loop runs in a temporary repo.
   - Each run is bounded by `GEMINI_TEST_TIMEOUT_MS` (default 10 minutes).
   - It prints outcomes and never hides a model's failure.

## Testing

- **pi/gemini.** These run against the fake server with `GEMINI_API_KEY=test` in a scoped env:
  - exports, base URL precedence, and `registerGemini` with and without a key;
  - a structured step (the request has `functionCallingConfig.mode` `ANY` and the call becomes the result);
  - a text-only reply fails with `received none`;
  - a tool-loop round trip (the second request carries a `functionResponse`);
  - streamed `text_delta`s.
- **CLIs.** The same as Ollama's scenarios, with `GEMINI_BASE_URL` and `GEMINI_API_KEY` set for the child or the injected env. The crash fixtures copy `crash-ollama-child.ts` and `crash-ollama-loop-child.ts`.
- **Docs.** The usage-docs and llm tests take the eighth page and the new row.
