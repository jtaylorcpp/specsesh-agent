## Context

`src/openspec` was TypeBox at `231bd8b` and zod since `switch-ontology-to-zod`. The zod change added three things worth keeping:
- cross-field rules inside the schema;
- a `toJSONSchema` export;
- pack-check proof that imports work.

pi-ai pins `typebox` `1.3.27` exactly and uses it for tool parameters.

## Decisions

- **Start from `231bd8b`'s TypeBox files** (`git show 231bd8b:packages/agent/src/openspec/<file>`), then port forward what changed since: the new `TaskGroup` message naming the task id, the `toJSONSchema` export, and the safe-integer bounds on integer fields, so behaviour doesn't regress from the zod version.
- **Cross-field rules are TypeBox refinements on the schema,** so `Value.Check(schema, value)` alone enforces them, and `check` reports them as issues like any other.
- **`toJSONSchema(schema)`** returns the schema as plain JSON Schema with refinements stripped, so it serialises and can be handed to a model or stored.
- **`typebox` `1.3.27`, exact,** the version pi-ai pins, so a consumer with both installs one copy. A different version would install two.
- **The same public surface:** export names, `check(schema, value)` and `explain(schema, value)` keep their signatures and results; static types are `Static<typeof X>` under the same names.

## Verification

- **Tests:** every ontology test passes, with only the zod-specific assertions rewritten. The zod change's differential check is rerun the other way: the zod `check` (from git) against the new TypeBox `check`, on the fixtures plus mutations, and any disagreement is reported.
- **The pack check:**
  - imports `./openspec` with no peers;
  - imports `./openspec` and `./pi` together with the peers;
  - `npm ls typebox` lists exactly one version.
