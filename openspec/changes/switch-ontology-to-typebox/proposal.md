## Why

The principal has decided TypeBox fits what the ontology is for better than zod, so the schemas in `@specsesh/agent/openspec` go back to TypeBox:
- **A TypeBox schema is a JSON Schema.** There is no conversion step, which matters when the same schemas are handed to models as tool parameters and stored in durable checkpoints.
- **pi-ai already speaks TypeBox.** Its tool parameters are TypeBox schemas, and it pins `typebox` `1.3.27` exactly, so pinning the same version keeps one copy in any install that also uses pi.

The ontology was TypeBox until `switch-ontology-to-zod`. This change goes back to it, keeping what that change added: the cross-field rules live in the schema, `toJSONSchema` is exported, and the pack check proves the imports.

## What Changes

- **Every type in `src/openspec` is declared once as a TypeBox schema.**
  - **Static type:** `Static<typeof X>`.
  - **Cross-field rules:** refinements on the schema itself, so the schema's own check enforces them.
  - **JSON Schema:** the schema is one. `toJSONSchema(schema)` stays exported, returning it with the refinements, which JSON Schema cannot state, left out.
- **The public API stays the same:** export names, `check`, `explain` and `toJSONSchema`, so the task agent and the actions code are unaffected.
- **Dependencies:** `zod` is replaced by `typebox` `1.3.27`, exact-pinned, the version pi-ai pins.
- **Imports are proven.** The pack check imports `./openspec` with no peers installed, and imports it together with `./pi` with the peers. It confirms exactly one `typebox` is installed there.
- **Requirement names that said zod are replaced with neutral ones,** so a future library change won't need renames.

## Out of scope

- Any change to the model: types, fields and rules stay exactly as specified.

## Capabilities

- **Modified:** `openspec/model` (the schema requirement and cross-field rules name TypeBox), `package/distribution` (TypeBox replaces zod as the required dependency, in the layer rule and in the pack check).

## Impact

- `packages/agent/src/openspec/*.ts` rewritten. The pre-zod TypeBox version is in git history (`231bd8b`) and is the starting point. Every existing test passes, with only zod-specific assertions rewritten.
- `package.json` and the lockfile: `zod` out, `typebox` in.
- Depends on `add-task-agent` merging first, since both touch `package/distribution` and the lockfile.
