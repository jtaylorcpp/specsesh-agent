## Context

A change folder holding only a proposal fails `openspec validate --strict` ("Change must have at least one delta"), so the later slices can't be stub changes in `openspec/changes/`. They live as lines in the first slice's `slices.md` until the principal starts them, and each then becomes a real change through its own proposal stage.

## slices.md

```markdown
1. `add-plan-export`: Export a plan as JSON with `specplan export --json`.
2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.
3. `add-plan-export-ci`: A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.
```

`readSlices(markdown)` reads lines matching `` ^(\d+)\. `([a-z0-9-]+)`: (.+)$ ``. Numbering must run 1, 2, 3…; a line that doesn't match is an `ERROR` naming its line number.

## The gate, after this change

```ts
gate: async ({ workspace, changeId, files }) => {
	const proposal = files["proposal.md"] ?? "";
	const size = proposalSizeIssues(asProposal(proposal));
	const slices = files["slices.md"];
	return [
		...sectionIssues(proposal),
		...capabilityIssues(…),
		...(slices === undefined
			? size.map(withHint("Write slices.md: one line per small change, this one first"))
			: [...sliceIssues(readSlices(slices), changeId, await existingChanges(workspace)), ...size]),
	];
};
```

With `slices.md` present, `size` must be empty: the proposal now covers only the first slice.

## After approval

```console
$ pnpm task answer 13 --by principal --decision approve
# spec loop 14 — converged (approved)
proposal approved by jesse.
Next: pnpm task spec add-plan-export

Sliced into 3 changes. Start the others when you're ready:
  pnpm task spec add-plan-export-schema --intent "Publish the JSON Schema of the export. Follows add-plan-export."
  pnpm task spec add-plan-export-ci --intent "A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema."
```

The intent is shell-quoted as printed. A `"` inside it is escaped.

## Decisions

- **The first slice is this change.** The user named the change, so the name keeps its meaning: it's the first thing delivered.
- **Slice by capability, then by visible value.** The budget's capability limit is the hard rule. Within it, the script is told each slice should leave something a user can try.
- **Hand-starting the rest.** The principal may reorder, drop or merge slices after seeing the first one land. That's the point of small batches.

## Risks

- An id in `slices.md` may be taken by the time its slice starts. `spec` refuses an existing change unless it is given no `--intent`, so a clash shows up when the command is pasted.
