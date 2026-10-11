# Docs

The taxonomy and ontology for executing OpenSpec changes, written down before it is implemented. One file per concept. This page is the directory: every concept is listed here once, with a one-line definition and its path.

- **Taxonomy** (`taxonomy/`): what a change is made of. Nouns read from files.
- **Ontology** (`ontology/`): what happens to a change. Steps, loops, evidence.
- **[overview.md](overview.md)**: the whole model on one page. Start here.
- **[CONVENTIONS.md](CONVENTIONS.md)**: how a concept page is written, and how `pnpm docs:check` keeps this directory honest.

Status: **implemented** as `@specsesh/agent/openspec`: each type is a TypeBox schema, which is itself a JSON Schema (`toJSONSchema` returns it as plain JSON), with its static type `Static` of it. The source of truth is the specs `openspec/model`, `openspec/process`, `openspec/loops` and `openspec/evidence`. Each page names the requirement it restates.

## Taxonomy

| Concept | Id | Definition |
|---|---|---|
| [Root](taxonomy/root.md) | `root` | Where a project's specs and changes live, and which schema it uses. |
| [Capability](taxonomy/capability.md) | `capability` | One spec: a path, a purpose and its requirements. |
| [CapabilityPath](taxonomy/capability-path.md) | `capability-path` | A capability's location as path segments, e.g. `["durable", "run-task"]`. |
| [Requirement](taxonomy/requirement.md) | `requirement` | A named, normative statement (SHALL/MUST) with its scenarios. |
| [Scenario](taxonomy/scenario.md) | `scenario` | A named, testable example of a requirement, as clauses. |
| [Clause](taxonomy/clause.md) | `clause` | One GIVEN, WHEN, THEN or AND line of a scenario. |
| [Change](taxonomy/change.md) | `change` | A unit of work: proposal, deltas, design, tasks and state. |
| [Proposal](taxonomy/proposal.md) | `proposal` | Why a change exists, what it changes, which capabilities it touches. |
| [Delta](taxonomy/delta.md) | `delta` | One edit to a capability: added, modified, removed or renamed. |
| [Design](taxonomy/design.md) | `design` | The change's free-form context, decisions and risks. |
| [TaskList](taxonomy/task-list.md) | `task-list` | The change's ordered task groups (`tasks.md`). |
| [TaskGroup](taxonomy/task-group.md) | `task-group` | A numbered section of the task list: one feature set. |
| [Task](taxonomy/task.md) | `task` | One checkbox: id, text, done, files and links. |
| [TaskId](taxonomy/task-id.md) | `task-id` | `<group>.<n>`, e.g. `2.4`. |
| [TaskLink](taxonomy/task-link.md) | `task-link` | An inferred link from a task to a requirement or scenario, with basis and confidence. |
| [RequirementRef](taxonomy/requirement-ref.md) | `requirement-ref` | A pointer to a requirement: capability path plus name. |
| [ScenarioRef](taxonomy/scenario-ref.md) | `scenario-ref` | A pointer to a scenario: capability path, requirement and scenario name. |
| [LinkBasis](taxonomy/link-basis.md) | `link-basis` | How a task link was found, from an exact scenario name down to a guess. |
| [Unclaimed scenario](taxonomy/unclaimed-scenario.md) | `unclaimed-scenario` | A delta scenario no task links to strongly: a coverage gap. |

## Ontology: process

