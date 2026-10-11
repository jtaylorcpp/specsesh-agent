## Context

Today a change is executed by reading `tasks.md` and ticking boxes. This design names what is executed, the shape of each step, and the three feedback loops, so that an agent or a durable runtime can carry a change from proposal to archive with every hand-off typed and checkable. It is a model: the type sketches below are TypeScript-flavoured notation for the specs, not code that exists.

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
| approve | `Change + ValidationReport` | `Approval { approved, by, notes }` | principal (gate) |
| execute | `Change (approved)` | `ChangeOutcome` | the change loop |
| archive | `Change + ChangeOutcome (converged)` | `ArchiveResult` | tool, guarded |

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

Any state except `archived` may go to `abandoned`; `archived` and `abandoned` are terminal. `approved → executing` needs an `Approval` with `approved: true`. `converged → archived` needs a fresh `ValidationReport` with `valid: true`; this is the guard `pnpm spec:archive` already enforces. `executing → amended` happens when execution finds the spec is wrong. The change returns to `validated` only after the amended deltas validate and are re-approved.

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
Escalation { level: "task" | "group" | "change", reason, question }
Target     = RequirementRef | ScenarioRef | { check: string }      // a named check, e.g. "strict validation"
```

An iteration plans, acts, gathers evidence, and judges the evidence against the goal's targets. Its verdict's unmet targets become feedback for the next iteration. A loop ends:
- `converged`: the verdict is met;
- `blocked`: a finding needs a decision only a person can make, recorded in `escalation`;
- `exhausted`: the budget ran out with targets still unmet;
- `failed`: an error the loop can't act on.

**The three levels.**

| Level | Goal | Targets | Iterates over | Outcome adds |
|---|---|---|---|---|
| **task loop** | one `Task` + its `TaskLink`s | the linked scenarios and requirements | attempts at that task | `TaskOutcome { task, ticked: boolean }` |
| **group loop** | one `TaskGroup` | every target any of its tasks links to, plus "no regression in what earlier groups converged" | its task loops, in order, then a group check | `GroupOutcome { group, tasks: TaskOutcome[] }` |
| **change loop** | the whole `TaskList` | every scenario in every delta (unclaimed ones too), `ValidationReport.valid`, the full suite green | its group loops, in order, then a change check | `ChangeOutcome { groups: GroupOutcome[], unclaimed: ScenarioRef[] }` |

**Feedback flows.**
- **Inside a loop:** an unmet target becomes `retry` for the next iteration of the same loop.
- **Up a level:**
  - A task loop that ends `exhausted` or `blocked` hands its outcome to the group loop.
  - The group check can answer with `rework-task` (reopen a converged task whose evidence regressed) or `add-task` (a target no task covered).
  - The change check can do the same with groups, and closes unclaimed scenarios by adding tasks.
- **Out of the loops:** a finding of kind `spec-defect` becomes `amend-spec`. The change loop ends `blocked`, with an escalation naming the defect, and the change moves to `amended`.

  This happened for real on 2026-10-11. Tests written for `baseline-agentscript-durable` showed that two requirements described the code wrongly (undeclared names and nested `if`s are refused by the dialect's lint first). The fix was a spec amendment, not a code change.
- **To a person:** `ask` sets `escalation` and ends the loop `blocked`.

A task is **ticked** in `tasks.md` only when its loop converges. A ticked task whose evidence later regresses is unticked by `rework-task`. A box is never ticked from a summary line; only evidence ticks a box.

## Evidence

```
Evidence = TestEvidence | ValidationEvidence | CheckEvidence | DiffEvidence | ReviewEvidence
TestEvidence       { kind: "test", file, name, scenario?: ScenarioRef, status: "pass" | "fail" | "skip", message? }
ValidationEvidence { kind: "validation", report: ValidationReport }
CheckEvidence      { kind: "check", command, exitCode, output }          // tsc, a pack check, a shell script
DiffEvidence       { kind: "diff", files: { path, change: "added" | "modified" | "deleted" }[] }
ReviewEvidence     { kind: "review", reviewer: "agent" | "principal", verdict: "approve" | "changes", notes }
Finding  { kind: "code-defect" | "spec-defect" | "test-defect" | "environment" | "needs-decision",
           target?: Target, evidence: Evidence[], message }
```

**What counts as evidence.**
- **Satisfying a scenario target** needs a `TestEvidence` with `status: "pass"` whose `scenario` is that target. A test claims a scenario by being named `Scenario: <exact name>`, the convention this repo already uses.
- **Satisfying a requirement target** needs every one of its scenarios satisfied.
- **Not evidence of a scenario:** a `CheckEvidence` with exit code 0 is evidence for that command only, and a `skip` satisfies nothing.

## Decisions

- **Every type has a JSON Schema as well as a static type.** Step inputs and outputs cross boundaries where TypeScript is absent: a model's tool call, a durable checkpoint, another process. When this becomes code, one declaration produces both. TypeBox is already in the tree, through pi-ai, but the choice belongs to the implementing change.
- **No parser, so links are typed, not computed.** `LinkBasis` and `confidence` exist so that the later parser's guesses are visible and rankable instead of silent.
- **The loop shape is shared, not three bespoke shapes.** A runner then needs one loop implementation parameterised by level, and the levels differ only in goal, targets and outcome.
- **Steps return `StepResult`; they don't throw.** This matches the step machine's discipline that a failure is a value a caller branches on, never prose.

## Risks and gaps

- **The Agent Script structured-output subset can't carry these types.** A step returns flat string, number and boolean fields only. Running a loop step as an Agent Script subagent will need either nested outputs in the subset or a side channel such as the step doc in the durable runtime. That's a later change.
- **Prose inference will mislink.** The confidence and basis fields make that visible but don't prevent it. A declared link convention remains an option if inference proves too weak.
- **The model assumes the `spec-driven` schema.** Custom OpenSpec schemas with other artifacts would need `Step` entries generated from the schema's artifact graph.
