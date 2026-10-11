## Context

Today a change is executed by reading `tasks.md` and ticking boxes. This design names what is executed, the shape of each step, and the three feedback loops, so that an agent or a durable runtime can carry a change from proposal to archive with every hand-off typed and checkable. The type sketches below are TypeScript-flavoured notation for the specs; `packages/agent/src/openspec/` implements them as the `@specsesh/agent/openspec` entry (see Implementation).

## Two halves

- **Taxonomy (`openspec/model`):** what a change *is*. These are nouns, read from files.
- **Ontology (`openspec/process`, `openspec/loops`, `openspec/evidence`):** what *happens* to it. These are steps, loops, verdicts and findings, and how each relates to the nouns.

## Taxonomy

```
Root           { specsDir, changesDir, schema }
Capability     { path: CapabilityPath, purpose, requirements: Requirement[] }
CapabilityPath = string[]                       // ["durable", "run-task"]
Requirement    { name, text, scenarios: Scenario[] }          // text holds SHALL/MUST
Scenario       { name, clauses: Clause[] }
Clause         { keyword: "GIVEN" | "WHEN" | "THEN" | "AND", text }

Change         { id, schema, proposal, deltas: Delta[], design?, tasks?, state: ChangeState }
Proposal       { why, whatChanges: string[], capabilities: { new: CapabilityPath[], modified: CapabilityPath[] },
                 outOfScope: string[], impact: string[] }
Delta          = Added | Modified | Removed | Renamed            // each with capability: CapabilityPath
  Added        { op: "ADDED",    requirement: Requirement }
  Modified     { op: "MODIFIED", requirement: Requirement }      // replaces the whole requirement
  Removed      { op: "REMOVED",  name, reason, migration }
  Renamed      { op: "RENAMED",  from, to }
Design         { sections: { heading, body }[] }                 // free-form; context, decisions, risks
TaskList       { groups: TaskGroup[] }
TaskGroup      { number: int, title, tasks: Task[] }            // "## 2. Durable: …"
Task           { id: TaskId, text, done: boolean, files: string[], links: TaskLink[] }
TaskId         = `${group}.${n}`                                  // "2.4"
TaskLink       { target: RequirementRef | ScenarioRef, basis: LinkBasis, confidence: 0..1 }
RequirementRef { capability: CapabilityPath, requirement: string }
ScenarioRef    { capability: CapabilityPath, requirement: string, scenario: string }
LinkBasis      = "scenario-named" | "requirement-named" | "capability-named" | "file-overlap" | "inferred"
```

**Links are inferred from prose.** `tasks.md` stays as people write it. A link records *how* it was found, from strongest to weakest, so a consumer can decide what to trust:
- `scenario-named`: the task text contains a scenario's exact name.
- `requirement-named`: the task text contains a requirement's exact name.
- `capability-named`: the task text contains a capability path.
- `file-overlap`: the task names a file another source links to the target.
- `inferred`: anything weaker.

`confidence` is 1 for an exact name and lower otherwise. A scenario that no task links to at `scenario-named` or `requirement-named` strength is an **unclaimed scenario**, a coverage gap the change loop must close.

## Process

The lifecycle is a sequence of steps. Every step is `Step<In, Out>` with a named input and output type and a failure type:

| Step | Input | Output | Actor (`principal` · `agent` · `tool` · `loop`) |
|---|---|---|---|
| propose | `Intent { words, existing: CapabilityIndex }` | `Proposal` | principal intent, agent drafts |
| specify | `{ proposal, base: Capability[] }` | `Delta[]` | agent |
| design | `{ proposal, deltas }` | `Design` | agent |
| plan | `{ proposal, deltas, design }` | `TaskList` | agent |
| validate | `Change` | `ValidationReport` | tool |
| approve | `Change + ValidationReport` | `Approval { approved, by: "principal", principal, notes }` | principal (gate) |
| execute | `Change (approved)` | `LoopOutcome<ChangeOutcome>` | the change loop |
| archive | `Change + LoopOutcome<ChangeOutcome> (converged)` | `ArchiveResult` | tool, guarded |