| Concept | Id | Definition |
|---|---|---|
| [Step](ontology/process/step.md) | `step` | A named lifecycle step with a typed input, output and actor. |
| [StepResult](ontology/process/step-result.md) | `step-result` | What a step returns: a value, or a failure. Steps never throw. |
| [StepFailure](ontology/process/step-failure.md) | `step-failure` | Why a step failed: invalid input, refused, blocked or error. |
| [Intent](ontology/process/intent.md) | `intent` | The principal's words plus the existing capability index. |
| [CapabilityIndex](ontology/process/capability-index.md) | `capability-index` | Every existing capability path with its purpose. |
| [ValidationReport](ontology/process/validation-report.md) | `validation-report` | Strict validation's verdict and its issues by level. |
| [Approval](ontology/process/approval.md) | `approval` | The principal's yes or no on a change. |
| [ArchiveResult](ontology/process/archive-result.md) | `archive-result` | Where a change was archived and what it folded into the specs. |
| [ChangeState](ontology/process/change-state.md) | `change-state` | The change's state machine, from drafting to archived. |
| [propose](ontology/process/steps/propose-step.md) | `propose-step` | Intent → Proposal. |
| [specify](ontology/process/steps/specify-step.md) | `specify-step` | Proposal + base capabilities → deltas. |
| [design](ontology/process/steps/design-step.md) | `design-step` | Proposal + deltas → Design. |
| [plan](ontology/process/steps/plan-step.md) | `plan-step` | Proposal + deltas + design → TaskList. |
| [validate](ontology/process/steps/validate-step.md) | `validate-step` | Change → ValidationReport. |
| [approve](ontology/process/steps/approve-step.md) | `approve-step` | Change + report → Approval. The principal's gate. |
| [execute](ontology/process/steps/execute-step.md) | `execute-step` | Approved change → ChangeOutcome, by running the change loop. |
| [archive](ontology/process/steps/archive-step.md) | `archive-step` | Converged change → ArchiveResult, guarded by a fresh valid report. |

## Ontology: loops

| Concept | Id | Definition |
|---|---|---|
| [Loop](ontology/loops/loop.md) | `loop` | The one feedback-loop shape used at every level. |
| [LoopInput](ontology/loops/loop-input.md) | `loop-input` | Goal, context, budget and carried feedback. |
| [Budget](ontology/loops/budget.md) | `budget` | How many iterations (and how long) a loop may take. |
| [Iteration](ontology/loops/iteration.md) | `iteration` | One round: plan, act, gather evidence, judge, feed back. |
| [Action](ontology/loops/action.md) | `action` | Something an iteration did: an edit, a command or a delegation. |
| [ContextRef](ontology/loops/context-ref.md) | `context-ref` | A pointer to what a loop reads: a file, spec item, change or doc. |
| [Verdict](ontology/loops/verdict.md) | `verdict` | Whether the goal's targets are met, and which are not. |
| [Target](ontology/loops/target.md) | `target` | What a verdict judges: a requirement, a scenario or a named check. |
| [Feedback](ontology/loops/feedback.md) | `feedback` | A finding plus the action it calls for. |
| [Escalation](ontology/loops/escalation.md) | `escalation` | A question a blocked loop sends to a principal or an agent. |
| [EscalationAnswer](ontology/loops/escalation-answer.md) | `escalation-answer` | The named recipient's decision, which resumes the loop. |
| [LoopOutcome](ontology/loops/loop-outcome.md) | `loop-outcome` | How a loop ended: converged, blocked, exhausted or failed. |
| [Task loop](ontology/loops/task-loop.md) | `task-loop` | Drives one task until its linked targets hold. |
| [Group loop](ontology/loops/group-loop.md) | `group-loop` | Drives one task group: its task loops, then a group check. |
| [Change loop](ontology/loops/change-loop.md) | `change-loop` | Drives the task list until the spec is real. |
| [TaskOutcome](ontology/loops/task-outcome.md) | `task-outcome` | A task loop's result, including whether the box was ticked. |
| [GroupOutcome](ontology/loops/group-outcome.md) | `group-outcome` | A group loop's result: its task outcomes. |
| [ChangeOutcome](ontology/loops/change-outcome.md) | `change-outcome` | The change loop's result: group outcomes and unclaimed scenarios. |

## Ontology: evidence

| Concept | Id | Definition |
|---|---|---|
| [Evidence](ontology/evidence/evidence.md) | `evidence` | What a verdict may rest on: one of five kinds. |
| [TestEvidence](ontology/evidence/test-evidence.md) | `test-evidence` | A test's result, tied to the scenario its name claims. |
| [ValidationEvidence](ontology/evidence/validation-evidence.md) | `validation-evidence` | A ValidationReport, as evidence. |
| [CheckEvidence](ontology/evidence/check-evidence.md) | `check-evidence` | A command and its exit code. Evidence for that command only. |
| [DiffEvidence](ontology/evidence/diff-evidence.md) | `diff-evidence` | The files an iteration added, modified or deleted. |
| [ReviewEvidence](ontology/evidence/review-evidence.md) | `review-evidence` | An agent's or the principal's review verdict. |
| [Finding](ontology/evidence/finding.md) | `finding` | What a failed check found: code, spec or test defect, environment, or a needed decision. |
