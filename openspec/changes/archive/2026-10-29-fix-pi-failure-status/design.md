## Context

Probe (2026-10-29, `@earendil-works/pi-ai` 1.1.0): a local server answering `401`, `429` and `500` with a JSON body. Through `createPiReasoningPort`, every step failed `unknown` on `anthropic-messages`, `openai-responses`, `openai-completions` (an `ollamaProvider` model) and `google-generative-ai`. In each adapter, the SDK error carries the status (`error.status`), `normalizeProviderError` extracts it, and `formatProviderError` folds it into `errorMessage` as text. No diagnostic is appended on that path. Only `pi-messages` and `openai-codex-responses` append diagnostics with a code.

`ProviderRequestOptions.fetch` is honoured by the Anthropic, OpenAI (both APIs), Mistral and other HTTP adapters. A wrapping `fetch` saw `[401]` and `[429]` on Anthropic, OpenAI and Ollama in the same probe. `onResponse` fires only after a successful response, so it can't help. `google-generative-ai` and `google-vertex` throw `Custom fetch is not supported` for any `fetch` other than `globalThis.fetch`.

`@google/genai`'s `throwErrorIfNotOK` throws `ApiError({ message: JSON.stringify(errorBody), status })`. The body is the response's JSON, or, for a non-JSON response, `{ error: { message, code: <status>, status: <statusText> } }`. Google's own error body is `{ error: { code, message, status } }`, with `code` the HTTP status. pi's Google catch puts `error.message` into `errorMessage` unchanged.

## Decisions

1. **A recording `fetch` per request.** `send` creates `fetch = async (input, init) => { const response = await globalThis.fetch(input, init); status = response.status; return response; }` and passes it in the request options. `globalThis.fetch` is read at call time, so a stubbed or Worker `fetch` is used. The last response wins, so after pi's own retries (if any) the final status counts. The fetch is per request: tool-loop rounds and concurrent steps never share one.
2. **Not for Google.** When `model.api` is `google-generative-ai` or `google-vertex`, `send` passes no `fetch` (decision 4 covers those).
3. **`toOutcome(message, wantsStructured, status?)`.** For the `default` branch the code is the first diagnostic `error.code`, else `status`. `categoryFromStatus` maps it, and `200` still maps to nothing, so a stream that fails after a `200` stays `unknown`. The parameter is optional, so existing callers and the exported signature stay compatible.
4. **Google's envelope, and why it is not "message text".** `pi/port` forbids categories from message text, meaning prose matching ("rate limit" in a sentence). Here `errorMessage` is the SDK's `JSON.stringify` of the response body, and the value read is the number Google defines as the HTTP status. The rule, as `googleStatus(message)` in `src/pi/categories.ts`:
   - only for `google-generative-ai` and `google-vertex`;
   - `JSON.parse(errorMessage)` must succeed on the whole string;
   - the result must be an object whose `error` is an object whose `code` is an integer.
   
   No substring search, no regex and no keyword. A mid-stream error (the SDK's `got status: …` prefix) does not parse and stays `unknown`. That is documented.
5. **Order.** Diagnostic code, then the recorded or Google status, then nothing. When pi-ai starts carrying the status, nothing changes for callers.
6. **Durable stays out.** pi-durable's `generation.js` calls `runtime.models.streamSimple` with its own options, and `answerStep` sees `settled.reason`, not the assistant message. Threading the status through would mean wrapping the harness's `Models` and reading the conversation back. Parked as "Failure categories in durable runs".

## Testing

- **A status server** (`__tests__/pi/status-server.ts`, new): answers every request with a given status and a JSON body `{ error: { code, message: "nope" } }`. Steps go through `createPiReasoningPort` with `builtinModels()`, each model's `baseUrl` pointed at it:
  - `anthropic` `claude-haiku-4-5` at `429` → `rate_limit`;
  - `openai` `gpt-4o-mini` at `401` → `authentication_failed`;
  - an `ollamaProvider` model at `500` → `server_error`;
  - a tool-loop step (`tools` given, `429`) → `rate_limit`;
  - a streamed step (`429`) → `rate_limit`.
  Each needs only a dummy key in a scoped env (`vi.stubEnv`).
- **toOutcome.** The given status maps when there is no diagnostic code; a diagnostic code wins over it.
- **Gemini.** `fake-gemini.ts` gains an error reply (status and JSON body): `429` → `rate_limit`, `403` → `authentication_failed`. `googleStatus` on a non-JSON message and on a JSON message without an integer `error.code` returns `undefined`.