```
StepResult<Out> = { ok: true, value: Out } | { ok: false, failure: StepFailure }
StepFailure     { step, kind: "invalid-input" | "refused" | "blocked" | "error", message, findings: Finding[] }
ValidationReport{ valid: boolean, issues: { level: "ERROR" | "WARNING" | "INFO", path, message }[] }
ArchiveResult   { archivedAs, totals: { added, modified, removed, renamed }, specsUpdated: CapabilityPath[] }
```

**Change state machine.**

```
drafting → specified → designed → planned → validated → approved → executing → converged → archived
                                               ↑                        │
                                               └──── amended ◄──────────┘   (a spec-defect finding)
```

`drafting` is the initial state: `propose`'s first Proposal creates the change in it. Any state except `archived` may go to `abandoned`; `archived` and `abandoned` are terminal. `approved → executing` needs an `Approval` with `approved: true`. `converged → archived` needs a fresh `ValidationReport` with `valid: true`; this is the guard `pnpm spec:archive` already enforces. `executing → amended` happens when execution finds the spec is wrong. The change returns to `validated` only after the amended deltas validate and are re-approved.

## Loops

**One loop shape**, used at three levels:

```
Loop<Goal, Out> {
  input:   LoopInput<Goal>   { goal: Goal, context: ContextRef[], budget: Budget, carried: Feedback[] }
  each:    Iteration         { n, plan: string, actions: Action[], evidence: Evidence[], verdict: Verdict, feedback: Feedback[] }
  output:  LoopOutcome<Out>  { status: "converged" | "blocked" | "exhausted" | "failed",
                               iterations: Iteration[], result?: Out, escalation?: Escalation }
}
Budget     { maxIterations: int, maxWallMs?: int }
Verdict    { met: boolean, satisfied: Target[], unmet: { target: Target, reason }[] }
Feedback   { from: Finding, action: "retry" | "rework-task" | "add-task" | "amend-spec" | "ask" }
Escalation { level: "task" | "group" | "change", to: "principal" | "agent", reason, question }
EscalationAnswer { escalation, by: "principal" | "agent", decision, feedback: Feedback[] }   // by == escalation.to
Target     = RequirementRef | ScenarioRef | { check: string }      // a named check, e.g. "strict validation"
Action     { kind: "edit" | "command" | "delegate", summary, refs: string[] }   // files edited | command line | agent delegated to
ContextRef { kind: "file" | "capability" | "requirement" | "scenario" | "change" | "doc", ref: string }
             // spec refs serialised: "durable/run-task", "durable/run-task › <requirement> › <scenario>"
```

An iteration plans, acts, gathers evidence, and judges the evidence against the goal's targets. Its verdict's unmet targets become feedback for the next iteration. A loop ends:
- `converged`: the verdict is met;
- `blocked`: a finding needs a decision the loop can't make itself, escalated to a human principal or an AI agent (`escalation.to`);
- `exhausted`: the budget ran out with targets still unmet;
- `failed`: an error the loop can't act on.

**The three levels.**

| Level | Goal | Targets | Iterates over | Outcome adds |
|---|---|---|---|---|
| **task loop** | one `Task` + its `TaskLink`s | the linked scenarios and requirements | attempts at that task | `TaskOutcome { task, ticked: boolean }` |
| **group loop** | one `TaskGroup` | every target any of its tasks links to, plus "no regression in what earlier groups converged" | its task loops, in order, then a group check | `GroupOutcome { group, tasks: { task, outcome: LoopOutcome<TaskOutcome>, runs }[] }` |
| **change loop** | the whole `TaskList` | every scenario in every delta (unclaimed ones too), `ValidationReport.valid`, the full suite green | its group loops, in order, then a change check | `ChangeOutcome { groups: { group, outcome: LoopOutcome<GroupOutcome>, runs }[], unclaimed: ScenarioRef[] }` |

**Feedback flows.**
- **Inside a loop:** an unmet target becomes `retry` for the next iteration of the same loop.
- **Up a level:**
  - A task loop that ends `exhausted` or `blocked` hands its outcome to the group loop.
  - The group check can answer with `rework-task` (reopen a converged task whose evidence regressed) or `add-task` (a target no task covered).
  - The change check can do the same with groups, and closes unclaimed scenarios by adding tasks.
