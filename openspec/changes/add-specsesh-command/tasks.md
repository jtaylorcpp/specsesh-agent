## 1. The command

- [ ] 1.1 `packages/agent/src/bin/agentscript-pi.ts`: export `main`, leaving its entry guard and output unchanged
- [ ] 1.2 `packages/agent/src/cli/index.ts` (new): export `USAGE` and `main(argv, deps)` routing agent/durable/task/change to the four bins' `main`, implying `task run`, with --help/-h/help and --version/-v as design.md says
- [ ] 1.3 `packages/agent/package.json`: add the `./cli` export after `./task`, mapped to `dist/cli/index` types and import like the other entries

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/cli/specsesh.test.ts` (new): "change routes to the change CLI", "durable routes to the durable CLI", "agent routes to the pi CLI" and "Importing the cli entry runs nothing", via `main` from 1.2 (4)
- [ ] 2.2 `packages/agent/__tests__/cli/specsesh-usage.test.ts` (new): "No command prints usage", "--help prints usage to stdout", "An unknown command prints usage" and "--version prints the manifest's version" (4)
- [ ] 2.3 `packages/agent/__tests__/cli/specsesh-task.test.ts` (new): "A change and a task id imply run" and "A task command passes through", comparing with `agentscript-task`'s `main` (2)
- [ ] 2.4 `packages/agent/__tests__/package/manifest.test.ts`: rename the describe to "The package exports one entry per layer and the command" and test "The exports map is exact" with `cli` last in `ENTRIES` (1)
- [ ] 2.5 `packages/agent/__tests__/package/pack.test.ts`: rename the describe to "The package exports one entry per layer and the command", keeping "A deep import is refused" and "The bare package name is not importable" (2)

## 3. Docs and verify

- [ ] 3.1 `CLAUDE.md`: ten exports in the Layout section, with a `src/cli` → `./cli` row for the `specsesh` command
- [ ] 3.2 `pnpm check`, `pnpm test` and `pnpm spec:check` pass
