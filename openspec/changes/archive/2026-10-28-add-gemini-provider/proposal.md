## Why

The Gemini API already runs through pi-ai's built-in `google` provider on `GEMINI_API_KEY`, on every command and on Cloudflare. But it is reachable only by knowing that: it has no page, no row in the provider matrix, no `specsesh llm providers` entry and no test against its wire format. A missing key surfaces only after a durable task or loop has been created, as `unknown: Provider is not configured: google`. Ollama has all of that. This change brings Gemini to the same level: setup, models, refusals, tests and a live check.

## What Changes

- **`src/pi/gemini.ts`**, exported from `@specsesh/agent/pi`:
  - `GEMINI_PROVIDER` (`"google"`) and `geminiBaseUrl(options?)`: the option, else `GEMINI_BASE_URL`, else pi's default `https://generativelanguage.googleapis.com/v1beta`.
  - `geminiKeyIssue(env?)`: `undefined` when `GEMINI_API_KEY` is set, else `GEMINI_API_KEY is not set`.
  - `registerGemini(models, options?)`: points the `google` provider's models at the base URL when it differs from the default, then checks the key. It never throws and makes no request, like `registerOllama`.
- **The CLIs check before they start.** When a run, resume, loop or named model needs `google`, the bins call `registerGemini`. Without a key:
  - `agent run` prints `google: GEMINI_API_KEY is not set` and exits `1` before any request;
  - `durable`, `task` and `change` print the same line and exit `2`, before a task or loop exists.
  - `agent models google` still lists the catalog without a key.
- **Tests on the Gemini wire.** A fake Gemini server (`streamGenerateContent` over SSE) covers forced structured steps, the tool loop, streaming and the text-only failure. The CLI tests mirror Ollama's, crash and resume included.
- **Docs.**
  - A `docs/providers/gemini.md` page (Setup, Models, Where it runs, Limits).
  - A `gemini` row in the matrix: yes everywhere, Cloudflare included.
  - `specsesh llm providers gemini`, plus Gemini sections in `docs/llm/{agent,durable,task}.md`, the README and `CLAUDE.md`.
- **`pnpm test:gemini`**, opt-in, built bins: a durable run killed mid-step and resumed, then a one-task loop, on `GEMINI_TEST_MODEL` (default `gemini-3.5-flash`). It skips when `GEMINI_API_KEY` is unset.

## Out of scope

- **A default model per provider.** As with Ollama, `--provider google` needs `--model`.
- **Failure categories from Google's HTTP status.** pi-ai's Google adapter reports no status, so every Google failure is `unknown`, as on Ollama. Documented and parked.
- **Vertex AI** (`google-vertex`), and the Gemini CLI as a runner.
- **A reasoning-level option.** Gemini uses its default thinking.

## Capabilities

- **New:** `pi/gemini`.
- **Modified:**
  - `pi/cli`;
  - `durable/cli`;
  - `task/cli`;
  - `package/usage-docs`;
  - `package/llm`.

## Impact

- `packages/agent/src/pi/gemini.ts` (new) and `src/pi/index.ts`.
- `src/bin/models.ts`, the four bins and `src/task/spec-cli.ts`: a `withGemini` beside `withOllama`.
- `src/cli/llm.ts`, `scripts/check-assets.mjs`, `docs/providers/{README,gemini}.md`, `docs/llm/*.md`, `README.md`, `CLAUDE.md`.
- Tests: `__tests__/pi/gemini.test.ts` and `__tests__/pi/fake-gemini.ts` (new), crash fixtures, and the pi, durable, task, usage-docs and llm CLI tests.
- `scripts/test-gemini.mjs` (new) and a root `test:gemini` script.
