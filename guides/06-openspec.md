# The OpenSpec ontology

After this guide you can import `@specsesh/agent/openspec`, validate the values your own tooling passes around (a parsed task id, a loop's outcome, an iteration record), and hand any of its schemas to a model as a JSON Schema. You will also have the model of how a change is executed in your head, which is what the [task loop guide](07-task-loop.md) builds on.

[OpenSpec](https://github.com/Fission-AI/OpenSpec) is a spec-driven workflow: a repository keeps its behaviour as capability specs (requirements with scenarios), and a *change* edits them through deltas (ADDED, MODIFIED, REMOVED, RENAMED) next to a proposal, an optional design and a `tasks.md`. What OpenSpec does not say is how a change gets *executed*. This package adds that: a change is carried out as three nested feedback loops (a task loop inside a group loop inside a change loop), every step of its lifecycle has a typed input and output, and every claim that a target is met rests on evidence.

## Prerequisites

- Node 22.19 or newer and `npm install @specsesh/agent`. The `openspec` entry has no peer dependencies; it depends only on `typebox` and reads no files, runs no loop and calls no model. It runs on Node and on Workers.
- A change to think about. You do not need the OpenSpec CLI to use the types.
- For definitions, the concept pages in [`docs/`](../docs/README.md) (one concept per file) and the one-page [overview](../docs/overview.md). The contract is the four specs under [`openspec/specs/openspec/`](../openspec/specs/openspec) (`model`, `process`, `loops`, `evidence`).

## The model on one page

A change is made of typed artifacts, and executing it is nested loops:

```text
change loop ── for each TaskGroup ──► group loop ── for each Task ──► task loop
```

Every loop has the same shape: a `LoopInput` (goal, context, budget, carried feedback) goes in, iterations run, and a `LoopOutcome` comes out that is `converged`, `blocked`, `exhausted` or `failed`. Each iteration records its plan, its actions, the evidence it gathered, a verdict and the feedback the verdict produced. Feedback flows four ways: `retry` stays inside the loop, `rework-task` and `add-task` go up a level, `amend-spec` leaves the loops because the spec is wrong, and `ask` ends the loop `blocked` with an escalation to a principal or an agent. The concept pages define each of these: [Loop](../docs/ontology/loops/loop.md), [Iteration](../docs/ontology/loops/iteration.md), [Verdict](../docs/ontology/loops/verdict.md), [Feedback](../docs/ontology/loops/feedback.md), [Escalation](../docs/ontology/loops/escalation.md).

What ships as a runner today: the **task loop** and the **group loop** (`@specsesh/agent/task`, covered in guide 07). The change loop's types (`ChangeOutcome`, `changeTargets`, `startChangeOutcome`) are in the ontology, but no change-loop runner ships; you drive the groups of a change one `run` at a time.

## What the entry exports

Each type is one TypeBox schema exported under the type's own name, plus the static type `Static` of it. The same identifier is both: `import { Task } from "@specsesh/agent/openspec"` gives you the schema as a value and `Task` as a type. A TypeBox schema is a JSON Schema. The helpers:

| Helper | What it does |
|---|---|
| `check(Schema, value)` | `true` when the value satisfies the schema, refinements included |
| `explain(Schema, value)` | one line per failure, `path: message`; empty when it passes |
| `toJSONSchema(Schema)` | the schema as plain JSON you can serialise or give to a model |

Some rules compare two fields of one value (a task id against its group's number, a rename's `from` against its `to`, an escalation answer's `by` against the escalation's `to`). JSON Schema cannot say those, so they are refinements on the schema itself. `check` and `explain` run them; the plain JSON Schema from `toJSONSchema` does not carry them. If you validate with another JSON Schema library, you get every structural rule and none of the refinements.

All object schemas are closed: a property the type does not name is refused.

### Taxonomy: what a change is made of

`Root`, `Capability`, `CapabilityPath`, `Requirement`, `Scenario`, `Clause`, `Change`, `Proposal`, `Delta` (with `Added`, `Modified`, `Removed`, `Renamed`), `Design`, `TaskList`, `TaskGroup`, `Task`, `TaskId`, `TaskLink`, `LinkBasis`, `RequirementRef`, `ScenarioRef`. Rules over them: `formatRef` / `parseRef` (a reference as `durable/run-task › Requirement › Scenario`), `applyDelta`, `deltaScenarios`, `unclaimedScenarios`.

- A `TaskId` is `<group>.<n>`, both without leading zeros: `2.4` passes, `2`, `0.1` and `2.04` do not.
- A `Task` is `{ id, text, done, files, links }`. A task's links to requirements and scenarios are *inferred* from its prose and record how they were found (`LinkBasis`, strongest first: `scenario-named`, `requirement-named`, `capability-named`, `file-overlap`, `inferred`). The `agentscript-task` runner does not infer links yet; its verdicts judge one named check per task (see guide 07).
- A `Requirement`'s text must contain `SHALL` or `MUST`, and each has at least one scenario; a `Scenario` needs a `WHEN` and a `THEN` clause.
- `applyDelta(capability, delta)` returns the capability with the delta applied, and throws when the delta names another capability or a requirement that is not there.

### Steps: the lifecycle as typed functions

The eight steps are `propose`, `design`, `specify`, `plan`, `validate`, `approve`, `execute` and `archive`, listed in order in `STEPS` with their actor and the names of their input and output types. The design comes first, and the requirements (deltas) are derived from the approved design: everything the design shows is either pinned by a requirement or listed out of scope. `STEP_SCHEMAS` holds each step's input and output schema. A step never throws; it returns a `StepResult`: `{ ok: true, value }` or `{ ok: false, failure }`, where the failure's `kind` is `invalid-input`, `refused`, `blocked` or `error`.

`invokeStep(name, input, body)` is that discipline at the boundary. It checks the input against the step's schema and returns `invalid-input` when it fails, and it turns a throw from your `body` into an `error` result. The package supplies the typing and the guards; the body (asking a model to draft a proposal, running `openspec validate`) is yours.

The change's state machine is `ChangeState` plus `transition(state, event)`. The states, in order, are `drafting`, `designed`, `specified`, `planned`, `validated`, `approved`, `executing`, `converged`, `archived`, with `amended` and `abandoned` off the path. Guards worth knowing: `approved` needs an `Approval` with `approved: true` and `by: "principal"`; `archived` needs a valid `ValidationReport` produced *after* convergence; only a `spec-defect` finding moves `executing` to `amended`. See [ChangeState](../docs/ontology/process/change-state.md). `archiveGuard`, `strictlyValid`, `coversEveryGroup`, `proposalIssues` and `specifyIssues` are the pure rules behind the steps.

### Loops: one shape, three levels

`LoopInput(goal)` and `LoopOutcome(out)` are schema factories, because the goal and the result differ per level:

- `LoopOutcome(TaskOutcome)` for a task loop (`TaskOutcome` is `{ task, ticked }`)
- `LoopOutcome(GroupOutcome)` for a group loop (one row per task: its latest outcome and run count)
- `LoopOutcome(ChangeOutcome)` for a change loop (one row per group, plus the scenarios no task claims)

Beside them: `Budget`, `ContextRef`, `Action`, `Verdict`, `Iteration`, `Feedback`, `FeedbackAction`, `Escalation`, `EscalationAnswer`, `Recipient`, `LoopLevel`, `LoopStatus`. And the rules a runner applies between iterations:

- `feedbackFor(finding)` maps a finding to the feedback it calls for: `spec-defect` gives `amend-spec`, `needs-decision` gives `ask`, anything else gives `retry`.
- `outcomeStatus(iterations, budget, error?)` returns the status the loop ends in, or `undefined` while it should go on: `failed` on an error, `converged` when the last verdict is met, `blocked` when the last feedback asks or amends the spec, `exhausted` when the budget is spent.
- `concludeLoop`, `resume`, `carriedInto`, `handedUp`, `checkFeedback`, `judge`, `tick`, `untick`, `taskTargets`, `groupTargets` and `changeTargets` are the rest.

### Evidence: what a verdict may rest on

`Evidence` is one of five kinds: `TestEvidence`, `ValidationEvidence`, `CheckEvidence`, `DiffEvidence`, `ReviewEvidence`. A failed check produces a `Finding` (`code-defect`, `spec-defect`, `test-defect`, `environment` or `needs-decision`), and a finding always cites evidence: its `evidence` array cannot be empty.

`satisfies(target, evidence, scenariosOf?)` is the rule that keeps claims honest:

- A scenario target needs a *passing test that claims it by exact name* (`Scenario: <exact name>`, alone or as the last ` > ` segment of the full test name).
- A requirement target needs every one of its scenarios satisfied (pass `scenariosOf` so it knows what they are; otherwise it is unsatisfiable).
- A named-check target (`{ check: "pnpm test" }`) needs `CheckEvidence` for that command with exit code 0.
- A skipped test satisfies nothing, and a check never satisfies a scenario or a requirement.

## Example 1: validate a parsed task id

You parsed `tasks.md` yourself and want to be sure an id is one the runner will accept.

```ts
import { TaskId, check, explain } from "@specsesh/agent/openspec";

for (const text of ["2.4", "2", "0.1", "2.04"]) {
	console.log(text, check(TaskId, text) ? "ok" : explain(TaskId, text).join("; "));
}
```

`2.4` is ok; the other three fail the pattern `^[1-9][0-9]*\.[1-9][0-9]*$`, and `explain` says so.

## Example 2: check a loop outcome

`agentscript-task run … --json` prints the loop's id merged with its outcome. Closed schemas refuse the extra `loop` key, so take it off before you check the rest.

```ts
import { LoopOutcome, TaskOutcome, check, explain } from "@specsesh/agent/openspec";

const TaskLoopOutcome = LoopOutcome(TaskOutcome);

export function readOutcome(json: string): LoopOutcome<TaskOutcome> {
	const { loop, ...outcome } = JSON.parse(json) as { loop: number } & Record<string, unknown>;
	if (!check(TaskLoopOutcome, outcome)) {
		throw new Error(`loop ${loop} printed something that is not a task outcome: ${explain(TaskLoopOutcome, outcome).join("; ")}`);
	}
	return outcome as LoopOutcome<TaskOutcome>;
}
```

A `converged` outcome must carry its `result` (`{ task, ticked }`), a `blocked` one must carry its `escalation`, and the iterations must be numbered 1, 2, 3 and so on. All three are checked.

## Example 3: build an iteration record

An iteration whose verdict is unmet must carry feedback that names every unmet target. The schema enforces this as a refinement, so building a record is also how you learn the rule.

```ts
import { Iteration, check, explain, feedbackFor, outcomeStatus, type Finding } from "@specsesh/agent/openspec";

const target = { check: "task 2.1" };
const finding: Finding = {
	kind: "code-defect",
	target,
	evidence: [{ kind: "check", command: "pnpm test", exitCode: 1, output: "1 failed" }],
	message: "pnpm test exited 1",
};

const iteration: Iteration = {
	n: 1,
	plan: "add the schema",
	actions: [{ kind: "edit", summary: "create src/schema.ts", refs: ["src/schema.ts"] }],
	evidence: finding.evidence,
	verdict: { met: false, satisfied: [], unmet: [{ target, reason: finding.message }] },
	feedback: [feedbackFor(finding)], // a code-defect calls for "retry"
};

console.log(check(Iteration, iteration)); // true
console.log(explain(Iteration, { ...iteration, feedback: [] })); // ["/: an unmet target has no feedback"]
console.log(outcomeStatus([iteration], { maxIterations: 8 })); // undefined: go on
console.log(outcomeStatus([iteration], { maxIterations: 1 })); // "exhausted"
```

Change the finding's `kind` to `needs-decision` and `outcomeStatus` returns `"blocked"` instead, because its feedback is `ask`.

## Example 4: a JSON Schema for a model tool

Give a model a tool whose arguments are an ontology type, and check what comes back with the same schema. Here the type is an `Escalation`, the question a blocked loop sends to a person.

```ts
import { Escalation, check, explain, toJSONSchema } from "@specsesh/agent/openspec";

export const escalateTool = {
	name: "escalate",
	description: "Ask the principal or an agent a question you cannot settle from the evidence.",
	parameters: toJSONSchema(Escalation),
};

export function onToolCall(args: unknown): string {
	if (!check(Escalation, args)) return `refused: ${explain(Escalation, args).join("; ")}`;
	const escalation = args as Escalation; // `check` validates; it does not narrow the type
	return `escalated to the ${escalation.to}: ${escalation.question}`;
}
```

`toJSONSchema` returns plain JSON (it round-trips through `JSON.stringify`), so it can go to any provider that takes a JSON Schema for tool parameters. The refinements do not travel with it, which is why `check` on your side of the boundary matters: for `EscalationAnswer`, only `check` knows that `by` must equal the escalation's `to`.

## Example 5: the state machine and `satisfies`

Two pure rules you can use without any loop.

```ts
import { satisfies, transition, type Evidence } from "@specsesh/agent/openspec";

console.log(transition("planned", { on: "validate", report: { valid: true, issues: [] } })); // { ok: true, state: "validated" }
console.log(transition("planned", { on: "execute" })); // { ok: false, reason: "execute does not apply to a change in planned" }

const scenario = { capability: ["task", "agent"], requirement: "The gate converges a met verdict only when every check passes", scenario: "Passing checks converge" };
const evidence: Evidence[] = [
	{ kind: "test", file: "gate.test.ts", name: "task/agent > Scenario: Passing checks converge", scenario, status: "pass" },
	{ kind: "check", command: "pnpm test", exitCode: 0, output: "" },
];
console.log(satisfies(scenario, evidence)); // true
console.log(satisfies(scenario, [evidence[1]!])); // false: a green command is not a claimed scenario
```

A `TestEvidence` whose name does not carry the exact `Scenario: <name>` of the scenario it names fails `check` itself.

## Where this stops

The model assumes OpenSpec's `spec-driven` schema. Agent Script steps return flat scalar fields only, so running ontology steps as subagents that exchange these nested types needs a side channel; the task loop works around that by reading scalar variables (`met`, `unmet`, `next_action`, `question`) back from the script and building the typed `Iteration` itself. The [overview](../docs/overview.md) lists what is not yet modelled.

## Next

- [07 Executing changes with the task loop](07-task-loop.md): the runner that produces these `Iteration`s and `LoopOutcome`s.
- [08 Troubleshooting](08-troubleshooting.md)
- [01 Writing Agent Script](01-agent-script.md) and [02 Running a script](02-running-scripts.md): the language the loops run on.
- [03 Durable agents on Node](03-durable-agents.md), [04 Actions](04-actions.md), [05 Agents on Cloudflare](05-cloudflare.md).
- Concept pages: [`docs/README.md`](../docs/README.md).
