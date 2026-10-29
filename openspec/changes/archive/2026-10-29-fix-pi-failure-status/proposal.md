## Why

`toOutcome` takes a failure's category from the HTTP status in pi's diagnostics, but on pi-ai 1.1.0 no adapter in our path puts it there. Measured against a local server answering 401, 429 and 500, every step on `anthropic-messages`, `openai-responses`, `openai-completions` (Ollama) and `google-generative-ai` fails `unknown`. `docs/providers/api-keys.md` says otherwise. pi-ai works the status out and then drops it; the port can recover it itself without reading message prose.

## What Changes

- **The port records each response's status.** Every request the pi port makes passes pi a `fetch` that calls `globalThis.fetch` and keeps the response's status. An `error` stop with no diagnostic code takes its category from that status. It covers the one-shot step, every tool-loop round and the settling request, streamed or not.
- **Google's adapters refuse a custom `fetch`**, so for `google-generative-ai` and `google-vertex` the port passes none. It reads the status from Google's error envelope instead: when `errorMessage` parses, whole, as a JSON object whose `error.code` is an integer, that integer is the status. That is the shape `@google/genai` throws on every HTTP error. Anything else stays `unknown`.
- **`toOutcome(message, wantsStructured, status?)`**: an optional status, used when the message's diagnostics carry no code. The diagnostic code still wins.
- **Docs.** `api-keys.md`, `ollama.md` and `gemini.md` say which failures get a category: one-shot runs, from the status; durable runs, still `unknown`.

## Out of scope

- **Durable runs.** pi-durable calls the model itself and settles a failed step with a reason, not the message, so durable, task and change runs still report `unknown`. Parked.
- **A pi-ai change** that keeps the status in diagnostics. Parked as an upstream request; when it lands, the diagnostic code wins and this becomes a fallback.
- **Retrying by category.** Categories stay labels.

## Capabilities

- **Modified:**
  - `pi/port`;
  - `pi/gemini`.

## Impact

- `packages/agent/src/pi/port.ts` (`send`, `toOutcome`), maybe a small helper in `src/pi/categories.ts`.
- Tests: `__tests__/pi/port.test.ts` or a new `__tests__/pi/failure-status.test.ts` with a local status server; `__tests__/pi/gemini.test.ts` and `fake-gemini.ts` (an error reply).
- `docs/providers/{api-keys,ollama,gemini}.md`, `openspec/parked.md`, `CLAUDE.md` (the `./pi` line on categories).
