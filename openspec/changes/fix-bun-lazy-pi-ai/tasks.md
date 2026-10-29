## 1. No static path to pi-ai's lazy modules

- [x] 1.1 `packages/agent/src/pi/ollama.ts`: `api: { stream, streamSimple }` from `@earendil-works/pi-ai/api/openai-completions` (decision 1). `src/task/test-pick.ts`: `providers/all` with a dynamic `import()` again (decision 2). `__tests__/package/layers.test.ts`: replace "Scenario: No source imports pi-ai dynamically" with "Scenario: No library module statically imports a pi-ai lazy module" (decision 3). Run `pnpm check`, `pnpm test`
- [x] 1.2 `__tests__/live/bun-bundle.live.test.ts`: "Scenario: A Bun bundle of ./task streams"; `test:bun` scripts in `packages/agent/package.json` and the root (decision 4). Docs: `packages/agent/README.md` (bundling with Bun), `docs/providers/ollama.md`, `CLAUDE.md` (`pnpm test:bun`). Run `pnpm docs:check`

The change ends with `pnpm change close fix-bun-lazy-pi-ai`.
