## 1. Schemas in zod

- [ ] 1.1 `packages/agent/package.json`: replace `typebox` with `zod` `4.6.5` (exact) in `dependencies`; update the lockfile; `pnpm install --frozen-lockfile` passes
- [ ] 1.2 `packages/agent/src/openspec/schema.ts`: `check` and `explain` over `safeParse`, with the same signatures and result shapes; `toJSONSchema` wrapping `z.toJSONSchema` (`io: "input"`, `unrepresentable: "any"`)
- [ ] 1.3 `packages/agent/src/openspec/{model,evidence,process,loops}.ts`: every schema in zod under the same export name, its static type as `z.infer`, cross-field rules as `.superRefine`; generic shapes as schema → schema functions
- [ ] 1.4 `packages/agent/src/openspec/index.ts`: same exports, plus `toJSONSchema`; imports only `zod` and its own files

## 2. Tests

- [ ] 2.1 The existing 157 ontology tests pass; rewrite only TypeBox-specific assertions (in `schema-agreement.test.ts`) for zod
- [ ] 2.2 `Scenario: Every type has a schema` (zod schema per type, `toJSONSchema` exports each without throwing) and `Scenario: safeParse enforces a cross-field rule`
- [ ] 2.3 `packages/agent/__tests__/package/manifest.test.ts`: `Scenario: The language packages, all exact`, `Scenario: zod is the only other dependency`
- [ ] 2.4 `packages/agent/__tests__/package/layers.test.ts`: `src/openspec` imports only `zod` and its own files
- [ ] 2.5 `packages/agent/__tests__/package/pack.test.ts`: `Scenario: The ontology loads with no peers`, `Scenario: One zod beside pi`

## 3. Docs

- [ ] 3.1 `CLAUDE.md`, `docs/README.md` and `packages/agent/README.md`: zod where they said TypeBox

## 4. Close

- [ ] 4.1 `pnpm -r check`, `pnpm -r test`, `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive switch-ontology-to-zod`
