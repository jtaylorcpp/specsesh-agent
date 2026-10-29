## Context

The consumer's issue traces the failure through `./task` → `test-pick.js` → `pi/index.js` → `ollama.js` → pi-ai's `api/openai-completions.lazy`, whose `lazyApi(() => import("./openai-completions.js"))` makes Bun wrap pi-ai's shared modules (`models.js`, `utils/event-stream.js`, `api/lazy.js`) in `__esm` initialisers. Tree-shaking then drops the unused Ollama path, and with it the only `init_models()` call. Reproduced here on Bun 1.4.2: 0.4.4 and 0.4.5 both throw, with 5 wrappers.

## Decisions

1. **Ollama on the eager API.** `@earendil-works/pi-ai/api/openai-completions` exports `stream` and `streamSimple`, the shape `lazyApi` wraps, so `api: { stream, streamSimple }` behaves the same. Measured: the repro prints `stream ok` with 0 wrappers, and so does importing `./pi` directly, even with no externals. Rejected: the issue's dynamic `import("../pi/index.js")` inside `pickTests`. It still reaches pi-ai both ways, and it leaves `./pi` broken for anyone who imports it beside the claude-code provider.
2. **`pickTests` loads `providers/all` dynamically again,** reverting 0.4.5 there. `providers/all` reaches every pi-ai `*.lazy` module. Reached statically, it breaks the bundle and can't be marked external in `--compile` (the import runs at start). Reached dynamically, a consumer marks `@earendil-works/pi-ai/providers` external, and `--compile` works because the import never runs unless `pickTests` builds a pi model. Measured: `bun build --compile --external @earendil-works/pi-ai/providers` prints `stream ok`.
3. **The rule is about what library modules import statically, not about dynamic imports.** Replaces 0.4.5's requirement, which pointed the wrong way. No file under `src/` outside `src/bin/` and `src/cli/` statically imports a pi-ai `api/*.lazy` or `providers/*` subpath. The bins are entry points, so `agentscript-pi.ts` and `bin/models.ts` keep their static `providers/all`.
4. **`pnpm test:bun` is opt-in,** like `test:ollama`: vitest with `vitest.live.config.ts` on `__tests__/live/bun-bundle.live.test.ts`. It uses `BUN` or `bun` on `PATH`, and skips, saying why, when there is none. It bundles the issue's repro from a temp directory inside `packages/agent`, so `@specsesh/agent/*` resolves to the build by self-reference.

## Decisions made during the build

5. **`.bun-bundle-*/` is gitignored.** The Bun test bundles in a temp directory inside `packages/agent` and removes it afterwards; the ignore covers an interrupted run.
6. **The test was checked both ways.** On Bun 1.4.2 it passes with the fix, fails with the consumer's exact error when `ollama.ts` is reverted, and skips when `BUN` points nowhere.

## Risks / Trade-offs

- `./pi` (and so `./task` and `./durable`) loads pi-ai's OpenAI-compatible client at import time.
- A consumer that bundles `providers/all` still fails; the docs name the external.