- **Out of the loops:** a finding of kind `spec-defect` becomes `amend-spec`. The change loop ends `blocked`, with an escalation naming the defect, and the change moves to `amended`.

  This happened for real on 2026-10-11. Tests written for `baseline-agentscript-durable` showed that two requirements described the code wrongly (undeclared names and nested `if`s are refused by the dialect's lint first). The fix was a spec amendment, not a code change.
- **To a principal or an agent:** `ask` sets `escalation` and ends the loop `blocked`. The answer, an `EscalationAnswer` from the named recipient, resumes the loop as a new run carrying its feedback. Approval is the exception: an agent can answer an escalation and draft an amendment, but only the principal approves a change.

A task is **ticked** in `tasks.md` only when its loop converges. A ticked task whose evidence later regresses is unticked by `rework-task`. A box is never ticked from a summary line; only evidence ticks a box.

## Evidence

```
Evidence = TestEvidence | ValidationEvidence | CheckEvidence | DiffEvidence | ReviewEvidence
TestEvidence       { kind: "test", file, name, scenario?: ScenarioRef, status: "pass" | "fail" | "skip", message? }
ValidationEvidence { kind: "validation", report: ValidationReport }
CheckEvidence      { kind: "check", command, exitCode, output }          // tsc, a pack check, a shell script
DiffEvidence       { kind: "diff", files: { path: string, change: "added" | "modified" | "deleted" }[] }
ReviewEvidence     { kind: "review", reviewer: "agent" | "principal", verdict: "approve" | "changes", notes: string }
Finding  { kind: "code-defect" | "spec-defect" | "test-defect" | "environment" | "needs-decision",
           target?: Target, evidence: Evidence[], message }
```

**What counts as evidence.**
- **Satisfying a scenario target** needs a `TestEvidence` with `status: "pass"` whose `scenario` is that target. A test claims a scenario by being named `Scenario: <exact name>`, the convention this repo already uses.
- **Satisfying a requirement target** needs every one of its scenarios satisfied.
- **Not evidence of a scenario:** a `CheckEvidence` with exit code 0 is evidence for that command only, and a `skip` satisfies nothing.

## Decisions

- **Every type has a JSON Schema as well as a static type.** Step inputs and outputs cross boundaries where TypeScript is absent: a model's tool call, a durable checkpoint, another process. One declaration produces both: see the schema library under Implementation.
- **No parser, so links are typed, not computed.** `LinkBasis` and `confidence` exist so that the later parser's guesses are visible and rankable instead of silent.
- **The loop shape is shared, not three bespoke shapes.** A runner then needs one loop implementation parameterised by level, and the levels differ only in goal, targets and outcome.
- **Steps return `StepResult`; they don't throw.** This matches the step machine's discipline that a failure is a value a caller branches on, never prose.

## Risks and gaps

- **The Agent Script structured-output subset can't carry these types.** A step returns flat string, number and boolean fields only. Running a loop step as an Agent Script subagent will need either nested outputs in the subset or a side channel such as the step doc in the durable runtime. That's a later change.
- **Prose inference will mislink.** The confidence and basis fields make that visible but don't prevent it. A declared link convention remains an option if inference proves too weak.
- **The model assumes the `spec-driven` schema.** Custom OpenSpec schemas with other artifacts would need `Step` entries generated from the schema's artifact graph.

## Implementation

**Schema library: TypeBox, the npm package `typebox`, exact-pinned at `1.3.27`.**
- It is already in the tree at that exact version, pinned by `@earendil-works/pi-ai`, so a pi consumer installs nothing new and the copies dedupe.
- One declaration gives both forms: the schema is JSON Schema, and `Static<typeof X>` derives the type, so the two cannot drift.
- `Value.Check` runs JSON Schema and TypeBox refinements together, and the library has no dependencies of its own.
- Rejected: zod (a new dependency, and JSON Schema only through a converter), and hand-written JSON Schema plus Ajv (two declarations per type).
- It is a required dependency, not an optional peer: `./openspec` cannot load without it, and it is small. `package/distribution` is modified to allow it.

**Where JSON Schema stops.** Every structural rule is plain JSON Schema: patterns, ranges, enums, non-empty arrays, closed objects, "at least one WHEN and one THEN" (`contains`), "confidence 1 exactly for exact-name bases", "`met` exactly when `unmet` is empty", and "`result` when converged, `escalation` exactly when blocked" (unions).

A few rules compare two parts of one value, and JSON Schema cannot say them. These are TypeBox refinements: `check` enforces them, but a consumer holding only the serialised schema does not. They are:
- a task id inside its group;
- group numbers unique and ascending;
- a path both new and modified;
- a rename's `from` equal to its `to`;
- iterations numbered 1, 2, 3, …;
- an unmet target with no feedback;
- one entry per task in a group outcome;
- an escalation answered by someone other than its recipient;
- a test naming a scenario it does not claim;
- a context reference that is not the serialised form its kind requires.

The static types are wider than the schemas wherever TypeScript cannot express a rule (string patterns, ranges, non-empty arrays). The schema is the authority at a boundary.

**Decisions the specs leave open:**
- **File placement.** `ChangeState` is declared in `model.ts`, and `ValidationReport` and `Target` in `evidence.ts`, because `Change`, `ValidationEvidence` and `Finding` carry them. This keeps the import graph acyclic (model → evidence → loops → process). The index exports each once.
- **Named step inputs.** The anonymous inputs become `SpecifyInput`, `DesignInput`, `PlanInput`, `ApproveInput` and `ArchiveInput`. `STEPS` names each step's types as strings (`Delta[]`, `LoopOutcome<ChangeOutcome>`), and `STEP_SCHEMAS` holds the schemas.
- **`Step<In, Out>`** is the serialisable declaration `{ name, actor, input, output }`, with `input` and `output` as type names. `In` and `Out` are type-level only.
- **`Loop<Goal, Out>`** is one run, `{ input: LoopInput<Goal>, output: LoopOutcome<Out> }`. Its iterations are the outcome's.
- **Absent, not empty.** `Design.sections` and `TaskList.groups` are non-empty, so a change with no design or tasks yet can only say so by leaving the field out.
- **Claiming by name.** A test claims a scenario when its name, or the last ` > ` segment of the runner's full name, is `Scenario: <exact name>`.
- **Archive's fresh report.** `archive`'s input is `{ change, outcome }`, so the guard (`archiveGuard(input, report)`) takes the report from the step's own strict validation, run as it begins. This matches `pnpm spec:archive`.
- **Transitions.** `transition(state, event)` takes events that carry each step's result: deltas, design, tasks, a report, an approval, an outcome or a finding. Freshness is judged by the archive event's `reportedAt` being later than its `convergedAt` (ISO 8601 times).
- **Loop status.** `outcomeStatus(iterations, budget, error?)` takes the error that makes a loop `failed`. It returns `undefined` while the loop should go on. Precedence: failed, converged, blocked, exhausted.
- **Escalation recipient.** Feedback names no recipient, so `concludeLoop` takes one (`to`, the principal by default).
- **Check feedback.** A group or change check's feedback rests on a `code-defect` finding: `rework-task` when a task links to the unmet target, `add-task` when none does.
- **Named checks.** A `{ check }` target is satisfied only by a `CheckEvidence` whose `command` equals the check, with exit code 0. `ValidationEvidence` satisfies no target by itself; the change loop's `strict validation` and `full suite` targets need a check recorded under those names.
- **Pure rules beyond the tasks.** Some loop scenarios describe what a runner does. Their tests pin the pure rule a runner would apply, because there is no runner: `applyDelta`, `deltaScenarios`, `feedbackFor`, `concludeLoop`, `carriedInto`, `handedUp`, `resume`, `taskTargets` / `groupTargets` / `changeTargets`, `judge`, `checkFeedback`, `recordTaskRun`, `startChangeOutcome`, `tick` / `untick`, `resolves`, `proposalIssues`, `specifyIssues`, `strictlyValid` and `coversEveryGroup`.
