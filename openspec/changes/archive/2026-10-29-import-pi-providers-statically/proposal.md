## Why

A consumer reports that Bun 1.3.6 and 1.4.2 bundles of the task loop drop pi-ai's only `init_models()` call. pi-ai's `providers/all` is imported statically in `src/bin/agentscript-pi.ts` but dynamically in `src/bin/models.ts` and `src/task/test-pick.ts`. 0.4.4 removed the same mix for the MCP SDK; this removes it for pi-ai's provider catalogue. Not reproduced here, so it removes a likely trigger rather than a confirmed cause.

## What Changes

- `src/bin/models.ts` and `src/task/test-pick.ts` import `builtinModels` from `@earendil-works/pi-ai/providers/all` statically.
- A test pins it: no source under `src/` imports a pi-ai subpath with a dynamic `import()`.
- Release 0.4.5.

## Out of scope

- `src/pi/ollama.ts`'s static import of `api/openai-completions.lazy`: pi-ai's own providers import it the same way, so changing it waits for a reproduction.
- Other dynamic imports of our own modules in the bins.

## Capabilities

- **Modified:** `package/distribution`.

## Impact

- `packages/agent/src/bin/models.ts`, `packages/agent/src/task/test-pick.ts`, `__tests__/package/layers.test.ts`. Loading `./task` and the bins now loads pi-ai's provider catalogue up front.
