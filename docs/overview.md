# Overview

How an OpenSpec change is modelled, on one page. Each name links to its concept page; [README](README.md) lists them all.

## The idea in three sentences

A change is a set of typed artifacts: a [proposal](taxonomy/proposal.md), [deltas](taxonomy/delta.md) to [capabilities](taxonomy/capability.md), a [design](taxonomy/design.md) and a [task list](taxonomy/task-list.md). Every [step](ontology/process/step.md) of its lifecycle takes a typed input and returns a typed [result](ontology/process/step-result.md). Executing it is three nested feedback [loops](ontology/loops/loop.md):
- a [task](taxonomy/task.md) is a loop;
- a [task group](taxonomy/task-group.md) is a loop of task loops;
- the task list is a loop of group loops that makes the spec real.

## Taxonomy: what a change is made of

```
Root ─┬─ Capability ── Requirement ── Scenario ── Clause (GIVEN | WHEN | THEN | AND)
      │      ▲  path: CapabilityPath
      │      │ edits
      └─ Change ─┬─ Proposal      (why, what, which capabilities: new | modified)
                 ├─ Delta[]       ADDED | MODIFIED | REMOVED | RENAMED, each against one capability
                 ├─ Design        free-form context, decisions, risks
                 ├─ TaskList ── TaskGroup (number) ── Task (TaskId "2.4", text, done, files)
                 │                                     └─ TaskLink → RequirementRef | ScenarioRef
                 └─ ChangeState                               basis: LinkBasis, confidence 0..1
```

[Task links](taxonomy/task-link.md) are **inferred from the task's prose**, never declared, and each one records how it was found ([LinkBasis](taxonomy/link-basis.md)):
- strongest: the task names the scenario exactly;
- then the requirement, then the capability;
- weakest: file overlap or a guess.

A delta scenario with no strong link is an [unclaimed scenario](taxonomy/unclaimed-scenario.md): a coverage gap the change loop must close.

## Process: the lifecycle as typed steps

| Step | Input | Output | Actor |
|---|---|---|---|
| [propose](ontology/process/steps/propose-step.md) | [Intent](ontology/process/intent.md) | Proposal | agent, from the principal's words |
| [specify](ontology/process/steps/specify-step.md) | Proposal + base capabilities | Delta[] | agent |
| [design](ontology/process/steps/design-step.md) | Proposal + deltas | Design | agent |
| [plan](ontology/process/steps/plan-step.md) | Proposal + deltas + design | TaskList | agent |
| [validate](ontology/process/steps/validate-step.md) | Change | [ValidationReport](ontology/process/validation-report.md) | tool |
| [approve](ontology/process/steps/approve-step.md) | Change + report | [Approval](ontology/process/approval.md) | **principal only** |
| [execute](ontology/process/steps/execute-step.md) | approved Change | [ChangeOutcome](ontology/loops/change-outcome.md) | the change loop |
| [archive](ontology/process/steps/archive-step.md) | converged Change | [ArchiveResult](ontology/process/archive-result.md) | tool, guarded |

A step never throws: it returns a value or a [StepFailure](ontology/process/step-failure.md) (`invalid-input`, `refused`, `blocked` or `error`).

The change moves through its [state machine](ontology/process/change-state.md):

```
drafting → specified → designed → planned → validated → approved → executing → converged → archived
                                               ↑                        │
                                               └──── amended ◄──────────┘   a spec-defect finding
(any state except archived → abandoned; archived and abandoned are terminal)
```

Two guards matter most:
- **Execution needs an Approval** with `approved: true`.
- **Archiving needs a fresh ValidationReport** with `valid: true`. This is what `pnpm spec:archive` enforces today.

## Loops: execution as nested feedback

```
change loop ── for each TaskGroup ──► group loop ── for each Task ──► task loop
  targets: every delta scenario,        targets: everything its        targets: the task's
  valid report, full suite green        tasks link to, no regression   linked scenarios/requirements
  then: change check                    then: group check              then: tick the box
```

Every loop has [the same shape](ontology/loops/loop.md):

```
LoopInput { goal, context, budget, carried feedback }
  └─ Iteration n: plan → actions → evidence → Verdict { met, satisfied, unmet } → Feedback[]
LoopOutcome: converged | blocked | exhausted | failed
```

- **[Feedback](ontology/loops/feedback.md) flows in four directions:**
  - **retry**, inside the loop: an unmet target becomes work for the next iteration;
  - **rework-task** or **add-task**, up a level: a group or change check reopens or adds a task;
  - **amend-spec**, out of the loops: the evidence shows the spec is wrong, not the code. The change loop ends `blocked` and the change moves to `amended`. This happened on 2026-10-11, when tests showed two baseline requirements described the code wrongly;
  - **ask**, to someone: the loop ends `blocked` with an [Escalation](ontology/loops/escalation.md) addressed to a **principal or an agent**. The recipient's [answer](ontology/loops/escalation-answer.md) resumes the loop as a new run carrying its feedback.
- **Only a converged task loop ticks a box**, and rework unticks it. A box is never ticked from a summary line.

## Evidence: what a verdict may rest on

[Evidence](ontology/evidence/evidence.md) comes in five kinds: [test](ontology/evidence/test-evidence.md), [validation](ontology/evidence/validation-evidence.md), [check](ontology/evidence/check-evidence.md), [diff](ontology/evidence/diff-evidence.md) and [review](ontology/evidence/review-evidence.md).

- **A scenario is satisfied only by a passing test that claims it** by name: `Scenario: <exact name>`.
- **A requirement is satisfied when all its scenarios are.**
- **A command exiting 0 is evidence for that command only.** A skipped test satisfies nothing.

A failed check produces a [Finding](ontology/evidence/finding.md): `code-defect`, `spec-defect`, `test-defect`, `environment` or `needs-decision`.

## Not yet modelled

- **Agent Script steps return flat scalar fields only**, so they can't carry these types yet. Running loop steps as subagents needs nested outputs or a side channel.
- **The model assumes OpenSpec's `spec-driven` schema.** Custom schemas would need their steps generated from the schema's artifact graph.
