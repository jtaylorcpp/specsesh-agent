## Context

The task loop (`src/task/loop.ts`) is a durable task whose phases start an `agentscript.run` child, wait for it by id, judge what it read back, and gate on checks. The spec loop keeps that skeleton and swaps two things:
- **the work product:** files in `openspec/changes/<id>/`, written by the loop from the script's `files` variable, not edits made through tools;
- **the gate:** a stage-supplied function returning `ValidationReport` issues, not commands.

The user-visible flow, across all the stage changes, is in [`design/walkthrough.html`](design/walkthrough.html).

## A stage

```ts
export interface SpecStage {
	readonly name: string;                    // "proposal", "design", "specs", "tasks"
	readonly owns: readonly string[];         // ["design.md", "design/"]: a trailing "/" owns a directory
	readonly script: Source;                  // the bundled spec-<name>.agent, or a path
	readonly seed?: (context: StageContext) => { base?: string } | Promise<{ base?: string }>;  // e.g. base specs
	gate(context: StageContext): Promise<StageIssue[]> | StageIssue[];
}

export interface StageContext {
	readonly changeId: string;
	readonly workspace: string;                           // absolute: the repo root, where openspec/ lives
	readonly changeDir: string;                           // absolute: <workspace>/openspec/changes/<id>
	readonly files: Readonly<Record<string, string>>;     // the stage's owned files, as now on disk
	run(argv: readonly string[]): Promise<CheckRun>;      // a command in the workspace, e.g. openspec validate
}

export type StageIssue = ValidationReport["issues"][number];   // { level, path, message }
```

## The bundle

Agent Script variables are strings, numbers and booleans, so a stage returns its files as one string:

```
=== design.md
## Context
…
=== design/walkthrough.html
<!doctype html>
…
```

A line starting with `=== ` opens the file named on it, and the file runs to the next such line. Text before the first header is ignored. A path that's absolute, contains `..`, or isn't owned by the stage is never written. Each one becomes an `ERROR` issue for the gate round, so the next iteration hears about it.

## Phases

```
iterate  seed the contract (current = owned files read now), start the child with
         choices { next_action: ["review", "ask"] }, store its id      (one commit)
await    wait for the child by id
write    parse the bundle, write owned files (idempotent: same text, same files);
         next_action "ask" → blocked with the question
gate     issues = write issues + await stage.gate(context)
         none at ERROR or WARNING → blocked for review
         else → record the iteration unmet, carry the issues, iterate or exhaust
```

Each round is recorded as an ontology `Iteration`:
- target `{ check: "<stage> gate" }`;
- evidence: one `ValidationEvidence` carrying the round's report;
- for an unmet round, one `spec-defect` feedback per issue, with action `retry`.

The outcome is `LoopOutcome<StageOutcome>`, where `StageOutcome = { change, stage, files, approved }`. A review ends `blocked` with `approved: false`; `add-spec-review` turns an approval into `converged`.

The escalation's `level` is `"change"`. The ontology has no stage level, and a stage loop works on the change as a whole.

## Library use

```ts
import { startSpecLoop, waitForSpecLoop, specLoopExtensions } from "@specsesh/agent/task";

harness.install(...specLoopExtensions({ workspace: repoRoot }));
const id = await startSpecLoop(harness, {
	change: "add-plan-export",
	stage: proposalStage,                // from add-spec-proposal-stage
	intent: "Export a plan as JSON so CI can read it",
	workspace: repoRoot,
}, context);
const outcome = await waitForSpecLoop(harness, id, context);
// { status: "blocked", escalation: { level: "change", to: "principal", reason: "review",
//   question: "Review proposal.md for the proposal stage of add-plan-export. Answer approve, or say what to change." },
//   result: { change: "add-plan-export", stage: "proposal", files: ["proposal.md"], approved: false } }
```

## Decisions

- **Text out, the loop writes.** Tools would tie stages to providers that serve many tools per request (claude-code serves one). The bundle is also deterministic to replay: the `write` phase can run twice and leave the same files.
- **The gate has no model.** "Small" and "valid" are rules (`openspec/size`, `openspec validate`), so the agent can't talk its way past them.
- **`current` is re-read every iteration.** The principal may hand-edit a draft between runs, and the next iteration starts from those edits.
- **No clean-tree requirement here.** The loop writes only inside the change directory. The CLI change decides what to guard.

## Risks

- **A long artifact inside a JSON string**, through `--json-schema` on claude-code. The live check in `add-spec-cli-events` drafts a real proposal. Designs and specs are bigger; a live run through all four stages is a follow-up change once the plan stage lands, recorded in `openspec/parked.md`.
