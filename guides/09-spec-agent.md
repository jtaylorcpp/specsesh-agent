# Drafting changes with the spec agent

After this guide you can turn one sentence of intent into an OpenSpec change that `pnpm task` can execute: a proposal, a design, spec deltas and a task list, each drafted by an agent, checked by a gate with no model, and approved by you before the next stage starts. You will know what each stage owns and what its gate holds, how to approve, revise and hand-edit a draft, how slicing works, and why the gates insist on small changes and single-file tasks.

## Prerequisites

- Everything [07 Executing changes with the task loop](07-task-loop.md) needs: a built checkout, an `agentscript.config.json` with a `db`, and a provider. The spec agent uses the same `provider`, `model`, `maxIterations` and `escalateTo` as the task loop. `pnpm change` runs the built bin (`packages/agent/dist/bin/agentscript-change.js`), so run `pnpm build` first. Before that, it fails saying the file is missing.
- The [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI on `PATH`. The specs and tasks gates run `openspec validate` and `openspec show`.
- Background: [06 The OpenSpec ontology](06-openspec.md). The gates are built from its rules.

## A walkthrough

The whole journey, stage by stage, is mocked in the [`add-spec-loop` walkthrough](../openspec/changes/archive/2026-10-12-add-spec-loop/design/walkthrough.html). Open it in a browser. In the terminal, you address the change, never a loop:

```
agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]
agentscript-change build <change> [<answer>] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]
```

**Start** a change with `pnpm change draft <change> --intent "<words>"`, or `--intent-file <path>`. This creates `openspec/changes/<change>/intent.md` holding your words verbatim, and starts a draft loop over `SPEC_STAGES`, beginning with the proposal. A new change with neither flag exits 2, naming `--intent`, and creates nothing. On an existing change both flags are refused, so what you asked for never changes without you seeing it: edit `intent.md` instead.

```console
$ pnpm change draft add-plan-export --intent "Export a plan as JSON so CI can read it"
# add-plan-export — waiting for review of the proposal
### proposal draft 1: 1 issue
   WARNING proposal.md: 3 capabilities, over the budget of 2. Split it into one change per capability: … Write slices.md: one line per small change, this one first
### proposal draft 2: clean

Review openspec/changes/add-plan-export/proposal.md, openspec/changes/add-plan-export/slices.md, then:
  revise:   pnpm change draft add-plan-export "<what to change>"
  approve:  pnpm task answer 12 --by principal --decision approve
```

The output starts with `# <change> — <state>`, then `## <stage>: approved` for each approved stage, then the current stage's `### <stage> draft <n>` lines with their issues, and ends with the commands to run next. Before any model call, stderr names the loop and how to finish it if the process dies: `draft loop 12 — resume with: agentscript-change draft add-plan-export --db <path>`.

**Revise** with `pnpm change draft <change> "<feedback>"`. It answers the review as the principal (`git config user.name`, else `$USER`), and the stage's next draft carries `The principal asked for: <feedback>`. Drafts keep numbering:

```console
$ pnpm change draft add-plan-export "JSON only; no CSV"
# add-plan-export — waiting for review of the proposal
### proposal draft 3: clean
…
```

**Answer a question.** When the agent asks instead of drafting, the output ends with the question and the command to answer it, and exits 1:

```
question: CSV too?
  answer:   pnpm change draft add-plan-export "<answer>"
```

`pnpm change draft <change> "<answer>"` carries your answer into the next draft the same way.

**Look again.** `pnpm change draft <change>` alone, while something waits, prints the same review or question again and starts nothing. A change never has two drafts at once.

**Continue.** With nothing waiting, `draft` starts from the first stage that has no current approval. Editing an approved file, such as `design.md`, makes its approval stale, so drafting restarts from that stage. A draft that ended exhausted or failed is restarted the same way, with a fresh budget. With every stage approved and unchanged, it starts nothing, exits 0 and points at the build:

```
# add-plan-export — drafted: every stage is approved
## proposal: approved
## design: approved
## specs: approved
## tasks: approved

  next:     pnpm change build add-plan-export
```

**Approving** is the one step still addressed by loop id: the approve line names the draft loop (`12` above) until `add-change-approve` lands. As of `add-change-draft`, `pnpm task answer` doesn't find draft loops yet, so that line is refused with `no loop 12 in <db>`.

**Build it.** `pnpm change build <change>` runs every group of the drafted change in order, each with its task loops and judge, then a change check, and stops only when an agent needs a decision:

```console
$ pnpm change build add-plan-export --change-check "pnpm spec:check"
# add-plan-export — waiting for an answer
## group 1: converged (4 tasks, 0 reworks)
## group 2: blocked at 2.3

group 2 asks: The export can call the v1 or the v2 plan API. Which?
  answer:  pnpm change build add-plan-export "<answer>"

$ pnpm change build add-plan-export "Use the v2 API"
# add-plan-export — built
## group 1: converged (4 tasks, 0 reworks)
## group 2: converged (3 tasks, 1 rework)
## group 3: converged (2 tasks, 0 reworks)
## change check: passed

Changed: packages/plan/src/export.ts, packages/plan/src/cli.ts, …
Archive it: pnpm spec:archive add-plan-export
```

- **Flags.** `build` takes the group run's flags (`--check`, `--allow`, `--max-iterations`, `--escalate-to`, `--provider`, `--model`, …) plus `--change-check <command>`, which can be repeated and defaults to the resolved checks.
- **Refusals.** A dirty tree is refused unless you pass `--allow-dirty`, as with `pnpm task`. `--worktree` isn't supported yet. Both exit 2 and start nothing.
- **Answering.** The answer is positional, as `draft`'s feedback is, and goes to whoever the escalation names: you, with the default `escalateTo`. `build <change>` with no answer shows the question again.
- **Built.** A change that is already built says so and starts nothing.
- **Crashes.** If the process dies, `pnpm change build <change>` with the same database continues the unfinished build instead of starting another. Before any model call, stderr prints `change loop <id> — resume with: agentscript-change build <change> --db <path>`.
- **Reworks** are extra task runs: each one is the group's judge reopening a task.
- **Exit codes:** 0 built; 1 waiting for an answer, exhausted or failed; 2 usage or a refusal.

`pnpm spec:archive <change>` is the last step until `add-change-close`. [Building a whole change](07-task-loop.md#building-a-whole-change) in 07 covers the rest: the refusals, the output and the change loop.

### Where a change stands

| What waits | `pnpm change draft <change>` | `pnpm change draft <change> "<text>"` |
|---|---|---|
| nothing: the change doesn't exist | needs `--intent` or `--intent-file`, else exits 2 | exits 2 |
| a review | shows it again, exit 0 | redrafts the stage with your text |
| a question | shows it again, exit 1 | answers it with your text |
| nothing, a stage unapproved | starts a draft from that stage | exits 2: nothing waits |
| nothing, every stage approved | says so, starts nothing, exit 0 | exits 2: nothing waits |

Exit codes:

- **0:** waiting for your review, or every stage is approved.
- **1:** a question, or a draft that ended exhausted or failed. The latter ends with `retry: pnpm change draft <change>`.
- **2:** refused, before anything starts: usage, a missing or doubled intent, feedback with nothing waiting, an invalid `approvals.json`, or a database another process holds.

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

A clean draft waits for you. Read the files the output names, then answer. Your text in `pnpm change draft <change> "<text>"`, like `--decision` in `pnpm task answer` on a spec loop (see [Rerunning one stage](#rerunning-one-stage)), is the principal's decision:

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

**Sending a stage back.** Edit one of its approved files and run `pnpm change draft <change>`, or rerun the stage by name with `pnpm task spec add-plan-export design` (see [Rerunning one stage](#rerunning-one-stage)), and approve its new draft. Re-approving a stage replaces its entry and drops the entries of every stage after it, directly or through others. Those stages have to be drafted and approved again, against what you just approved.

## Draft a whole change

The draft loop (`agentscript.draft-loop`) is what `pnpm change draft` runs. It runs every stage that has no current approval, in order, and stops only for your review or a question. It sits above the stages the way the [group loop](07-task-loop.md) sits above tasks: each stage's gate and your review decide, and the draft loop decides nothing itself. This section covers the `./task` API, for hosts that draft a change without the CLI.

The [design's example](../openspec/changes/add-draft-loop/design/examples/draft.ts), a host drafting a change with one loop and four reviews:

```ts
import { answerDraftLoop, draftLoopExtensions, startDraftLoop, waitForDraftLoop } from "@specsesh/agent/task";

const options = { change: "add-plan-export", workspace: process.cwd(), intent: "Export a plan as JSON so CI can read it" };
for (const extension of draftLoopExtensions(options)) harness.install(extension);

let id = await startDraftLoop(harness, options, context);
let outcome = await waitForDraftLoop(harness, id, context);

while (outcome.status === "blocked") {
	// outcome.escalation.reason is "review" or "question"; its question names the files to read.
	const decision = await askThePrincipal(outcome.escalation.question); // "approve", or what to change
	id = await answerDraftLoop(harness, id, { by: "principal", principal: "jesse", decision }, context);
	outcome = await waitForDraftLoop(harness, id, context);
}

// converged: { change: "add-plan-export", stages: [
//   { stage: "proposal", approved: true, runs: 2 },
//   { stage: "design",   approved: true, runs: 1 },
//   { stage: "specs",    approved: true, runs: 1 },
//   { stage: "tasks",    approved: true, runs: 1 } ] }
console.log(outcome);
```

- `draftLoopExtensions(options)` returns the draft loop's extension plus the three that `specLoopExtensions` returns, so install only these.
- `startDraftLoop` takes `DraftLoopOptions`: the spec loop's options with `stages` in place of one `stage`. `stages` defaults to `SPEC_STAGES`.
- The first `waitForDraftLoop` returns `blocked` with reason `review`, and its question names `proposal.md`.
- Answering `approve` records the approval, drafts the design, and the new run blocks for review of `design.md`.
- Any other answer, such as `JSON only`, redrafts the same stage, and its next draft carries `The principal asked for: JSON only`. That is why the proposal above shows `runs: 2`.

Each answer starts a new draft run with its own id, so wait on the id that `answerDraftLoop` returns.

### How it works

The loop is one durable task with three phases:

- **`next`** picks the first stage with no entry in `approvals.json` whose hashes match its files. If there is none, the loop ends `converged`. This phase makes no model request and starts no child.
- **`stage`** starts an `agentscript.spec-loop` child for that stage, keeps the child's id in the checkpoint and awaits it. A resume after a crash awaits the same child, so no second spec loop starts for the stage. A converged child sends the loop back to `next`.
- **`answer`** is the first phase of a run that answers a blocked draft. It hands your answer to `answerSpecLoop` for the blocked child, then goes on as `stage` does.

### Outcomes

`waitForDraftLoop` returns a `LoopOutcome<DraftOutcome>`:

- **`converged`**: every stage is approved. A fully approved change converges at once, without starting a spec loop. If `design.md` was edited after its approval, the first spec loop is the design stage's.
- **`blocked`**: a stage's spec loop blocked. Its escalation is passed up unchanged: `level`, `reason`, a `question` that names the files to read, and `to`, which is `"principal"` for a review and the loop's `escalateTo` for a question.
- **`failed`**: a stage's spec loop ended exhausted or failed. The loop's notes name the stage, for example `the design stage ended exhausted`, and the stage is the last entry in the result, not approved.

The result lists every stage reached so far, in `stages` order:

```ts
type DraftOutcome = {
	change: string;
	stages: { stage: string; approved: boolean; runs: number }[];
};
```

`runs` counts the spec loops this draft, and the runs answering it, started for the stage. A stage approved before the draft began is listed with `runs: 0`, so the outcome always says which stages this draft wrote. For a change whose proposal was already approved, a draft that blocks for review of the design gives:

```json
{
  "change": "add-plan-export",
  "stages": [
    { "stage": "proposal", "approved": true, "runs": 0 },
    { "stage": "design", "approved": false, "runs": 1 }
  ]
}
```

### Rules

- **Only a blocked draft takes an answer.** `answerDraftLoop` refuses any other with `EscalationAnswerError`.
- **Only the principal approves.** An answer to a review needs `by: "principal"` and a `principal` name. An agent's `approve` is refused: no run starts and `approvals.json` is unchanged.
- **No "approve all", and no budget of its own.** You review every stage, and each spec loop keeps its own `maxIterations`.
- **One stage at a time.** Stages run one after another, never in parallel.
- **Custom stages.** Pass `stages`, to both `draftLoopExtensions` and `startDraftLoop`, to draft with stages other than `SPEC_STAGES`, as the tests do.

## Rerunning one stage

`pnpm change draft` is the normal way in. `pnpm task spec` runs a single spec loop for one stage, addressed by loop id, for low-level reruns or debugging:

```console
$ pnpm task spec add-plan-export design
# spec loop 14 — blocked (review)
## design draft 1: clean

Review openspec/changes/add-plan-export/design.md, then:
  approve:  pnpm task answer 14 --by principal --decision approve
  revise:   pnpm task answer 14 --by principal --decision "<what to change>"
```

`spec <change> <stage>` runs the stage you name. `spec <change>` with no stage runs the first stage that has no current approval. A change that doesn't exist yet needs `--intent "…"` or `--intent-file <path>`, as with `draft`. After that, `--intent` is refused (`intent.md exists; edit it instead`). A stage that waits for your review exits 0. A stage that ends on a question exits 1.

Approving a spec loop with `pnpm task answer <id> --by principal --decision approve` prints `proposal approved by jesse.` (or the stage you approved) and the next command. Once the last stage is approved, it points you at the task loop:

```
Every stage of add-plan-export is approved. Execute it: pnpm task add-plan-export --next-group
```

## Hand-editing a draft

The drafts are ordinary files, so edit them whenever you like. Each draft starts from `current`, which is read from disk, so the next draft builds on your edits, and the gate checks the result like any other draft.

Editing an *approved* file makes its approval stale, because the recorded sha256 no longer matches. `pnpm change draft <change>` then drafts again from that stage. A later stage is refused until you re-approve; the refusal names the file that changed and the stage to review. If `approvals.json` itself fails the schema, every start is refused and the message names the file.

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
