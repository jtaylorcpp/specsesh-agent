## Why

Since 0.3.0, a Bun bundle that imports `@specsesh/agent/task` and runs a step through `claudeCodeProvider` fails on its first step: `undefined is not a constructor (evaluating 'new AssistantMessageEventStream')`. This blocks any consumer that ships a task loop as a `bun build --compile` binary. The consumer's repro fails here too on Bun 1.4.2, with 5 `__esm` wrappers in the bundle. Their cause chain: `./task` re-exports `pickTests`, which imports `src/pi/index.js`, which re-exports `ollama.js`, which statically imports pi-ai's `api/openai-completions.lazy`, and that module does `import("./openai-completions.js")`. Bun then puts pi-ai's shared modules behind lazy initialisers, drops the only `init_models()` call with the unused Ollama path, and `event-stream.js` is never initialised.

0.4.5's `import-pi-providers-statically` made it worse: `pickTests` imported `providers/all` statically, which reaches every pi-ai `*.lazy` module and can't be marked external in a compiled binary. Its release was cancelled before publishing.

## What Changes

- `ollamaProvider` uses pi-ai's eager `api/openai-completions` (`stream`, `streamSimple`) instead of the lazy wrapper, so `./pi` and `./task` statically reach no pi-ai module that imports dynamically.
- `pickTests` loads `providers/all` with a dynamic `import()` again, only when it builds a pi model itself, so a bundler can mark `@earendil-works/pi-ai/providers` external.
- 0.4.5's requirement "pi-ai is imported statically" is replaced: library modules SHALL NOT statically import a pi-ai `*.lazy` or `providers/*` subpath.
- An opt-in `pnpm test:bun` bundles the consumer's repro with `bun build --target=bun --external @earendil-works/pi-ai/providers` and expects `stream ok`.
- Docs: bundling with Bun needs `--external @earendil-works/pi-ai/providers`.
- Release 0.4.6.

## Out of scope

- A Bun bundle that includes `providers/all` itself (no external). Every pi-ai `*.lazy` module comes with it, and the wrapping is Bun's.
- Bun in `pnpm test` or CI.

## Capabilities

- **Modified:** `package/distribution`.

## Impact

- `packages/agent/src/pi/ollama.ts`, `src/task/test-pick.ts`, `__tests__/package/layers.test.ts`, a new `__tests__/live/bun-bundle.live.test.ts`, a `test:bun` script in both manifests.
- `./pi` now loads pi-ai's OpenAI-compatible client up front.
- Docs: `packages/agent/README.md`, `docs/providers/ollama.md`, `CLAUDE.md`.
