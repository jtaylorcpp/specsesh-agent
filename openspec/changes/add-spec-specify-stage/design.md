## Context

`openspec` already knows the delta format: `validate --strict --json` reports issues, and `show --json --deltas-only` parses deltas into `{ spec, operation, requirement: { name, text, scenarios } }`. The gate leans on both instead of parsing Markdown again. It runs them through `StageContext.run`, which spawns with no shell in the workspace, with `OPENSPEC_TELEMETRY=0` set.

## The gate

```ts
gate: async ({ changeId, run, files }) => {
	const report = await openspecValidate(run, changeId);   // validate <id> --strict --json → issues
	const deltas = await openspecDeltas(run, changeId);     // show <id> --json --deltas-only → Delta[]
	const proposal = readProposalCapabilities(approvedProposal);
	return [
		...report,
		...coverageIssues(proposal, deltas, files),          // a delta per named capability, none other; Purpose on new
		...sizeIssues(asChange(proposal, deltas)).filter(notTasks),
	];
};
```

A command that can't run, or JSON that won't parse, is one `ERROR` naming the command and the first 400 characters of its output. The loop then iterates, and exhausts if it never recovers.

`validate --json` output, read as issues:

```json
{ "items": [{ "id": "add-plan-export", "valid": false,
  "issues": [{ "level": "ERROR", "path": "specs/plan/export/spec.md", "message": "Requirement must have at least one scenario" }] }] }
```

## Seeds

- `approved`: `proposal.md`, `design.md` and every file under `design/`, as `=== ` sections.
- `base`: `=== openspec/specs/<area>/<name>/spec.md` per modified capability, the full text.

## The script

[`design/examples/spec-specify.agent`](design/examples/spec-specify.agent) drafts every delta in one bundle. It writes one `=== specs/<area>/<name>/spec.md` section per capability, and is told the rules:
- copy a MODIFIED requirement whole, with every scenario;
- rename a scenario through REMOVED plus ADDED, never in place;
- put a `## Purpose` on a new capability;
- keep each requirement's text under 500 characters;
- every value in the design either pinned by a requirement or listed out of scope.

## Decisions

- **OpenSpec is the authority on the format.** Duplicating its rules in our gate would drift with its version. The repo pins 1.14.1.
- **Only the change and size limits here.** Task counts belong to the tasks stage, so the tasks and groups issues are filtered out (`notTasks`).

## Risks

- A repo without `openspec` on `PATH` gets one clear `ERROR` per draft, and the loop exhausts. `spec` could check for it up front; that's left to the first user who hits it.
