## 1. Before starting

- [x] 1.1 Merge `main` after `add-task-agent` has archived. If that change modified "Each layer imports only its own peers and the layers beneath it" (e.g. adding `src/task/`), rebase this change's MODIFIED delta onto the archived wording (header exact, full text, all scenarios), keeping only the `zod` → `typebox` edit

## 2. Schemas in TypeBox

- [x] 2.1 `packages/agent/package.json`: replace `zod` with `typebox` `1.3.27` (exact); update the lockfile; `pnpm install --frozen-lockfile` passes
- [x] 2.2 `packages/agent/src/openspec/{schema,model,evidence,process,loops,index}.ts`: start from `git show 231bd8b:<file>`; port forward the `TaskGroup` message naming the task id, `toJSONSchema`, and the safe-integer bounds on integer fields; cross-field rules as refinements `Value.Check` enforces; same exports, `check`, `explain`, `toJSONSchema`; imports only `typebox` and own files

## 3. Tests

- [x] 3.1 Every ontology test passes; rewrite only zod-specific assertions (`schema-agreement.test.ts`, `loops.test.ts`, `import-boundary.test.ts`)
- [x] 3.2 `Scenario: Every type has a schema` and `Scenario: The schema's own check enforces a cross-field rule`
- [x] 3.3 `packages/agent/__tests__/package/manifest.test.ts`: `Scenario: The language packages are pinned exactly`, `Scenario: The schema library is the only other dependency`
- [x] 3.4 `packages/agent/__tests__/package/layers.test.ts`: the layer scenarios with `typebox` in place of `zod`
- [x] 3.5 `packages/agent/__tests__/package/pack.test.ts`: `Scenario: The ontology loads with no peers installed`, `Scenario: One schema library beside pi`
- [x] 3.6 A differential check of the zod `check` (from git) against the TypeBox `check` on the fixtures plus mutations; report every disagreement

## 4. Docs

- [x] 4.1 `CLAUDE.md`, `docs/README.md`, `packages/agent/README.md`: TypeBox where they say zod

## 5. Close

- [x] 5.1 `pnpm -r check`, `pnpm -r test`, `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass
- [x] 5.2 `pnpm spec:archive switch-ontology-to-typebox` (its trial fold must validate)
