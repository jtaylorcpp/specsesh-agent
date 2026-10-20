## ADDED Requirements

### Requirement: The loop hands every delegate the task preamble
Each iteration's `agentscript.run` child SHALL carry `delegatePreamble` set to the task preamble rendered from the loop's durable input, so every delegate the iteration calls with `run` receives it before its instructions. A group loop's task runs SHALL carry it the same way; the group judge's run and the spec loop's runs SHALL carry none. No script variable is added.

#### Scenario: The bundled delegate script's delegate sees the contract
- **GIVEN** a task loop for task `2.1` of a change directory, running `task-delegate.agent` with `claude_code` granted to a fake `claude` that records its stdin
- **WHEN** iteration 1 calls the delegate
- **THEN** stdin SHALL start with the task preamble, then a blank line, then the iteration's `plan`

#### Scenario: A group's task run carries the preamble
- **GIVEN** a group loop over group `2` of a change directory
- **WHEN** it runs task `2.1` as a child task loop
- **THEN** that task loop's iteration run SHALL carry the task preamble for task `2.1`

#### Scenario: The group judge's run carries no preamble
- **GIVEN** a group loop whose group check fails
- **WHEN** it runs its judge
- **THEN** the judge's `agentscript.run` input SHALL have no `delegatePreamble`

#### Scenario: A resumed loop's preamble uses the texts read at start
- **GIVEN** a loop started from a directory, whose proposal.md is edited after the start
- **WHEN** the loop is resumed after a crash and runs its next iteration
- **THEN** that iteration's `delegatePreamble` SHALL hold the proposal text read at start

### Requirement: The task preamble is fixed text over the loop's sources
`taskPreamble(input)` SHALL return the opening line, `Change: <change>` (only when `change` is set), `Task <task>: <taskText>`, the three rules, then `# proposal.md`, `# design.md` (only when design is not `""`) and `# Spec deltas`, each followed by a blank line and its text with trailing newlines trimmed, and end with `# Instructions`. Blocks are separated by one blank line.

#### Scenario: The preamble for a change directory
- **GIVEN** a loop input with `change` `"add-x"`, `task` `"2.1"`, `taskText` `"Do X"`, `proposal` `"P\n"`, `design` `"D"` and `deltas` `"## a/b\nR\n"`
- **WHEN** `taskPreamble` renders it
- **THEN** it SHALL equal exactly:

```text
You are working on one task of an OpenSpec change. The documents below are its contract; the instructions after them are this iteration's plan.

Change: add-x
Task 2.1: Do X

Rules:
- Change only what the task needs.
- Never tick boxes in tasks.md, and never edit the change's proposal, design or spec deltas.
- If the spec itself looks wrong, say so in your reply instead of coding around it.

# proposal.md

P

# design.md

D

# Spec deltas

## a/b
R

# Instructions
```

#### Scenario: An empty design is left out
- **GIVEN** the same input with `design` `""`
- **WHEN** `taskPreamble` renders it
- **THEN** it SHALL contain no `# design.md` line, and `P` SHALL be followed by a blank line and `# Spec deltas`

#### Scenario: A change given as texts has no Change line
- **GIVEN** a loop started with `change` `{ proposal: { text }, deltas: [{ text }], tasks: { text } }`
- **WHEN** its preamble is rendered
- **THEN** it SHALL contain no line starting `Change:`, and its second block SHALL start with `Task `

### Requirement: The loop input names the change it came from
`TaskLoopInput` SHALL carry an optional `change`: the base name of `change.dir` for a `{ dir }` change, and absent for a change given as texts. A group loop SHALL pass its change's base name to each task loop it runs. A loop whose stored input has no `change` SHALL still run.

#### Scenario: A directory change is named
- **WHEN** a task loop starts with `change` `{ dir: "openspec/changes/add-x" }`
- **THEN** its durable input SHALL have `change` `"add-x"`
