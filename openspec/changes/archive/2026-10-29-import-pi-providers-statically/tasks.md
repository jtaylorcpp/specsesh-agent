## 1. Static pi-ai imports

- [x] 1.1 `packages/agent/src/bin/models.ts` and `src/task/test-pick.ts`: import `builtinModels` from `@earendil-works/pi-ai/providers/all` statically (decision 1). Test in `__tests__/package/layers.test.ts`: "Scenario: No source imports pi-ai dynamically" (decision 2). Run `pnpm check`, `pnpm test`

The change ends with `pnpm change close import-pi-providers-statically`.
