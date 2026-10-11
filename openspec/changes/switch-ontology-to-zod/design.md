## Context

`src/openspec` is six files of TypeBox schemas with refinements, plus `check` and `explain`, covered by 157 tests. pi-ai declares `zod` `4.6.5` as a peer.

## Decisions

- **zod `4.6.5`, exact.** Matching pi-ai's peer means a consumer with both installs one zod. A different minor would install two copies and break `instanceof` checks across them.
- **Same public surface.** Each export keeps its name and becomes a zod schema. `check(schema, value)` keeps its result shape, built from `safeParse` issues. `explain` keeps its messages. Static types are `z.infer<typeof X>`, exported under the same names.
- **Cross-field rules move into the schema** as `.superRefine`. Before, they ran beside the schema in `check`; now `schema.safeParse` alone enforces them. `z.toJSONSchema` still cannot express them, so the JSON Schema stays the wider contract. The model's existing requirement already says that.
- **The JSON Schema export:** `toJSONSchema(schema)`, re-exported from `./openspec`, wraps `z.toJSONSchema` with `io: "input"` and `unrepresentable: "any"`, so a refinement never throws during export.
- **Generic shapes** (`Step<In, Out>`, `StepResult<Out>`, `Loop<Goal, Out>`, `LoopOutcome<Out>`) become functions from a schema to a schema, as they were functions in TypeBox.

## Verification

- All 157 ontology tests pass, with only the TypeBox-specific assertions in `schema-agreement.test.ts` rewritten for zod.
- The pack check:
  - imports `./openspec` with no peers;
  - imports `./openspec` and `./pi` together with the peers;
  - checks that `npm ls zod` in that project lists exactly one version.
