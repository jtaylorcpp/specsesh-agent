## Context

`src/openspec/process.ts` holds the order in three places: the step input schemas (`DesignInput`, `SpecifyInput`), `STEPS`, and the `FORWARD` table that `transition` reads. `ChangeState`'s members don't change, only which step leads to which.

## The change, in code

```ts
// before
export const SpecifyInput = closed({ proposal: Proposal, base: Type.Array(Capability) });
export const DesignInput  = closed({ proposal: Proposal, deltas: Type.Array(Delta) });

// after
export const DesignInput  = closed({ proposal: Proposal });
export const SpecifyInput = closed({ proposal: Proposal, design: Design, base: Type.Array(Capability) });
```

```ts
const FORWARD = {
	design:  ["drafting", "designed"],
	specify: ["designed", "specified"],
	plan:    ["specified", "planned"],
	// approve, execute, converge, amend, archive unchanged
};
```

## Decisions

- **Keep the state names.** `designed` and `specified` still mean "the design exists" and "the deltas exist"; only their order moves. Renaming them would touch every consumer for no gain.
- **`specify` must see the design** (not just be allowed to), because the requirements are derived from it: "everything the design shows is either pinned by a requirement or listed out of scope".
- **REMOVED + ADDED for "Design and plan follow the deltas".** Its name is false after the change, and a MODIFIED block can't rename.

## Risks

- `guides/06-openspec.md` and `docs/overview.md` restate the order; a missed copy goes stale silently. Task 2.5 and 2.6 name them.
