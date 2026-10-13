# Drafting changes with the spec agent

After this guide you can turn one sentence of intent into an OpenSpec change that `pnpm task` can execute: a proposal, a design, spec deltas and a task list, each drafted by an agent, checked by a gate with no model, and approved by you before the next stage starts. You will know what each stage owns and what its gate holds, how to approve, revise and hand-edit a draft, how slicing works, and why the gates insist on small changes and single-file tasks.

## Prerequisites

- Everything [07 Executing changes with the task loop](07-task-loop.md) needs: a built checkout (`pnpm build`), an `agentscript.config.json` with a `db`, and a provider. The spec agent uses the same `provider`, `model`, `maxIterations` and `escalateTo` as the task loop.
- The [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI on `PATH`. The specs and tasks gates run `openspec validate` and `openspec show`.
- Background: [06 The OpenSpec ontology](06-openspec.md). The gates are built from its rules.

## A walkthrough

The whole journey, stage by stage, is mocked in the [`add-spec-loop` walkthrough](../openspec/changes/archive/2026-10-12-add-spec-loop/design/walkthrough.html). Open it in a browser. In the terminal, a stage looks like this:

```console
$ pnpm task spec add-plan-export --intent "Export a plan as JSON so CI can read it"
# spec loop 12 — blocked (review)
## proposal draft 1: 1 issue
   WARNING proposal.md: 3 capabilities, over the budget of 2. Split it into one change per capability: … Write slices.md: one line per small change, this one first
## proposal draft 2: clean

Review openspec/changes/add-plan-export/proposal.md, then:
  approve:  pnpm task answer 12 --by principal --decision approve
  revise:   pnpm task answer 12 --by principal --decision "<what to change>"

$ pnpm task answer 12 --by principal --decision approve
# spec loop 13 — converged (approved)
proposal approved by jesse.
Next: pnpm task spec add-plan-export
```

Run `pnpm task spec add-plan-export` again for each stage after that. Once the last stage is approved, the output points you at the task loop:

```
Every stage of add-plan-export is approved. Execute it: pnpm task add-plan-export --next-group
```

`spec <change>` with no stage runs the first stage that has no current approval. `spec <change> <stage>` runs the stage you name. The first run of a new change needs `--intent "…"` or `--intent-file <path>`. Your words go verbatim into `intent.md` in the change directory. After that, `--intent` is refused (`intent.md exists; edit it instead`), so what you asked for never changes without you seeing it. A stage that waits for your review exits 0. A stage that ends on a question exits 1.

Each run of a stage is a durable spec loop:

1. The stage's script drafts the stage's files.
2. The loop writes them into `openspec/changes/<id>/`.
3. The stage's gate checks them.

If any `ERROR` or `WARNING` remains, the loop carries those issues into the next draft, up to `maxIterations` drafts (default 8), and then ends `exhausted`. A clean gate ends the loop `blocked` for your review. The agent can't argue its way past a gate, because the gate has no model: "small" and "valid" are rules.

## The four stages

They run in a fixed order, `proposal` → `design` → `specs` → `tasks` (`SPEC_STAGES`). Each one starts only after the stage before it is approved.

| Stage | Owns | Follows | Script |
|---|---|---|---|
| `proposal` | `proposal.md`, `slices.md` | none | `spec-proposal.agent` |
| `design` | `design.md`, `design/` | `proposal` | `spec-design.agent` |
| `specs` | `specs/` | `design` | `spec-specify.agent` |
| `tasks` | `tasks.md` | `specs` | `spec-plan.agent` |

A stage writes only the files it owns. A path it doesn't own, an absolute path or a path with `..` is not written, and the next draft hears about it as an `ERROR`.

### What each gate checks

- **proposal:**
  - exactly the five sections, in order: `## Why`, `## What Changes`, `## Out of scope`, `## Capabilities`, `## Impact`;
  - at least one backticked `<area>/<name>` after `**New:**` or `**Modified:**`. A `Modified` path must have a spec in `openspec/specs/`, and a `New` path must not;
  - at most two capabilities (a `WARNING`), unless the draft writes a valid `slices.md` (see [Slicing](#slicing)).
- **design:**
  - `design.md` has at least two `##` sections;
  - `design/` holds at least one mock, a complete `.html` document that loads nothing from the network;
  - `design/examples/` holds at least one example;
  - every `design/…` path that `design.md` names exists.
- **specs:**
  - `openspec validate <id> --strict` passes;
  - every capability the approved proposal names has a delta, and no other capability does;
  - every new capability's delta has a `## Purpose`;
  - the capabilities, requirements and scenarios limits from `openspec/size` hold.
- **tasks:** see [What the tasks gate holds](#what-the-tasks-gate-holds).

### Seeds

Every stage's script receives the same variables:

- `intent`: the contents of `intent.md`;
- `approved`: the approved stages' files, one `=== <path>` section per file;
- `current`: the stage's own files as they are on disk now;
- `base`: something specific to the stage;
- `carried`: the issues from the last draft, or what you asked for.

`base` is:

- **proposal:** one `<area>/<name>: <purpose>` line per spec in `openspec/specs/`.
- **design and specs:** the spec of every capability the proposal modifies.
- **tasks:** the repository's file paths from `git ls-files`, so tasks name real files. This list stops at 3,000 paths. A last line then says how many were cut, so a repository tracking 3,005 files gives 3,000 paths and a line saying 5 were cut. Outside git, `base` is empty.

For the tasks stage, `approved` holds the proposal, `design.md` with the files under `design/examples/`, and every delta.

## Approving and revising

A clean draft waits for you. Read the files the output names, then answer:

- **`--decision approve`** (any case) records your approval and drafts nothing.
- **Any other decision** asks for another draft. Your words are carried in as `The principal asked for: <decision>`, and the drafts keep numbering from where they stopped.
- **A question** from the agent (`next_action` `ask`) skips the gate and ends the loop `blocked` with the question. Your answer is carried into the next draft the same way and never counts as an approval, even if it is `approve`.

Only the principal approves. `--by` must be `principal`. The name recorded is `--principal <name>`, or `git config user.name` when you don't pass it. A refused answer records nothing and starts nothing.

An approval is an entry in the change's `approvals.json`:

```json
{
  "approvals": [
    {
      "stage": "proposal",
      "approved": true,
      "by": "principal",
      "principal": "jesse",
      "notes": "",
      "at": "2026-10-12T09:14:03.000Z",
      "files": { "proposal.md": "<sha256>", "slices.md": "<sha256>" }
    }
  ]
}
```

The file is checked against its schema every time it is read. The runner never commits it: commit it yourself, together with the stage's files.

**Sending a stage back.** Run the stage again by name, for example `pnpm task spec add-plan-export design`, and approve its new draft. Re-approving a stage replaces its entry and drops the entries of every stage after it, directly or through others. Those stages have to be drafted and approved again, against what you just approved.

## Hand-editing a draft

The drafts are ordinary files, so edit them whenever you like. Each draft starts from `current`, which is read from disk, so the next draft builds on your edits, and the gate checks the result like any other draft.

Editing an *approved* file makes its approval stale, because the recorded sha256 no longer matches. `pnpm task spec <id>` then runs that stage again. A later stage is refused until you re-approve; the refusal names the file that changed and the stage to review. If `approvals.json` itself fails the schema, every start is refused and the message names the file.

## Slicing

An intent that touches more than two capabilities is too big for one change. The proposal gate warns, and the warning tells the agent to write `slices.md`: one line per small change, this change first.

```markdown
1. `add-plan-export`: Export a plan as JSON with `specplan export --json`.
2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.
3. `add-plan-export-ci`: A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.
```

The gate holds `slices.md` to these rules, each break an `ERROR`:

- at least two lines, numbered 1, 2, 3…;
- the first line is this change;
- every id is kebab-case, listed once, and not already used by a change or an archived change.

With `slices.md` in place, the proposal must cover only the first slice, so the size warning has to go too. When you approve, the output prints a `pnpm task spec <id> --intent "…"` command for every other slice. You start those yourself, when you're ready: once you've seen the first one land, you may reorder, drop or merge the rest.

## What the tasks gate holds

A `tasks.md` that passes:

```markdown
## 1. The stage

- [ ] 1.1 `packages/agent/src/task/stages/tasks-gate.ts` (new): the list, claim and size rules
- [ ] 1.2 `packages/agent/src/task/stages/tasks.ts` (new): `tasksStage` with its seed and gate

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/stages/tasks-gate.test.ts`: "A task naming two files is sent back", "An unclaimed scenario is sent back", "A ticked task is sent back" and "Thirteen tasks are sent back" (4)

## 3. Verify

- [ ] 3.1 `pnpm check` and `pnpm test` pass
```

**The list itself.** Each of these is an `ERROR`:

- a line under a `## <n>. <title>` group heading that is neither a `- [ ] <n>.<m> <text>` task, a blank line, nor an indented continuation of a task;
- a list that fails the ontology's `TaskList` check, such as a task id outside its group;
- a ticked task. `- [x] 1.1 …` is reported as `task 1.1 is ticked`, because a planned task starts unticked.

Text before the first heading is ignored.

**Each task.** `taskIssues` (`openspec/size`) reports a `WARNING` at `tasks.md#<id>` for each rule a task breaks:

- **One file.** A task that names `src/a.ts` and `src/b.ts` gets a warning naming both. A file here is a path with at least one `/` and an extension. A task naming no file, such as "run the checks", passes this rule.
- **One line.** A continuation line makes the task span two lines, which breaks this rule.
- **240 characters or less.**
- **At most 4 scenarios per test task.**

**Claims.** A task claims a scenario by quoting its exact name in double quotes, anywhere in its text. Each claim becomes a `scenario-named` link, and those links are what the four-scenario limit counts.

**Every scenario is claimed.** Every scenario of an ADDED or MODIFIED delta must be quoted by some task. Otherwise the gate reports an `ERROR` naming the scenario and its capability, for example `no task names "A clean draft waits for review" (spec/stages)`. A scenario no task names is behaviour the spec promises and nothing builds.

**Size.** Only the groups and tasks limits of `openspec/size` apply here: at most 4 groups and 12 tasks. Thirteen tasks give `13 tasks, over the budget of 12.`, followed by a suggestion to split the change by group. The specs stage already checked the capabilities, requirements and scenarios limits, so this gate doesn't report them.

Order tasks so that each one leaves the checks passing, as [07](07-task-loop.md#shape-tasks-so-the-checks-can-go-green) explains. The plan script is told to do this, but the gate doesn't check it.

## The size budget

The limits are `DEFAULT_SIZE_BUDGET` in `openspec/size`. They come from this repository's own changes, counted when the rules were written:

| Change | Capabilities | Requirements | Scenarios | Groups | Tasks |
|---|---|---|---|---|---|
| bound-step-results | 1 | 5 | 8 | 3 | 7 |
| switch-ontology-to-typebox | 2 | 8 | 10 | 5 | 12 |
| add-group-loop | 5 | 44 | 65 | 6 | 27 |
| add-actors-and-workspaces | 8 | 50 | 82 | 6 | 25 |

The budget is set at the size of the two changes that converged cleanly: 2 capabilities, 6 requirements, 16 scenarios, 4 groups and 12 tasks. The one-file rule comes from the tasks that converged on the first try, each of which named one source file or one test file. The loops converge on single-action, single-file tasks that a check can confirm, and the gates hold every draft to that shape.

Size issues are `WARNING`s, not `ERROR`s. Strict validation already fails on a warning, and a spec loop treats any `WARNING` as blocking, so a draft that is too large goes back to be narrowed.

## Limits

- **Task order isn't checked.** The plan script is asked to order tasks by dependency; the gate doesn't verify it.
- **Large repositories.** 3,000 paths in the tasks stage's `base` is about 100 KB of seed text.
- **No live run through all four stages yet.** Every stage is tested against fakes, and a live test (`add-spec-cli-events`) only covers a real model drafting a proposal. Designs, deltas and task lists are larger strings to pass through `--json-schema`, and a live run from intent to `--next-group` is parked as a follow-up in `openspec/parked.md`.
