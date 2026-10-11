## Why

The ontology's schemas (`@specsesh/agent/openspec`) are written in TypeBox. The principal wants them in **zod**:
- zod is the schema library the wider TypeScript ecosystem uses;
- zod 4 exports JSON Schema natively (`z.toJSONSchema`);
- its refinements live inside the schema, so the cross-field rules travel with the type instead of beside it.

`@earendil-works/pi-ai` already declares `zod` `4.6.5` as a peer, so pinning that version keeps a single zod in any install that also uses pi. The switch should also prove that imports work: the `./openspec` entry, and every layer that imports it, must load from the packed tarball under plain Node.

## What Changes

- **Every type in `src/openspec` is declared once as a zod schema.** Its static type is `z.infer`. Its cross-field rules are `.superRefine` checks on the schema itself, and its JSON Schema comes from `z.toJSONSchema`. The public API stays the same: the same export names, and `check` and `explain` with the same signatures and results, so callers (the actions change) are unaffected.
- **Dependencies:** `typebox` is replaced by `zod` `4.6.5`, exact-pinned, the version pi-ai declares as its peer. TypeBox leaves the manifest.
- **Imports are proven.** The pack check imports `./openspec` from a project with no peers installed, and imports it alongside `./pi` in a project with the peers. It also confirms that exactly one copy of zod is installed there.
- **The docs and CLAUDE.md** say zod where they said TypeBox.

## Out of scope

- Any change to the model itself: the types, fields and rules stay exactly as specified.
- The actions change's own layer delta (durable may import `src/openspec`). It lands with that change.

## Capabilities

- **Modified:** `openspec/model` (the schema requirement names zod and `z.toJSONSchema`), `package/distribution` (zod replaces TypeBox as the required dependency, and the pack check proves the imports).

## Impact

- `packages/agent/src/openspec/*.ts` rewritten, with every existing test passing unchanged except where a test names TypeBox.
- `package.json` and the lockfile: `typebox` out, `zod` in.
