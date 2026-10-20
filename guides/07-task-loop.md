# Executing OpenSpec changes with the task loop

After this guide you can point `agentscript-task` at an OpenSpec change in your repository and have an agent work its `tasks.md` unattended: one task at a time or a whole task group, in your working tree or in its own git worktree, until your checks pass or the budget runs out. You will know how to configure it, how to write changes and tasks an agent can finish, how to read what it prints, how to answer when it stops to ask, and how to tune the script it runs.

Coming from [09 The spec agent](09-spec-agent.md)? Once `pnpm change draft <change>` converges, it ends with `pnpm change build <change>`, and that is the next step, no longer `pnpm task <change> --next-group`. `pnpm change build <change>` runs the whole change: each group in order as its own group loop, with its task loops and judge, then the change check (see [Building a whole change](#building-a-whole-change)). `pnpm task <change> <group>` (`pnpm task run …`) still runs a single group; use it to rerun or debug one group.

## Prerequisites

- Node 22.19 or newer, a git repository, and an OpenSpec project (`openspec/changes/<id>/` with `proposal.md`, `specs/<capability>/spec.md` and `tasks.md`). The [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI is not required to run the loop, but you will want it to validate and archive changes.
- `npm install @specsesh/agent` plus the peers the loop runs on: `npm install @earendil-works/pi-ai @earendil-works/pi-durable @earendil-works/chord`. The bin is `agentscript-task` (`npx agentscript-task`). In a checkout of this repository, run `pnpm build` first and use `pnpm task …`, which is `node packages/agent/dist/bin/agentscript-task.js` with `run` implied.
- For `claude-code`: the `claude` binary on `PATH`, logged in to your Claude subscription. For `anthropic` or another pi provider: that provider's API key in its usual environment variable.
- Checks the agent can be held to: commands that exit 0 when the repository is healthy (`pnpm check`, `pnpm test`).
- Background: [06 The OpenSpec ontology](06-openspec.md) for the model, and [03](03-durable-agents.md) and [04](04-actions.md) for the durable runs and actions underneath.

## What a task loop does

`agentscript-task run <change> <task-id>` reads the change once, then repeats four phases until it has an outcome:

1. **Orient.** A model step reads the task, the proposal, the design and the spec deltas, plus what was still unmet last time, and writes a plan.
2. **Act.** The plan is carried out in your workspace. Either the model edits files and runs allowed commands itself (`task.agent`), or the plan is handed to a headless Claude Code (`task-delegate.agent`).
3. **Check.** The configured `checks` run, with no model.
4. **Judge.** A model step says whether the task is met and, if not, what is unmet and what to do next.

The rules around that cycle are the point of the tool:

- **"Done" counts only when every check passes.** If the judge says met and checks are configured, the loop runs them itself in a *gate* phase. A failing check turns the verdict into unmet; the failing commands and the last 4000 characters of each one's output go into the next iteration. With no checks configured, the judge's word alone converges, so configure checks.
- **`next_action` is constrained.** The judge answers one of `retry`, `amend-spec` or `ask`; the loop passes these as the allowed values, so the model's result schema lists them. The bundled judges default to `retry`: `amend-spec` only when the deltas contradict each other or the code, `ask` only for a decision no passing check could settle.
- **It iterates until the checks pass or the budget is spent.** `maxIterations` defaults to 8. A failed action, such as the delegate timing out after 10 minutes, is an unmet iteration that carries the action's message; it costs one iteration. A failed *step* (the provider errors, the model's answer is refused three times) ends the loop `failed`.
- **It stops to ask.** `ask` or `amend-spec` ends the loop `blocked` with an escalation addressed to the `principal` (the default) or an `agent`. It resumes when you answer.
- **Only a converged loop ticks the box.** The loop rewrites exactly that task's `- [ ]` to `- [x]` in `tasks.md`, and nothing else in the file.

Outcomes are `converged`, `blocked`, `exhausted` (budget spent) or `failed`. See [Task loop](../docs/ontology/loops/task-loop.md) and [Group loop](../docs/ontology/loops/group-loop.md) for the definitions.

One honest limit: the ontology links tasks to scenarios by inference, but the runner does not infer links yet. Every verdict judges a single target, the named check `task <id>`, and what makes it true is your checks. Your tests are the spec's teeth.

## Set up a repository

### The config file

`agentscript.config.json` at the repository root holds the runner's defaults. The nearest one is found by walking up from the current directory; only its `task` object is read. Every field is optional and typed. An unknown key or a wrong type refuses the run, naming the key and the file (exit 2), so a typo never silently falls back to a default.

This repository's own file:

```json
{
  "task": {
    "changesDir": "openspec/changes",
    "db": ".agentscript/task-loops.sqlite",
    "provider": "claude-code",
    "model": "opus",
    "delegateModel": "opus",
    "script": "task-delegate",
    "checks": ["pnpm check", "pnpm test"],
    "allow": ["pnpm", "node"],
    "maxIterations": 8,
    "escalateTo": "principal",
    "delegateContext": ["CLAUDE.md"],
    "requireCleanTree": true,
    "worktreeSetup": ["pnpm install --frozen-lockfile --prefer-offline"]
  }
}
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `changesDir` | string | `openspec/changes` | Where `<change>` ids are looked up. |
| `db` | string | none | The SQLite file that holds the loops. `run`, `resume`, `answer` and `status` need it from here or `--db`. In worktree mode only `--db` counts. |
| `provider` | string | `anthropic` | A pi provider id, or `claude-code`. Flag `--provider`, then `AGENTSCRIPT_PROVIDER`, then this. |
| `model` | string | `claude-haiku-4-5` | Model for every script step. Flag `--model`, then `AGENTSCRIPT_MODEL`, then this. On `claude-code`: `haiku`, `sonnet`, `opus` or a full id. |
| `delegateModel` | string | the resolved `model` | `--model` for the headless Claude Code that `task-delegate` acts through. Config only. |
| `script` | string | `task` | `task`, `task-delegate`, or a path to your own `.agent`. Flag: `--script`. |
| `groupScript` | string | `group` | The group judge: `group` or a path. Flag: `--group-script`. |
| `checks` | string[] | `[]` | Commands run after each iteration and at the gate, in order. Flag: `--check`, repeated. |
| `allow` | string[] | `[]` | The first words a command the agent runs may start with. Flag: `--allow`, repeated. |
| `maxIterations` | integer ≥ 1 | `8` | Iterations per task run. Flag: `--max-iterations`. |
| `maxReworks` | integer ≥ 1 | `2` | Reworks per group run. Flag: `--max-reworks`. |
| `escalateTo` | `"principal"` or `"agent"` | `principal` | Who an escalation is addressed to, and so who may answer. Flag: `--escalate-to`. |
| `delegateContext` | string[] | `[]` | Files appended to the delegate's system prompt. |
| `requireCleanTree` | boolean | `true` | Refuse to run on uncommitted changes. Flag: `--allow-dirty` turns it off for one run. |
| `worktree` | boolean | `false` | Run in a new git worktree by default. Flag: `--worktree`. |
| `worktreeDir` | string | `../<repo>-worktrees` | Where worktrees go. |
| `worktreeSetup` | string[] | `[]` | Commands run in a new worktree before the loop starts. |

Paths in the file (`changesDir`, `db`, `script`, `groupScript`, `delegateContext`, `worktreeDir`) are relative to the config file. Paths in flags are relative to where you run the command. There is also `--workspace <dir>` (flag only): the directory every action is confined to, default the current directory.

Commands (`checks`, `worktreeSetup`) are split on whitespace and spawned directly, with no shell: no quoting, pipes, `&&` or environment assignments. Put a pipeline in a package script and check that (`"pnpm check"`).

Ignore the database. Add `.agentscript/` to `.gitignore`, or the second run will see an untracked directory and refuse a dirty tree.

### Which script: `task` or `task-delegate`

| | `task.agent` | `task-delegate.agent` |
|---|---|---|
| Who edits files | The model, step by step, through `read_file`, `edit_file` and `run_command` | A headless Claude Code, run as `claude -p --safe-mode` with Read, Edit, Write, Glob, Grep and `Bash` limited to your `allow` words |
| Needs a provider that can call tools | Yes: pi providers such as `anthropic` | No |
| Works with `--provider claude-code` | **No.** That provider serves no model-callable tools. | Yes, and this is the combination to use on a subscription |
| Use when | You run on an API key and want the loop to own every edit and command | You run on your Claude subscription, or want Claude Code's own file tools for the editing |

The bundled scripts live in `node_modules/@specsesh/agent/dist/task/scripts/` (and `packages/agent/src/task/scripts/` in this repo): `task.agent`, `task-delegate.agent` and `group.agent`.

### Credentials

With `--provider claude-code`, every step is one `claude -p` process logged in as you. The tool strips `ANTHROPIC_API_KEY` from that process's environment so your subscription login is used rather than a metered key, and it never reads or forwards Claude Code's OAuth token. `--safe-mode` keeps your global `CLAUDE.md`, skills and hooks out of the steps, which is why the delegate only sees repo guidance you list in `delegateContext`. Any other provider reads its own environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).

## Write changes an agent can execute

### What the loop reads

When a run starts it reads, once, from `openspec/changes/<id>/`: `proposal.md` and `tasks.md` (required), every `specs/**/spec.md` (at least one required), and `design.md` (optional). It stores that text in the loop's database, so editing files mid-run changes nothing for a loop already started. The deltas reach the script as one string, each file under a `## <capability>` heading taken from its path (`specs/cli/spec.md` becomes `## cli`). The change's *delta* files are what the agent sees, not the base specs, so a MODIFIED requirement should restate the whole requirement.

In the bundled scripts only **orient** reads the proposal, design and deltas. The plan it writes is what `act` and `judge` see, and the judge also sees the check output. Two consequences: keep `proposal.md` short, since it is in every orient prompt; and let your checks carry the spec, because a judge cannot hold the agent to a scenario no test exercises.

### The `tasks.md` format

```markdown
## 1. The flag

- [ ] 1.1 `src/greet.ts`: add `shout` to the options and upper-case the greeting when set
- [ ] 1.2 `__tests__/greet.test.ts`: one test per scenario of "greet can shout", named `Scenario: <exact name>`, calling `greet` from 1.1

## 2. Docs

- [ ] 2.1 `README.md`: document `--shout`
```

- A group is a `## <n>. Title` heading. A task is a line that starts at column 0 with `- [ ] <group>.<n> ` (or `- [x] ` once done), and its id begins with its group's number. Lowercase `x`, no indentation: the single-task reader does not find an indented line.
- **Only the checkbox line reaches the agent.** Sub-bullets and following paragraphs are for humans. Put everything the agent needs on the line, and the rest in `design.md` or the deltas.
- `--next` takes the first `- [ ]` line in the file; `--next-group` the first `## <n>.` group with an unticked task.

### Shape tasks so the checks can go green

- **Order tasks so every task leaves the checks green.** The gate runs *all* configured checks after every task. A task that cannot pass them until a later task lands will never converge. Do not write a failing test in task 1.2 and the code in 1.3; write the code in 1.1 and a test that passes against it in 1.2, or put both in one task.
- **Name files by repository-relative path, in backticks.** It tells the agent where to look.
- **One test task per at most about 8 scenarios.** A task that must satisfy fifteen scenarios runs out of iterations. Split a capability's tests across tasks, each naming the scenarios it covers.
- **Name the files earlier tasks produce.** "calling `greet` from 1.1" saves the agent a search.
- **Name tests after scenarios** (`Scenario: <exact name>`). The runner does not match test names to scenarios yet, but the ontology's `satisfies` does, and it makes failures trace back to a spec line.
- **Keep deltas concrete.** `SHALL` statements with scenarios that have a `WHEN` and a `THEN`. Run `openspec validate <id> --strict` before you start.

## Run it

### One task, or the next one

```bash
agentscript-task run add-shout-flag 1.1     # one task
agentscript-task run add-shout-flag --next  # the first unticked task
```

`<change>` is an id under `changesDir`, or a path to a change directory. `--next` on a finished change prints `no unticked task in add-shout-flag` and exits 0. A task already ticked still runs; it ends `converged` with `ticked: false` and a note that it was already ticked.

The first stderr line, before any model call, is the resume hint: `loop 7 — resume with: agentscript-task resume 7 --db <path>`. Loop ids are numbers; they are task ids in the database and not consecutive.

### Building a whole change

```bash
pnpm change build add-plan-export                                   # start, or show what's waiting
pnpm change build add-plan-export --change-check "pnpm spec:check"  # a broader final check
pnpm change build add-plan-export "Use the v2 API"                  # answer the agent that asked
pnpm change build add-plan-export --allow-dirty                     # build over uncommitted edits
```

The usage is `pnpm change build <change> [<answer>] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]` (the bin is `agentscript-change`). `build` runs a [change loop](#the-change-loop-from-code): every group of the change in order, each as its own group loop with its task loops and judge, then the change check.

- **Flags.** The group run's flags carry over (`--check`, `--allow`, `--max-iterations`, `--escalate-to`, `--provider`, `--model` and the rest) and resolve through flags, environment, config and defaults exactly as for `pnpm task`.
- **`--change-check <command>`** can be repeated and defaults to the resolved `--check` commands. Use it for an end-of-change set too slow to run after every task.
- **`--worktree` is refused for now:** `build has no --worktree yet; run it in a clean checkout`. A build always runs in place, even when the config sets `worktree`.

Each of these refusals exits `2` and starts nothing:

- uncommitted changes without `--allow-dirty`, listed as `pnpm task` lists them;
- a refusal by the change loop's [guard](#the-guard), such as a requirement with no scenario, or an approved file edited since its approval;
- an answer when nothing waits: `nothing of add-plan-export waits for an answer; run build add-plan-export without one`.

`build` is addressed by change, never by loop id. What it does depends on the change's newest change loop:

| Newest change loop | State | `build` | `build "<text>"` |
|---|---|---|---|
| none, or ended exhausted or failed | ready to build | starts one | refused, nothing waits |
| `blocked` | waiting for an answer | shows the question again, exit 1 | answers it as the escalation's `to` |
| `converged` | built | says so, exit 0 | refused, nothing waits |

A session in which group 2 asks a question:

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

Reading the output:

- **The header** is `# <change> — <state>`: `built`, `waiting for an answer`, `exhausted` or `failed`.
- **One line per group entered:** `## group <n>: <status> (<k> tasks, <r> reworks)`, or `## group <n>: blocked at <task>`. Tasks are the group's entries; reworks are the sum of `runs - 1` over its tasks, each extra run being the judge reopening a task (or the rerun after an answer).
- **The change check**, once it ran: `## change check: passed`, or `## change check: failed` followed by each failing command and its output.
- **`## unclaimed: <n>`**, when any delta scenario is quoted by no task, then one scenario per line.
- **`Changed:`** lists the files changed since the build started, less `tasks.md` and the database. Nothing is committed.
- **The last line is the command to run next:** `pnpm change build <change> "<answer>"` when waiting, `pnpm spec:archive <change>` when built, `retry: pnpm change build <change>` after an exhausted or failed build, which the next `build` restarts with a fresh budget.

**Answering.** The answer is positional, as `draft`'s feedback is, and goes in as the escalation's `to`: the `principal` by default, the `agent` when `--escalate-to agent` addressed it there. The blocked group reruns first, then the remaining groups and the change check. Running `build` alone on a waiting change shows the question again, starts nothing and exits `1`.

| Exit | Meaning |
|---|---|
| `0` | Built |
| `1` | Waiting for an answer, exhausted or failed |
| `2` | Usage error or a refusal |

**Long runs.** A build runs every group's task loops and checks in one process. The loop is durable: before any model call, stderr prints `change loop <id> — resume with: agentscript-change build <change> --db <path>`. If the process dies, that command, or `pnpm change build <change>` with the config's database, finds the unfinished loop and continues it rather than starting another.

`pnpm spec:archive <change>` is the last step until `add-change-close` replaces it with `pnpm change close`.

### Groups

To run one group, to rerun or debug it, use `pnpm task <change> <group>`. To run every group of a change, use [`pnpm change build`](#building-a-whole-change).

```bash
agentscript-task run add-shout-flag 1              # a bare integer is a group
agentscript-task run add-shout-flag --next-group
agentscript-task run add-shout-flag 1 --max-reworks 3 --group-script ./judges/group.agent
```

A group loop runs the group's unticked tasks in file order, each as its own task loop, then runs the configured checks once more as the **group check** (a group needs at least one check, or the run is refused with `a group needs at least one check`). Ticked tasks are skipped, so a re-run continues where it stopped. If a task does not converge, the group ends: `blocked` if the task asked (the escalation is addressed at group level), `failed` if it was exhausted or failed.

When the group check fails after every task converged, the **group judge** (`group.agent`) picks one of `rework`, `ask` or `amend-spec`. `rework` names one task of the group and what it must fix: that task is unticked in `tasks.md`, rerun with the failing check output and the judge's feedback carried in, and the group check runs again. Reworks are bounded by `--max-reworks` (default 2); spending them ends the group `exhausted`. `ask` and `amend-spec` end it `blocked`.

### The change loop from code

A change loop builds every group of a change, one group loop at a time, and each group loop runs its own task loops:

```text
change loop   agentscript.change-loop   groups 1, 2, 3 …, then the change check
└─ group loop   agentscript.group-loop    the group's tasks, then the group check and judge
   └─ task loop   agentscript.task-loop     orient, act, check, judge, until the task converges
```

The change loop runs every group in order and then a change check, and returns `LoopOutcome<ChangeOutcome>`: `groups` (one entry per group: `group`, its latest group-loop `outcome`, and `runs`) and `unclaimed`. [`pnpm change build`](#building-a-whole-change) runs it from the command line; this section is for hosts that run it from code.

#### The example

Set up the models and the database as in [Use the library from code](#use-the-library-from-code), but install `changeLoopExtensions(options)` in the registry, in place of the task or group extensions. It returns the change loop's extension plus everything `groupLoopExtensions` returns, so one registry runs all three levels.

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	answerChangeEscalation,
	changeLoopExtensions,
	startChangeLoop,
	waitForChangeLoop,
	type ChangeLoopOptions,
} from "@specsesh/agent/task";

const context = BACKGROUND_CONTEXT;
const options: ChangeLoopOptions = {
	change: { dir: "openspec/changes/add-plan-export" },
	workspace: process.cwd(),
	checks: ["pnpm test"],
	changeChecks: ["pnpm test", "pnpm spec:check", "pnpm docs:check"],
	allow: ["pnpm", "node"],
	budget: { maxIterations: 6, maxReworks: 2 },
};

const registry = createRegistry();
for (const extension of changeLoopExtensions(options)) registry.install(extension);
const harness = await Harness.open(await openNodeSqliteStorage(".agentscript/loops.sqlite"), { models, registry }, context);

// Refused before anything exists: an invalid change, or one no longer as approved.
let id = await startChangeLoop(harness, options, context);
harness.resume();
let outcome = await waitForChangeLoop(harness, id, context);

while (outcome.status === "blocked") {
	// Level "change": a task or a group judge needs a decision.
	const { escalation } = outcome;
	const decision = await askThePrincipal(escalation.question);
	id = await answerChangeEscalation(harness, id, { escalation, by: escalation.to, decision, feedback: [] }, context);
	harness.resume();
	outcome = await waitForChangeLoop(harness, id, context);
}

switch (outcome.status) {
	case "converged":
		// groups: [{ group: 1, runs: 1, … }, { group: 2, runs: 2, … }, { group: 3, runs: 1, … }]
		// Group 2 ran twice: it blocked once and was answered.
		for (const { group, runs } of outcome.result.groups) console.log(`group ${group}: runs ${runs}`);
		for (const { capability, scenario } of outcome.result.unclaimed) console.log(`unclaimed: ${capability.join("/")} › ${scenario}`);
		break;
	case "failed": {
		// A group that did not converge, or else the change check's evidence.
		const stopped = outcome.result?.groups.find((entry) => entry.outcome.status !== "converged");
		if (stopped !== undefined) console.log(`group ${stopped.group} ended ${stopped.outcome.status}`);
		for (const evidence of outcome.iterations[0]?.evidence ?? []) {
			if (evidence.kind === "check") console.log(`${evidence.command}: exit ${evidence.exitCode}\n${evidence.output}`);
		}
		break;
	}
}
await harness.close(context);
```

`models` and `askThePrincipal` are yours: the first as in the task loop example, the second however your host reaches the principal. `change` must be `{ dir }`, because the guard validates the change by its directory name. A blocked outcome's `escalation` is the blocked group's, copied at level `change`, with its `to`, `reason` and `question`.

#### The guard

`startChangeLoop` runs a guard before it creates anything, so a refused build leaves no loop behind. It rejects with a `TaskLoopStartError` naming why:

- **The change must pass `openspec validate --strict`.** The refusal names the first issue. The guard runs `openspec` in the workspace, so the OpenSpec CLI must be installed.
- **If `approvals.json` exists, the change must be as approved.** Every stage must be approved, and every file's sha256 must still match the recorded one. Otherwise the refusal names the file and the stage, for example `tasks.md changed since the tasks stage was approved; review it again`. The fix is to run that stage again and approve it: `pnpm task spec <change> <stage>`.
- **A hand-written change, with no `approvals.json`, builds as it is.**
- **Unclaimed scenarios are reported, never refused.** A delta scenario that no task in `tasks.md` quotes by its exact name is listed in the outcome's `unclaimed`, as it stood when the loop started.

The task script and the group judge are checked as `startGroupLoop` checks them, and the change needs at least one check.

#### The phases

The change loop is one durable task, `agentscript.change-loop`, whose phases run `next` → `group` → `check`. `next` takes the next group from the queue, or goes to `check` when the queue is empty. `group` runs that group as a child group loop:

- **Every group runs, ticked or not.** The queue is every group in `tasks.md`, ascending. A group whose tasks are all ticked starts no task loop, but its group loop still runs its group check, so it is checked rather than rebuilt.
- **A crash resumes the same child.** The child group loop is created and its id stored in the checkpoint in one commit. A resumed process waits for that id instead of starting a second group loop.
- **A blocked group blocks the change** at level `change`, with the group's escalation.
- **A group that ends `exhausted` or `failed` ends the change `failed`.** Later groups don't run.

A converged group is entered in `groups` and the loop returns to `next`.

#### `changeChecks`

The change check runs once, after the last group converges. `changeChecks` defaults to `checks`. Set it to a broader end-of-change set, such as `pnpm spec:check`, `pnpm docs:check` and `pnpm pack:check`, that would be too slow to run after every task. The commands run in order in the workspace, as argv with no shell, like `checks`. They are recorded as one `Iteration` targeting `{ check: "change" }`, with one `check` evidence per command. If every command exits 0, the change converges. Any other exit code ends it `failed`. No judge sees the failure yet.

#### Answering

`answerChangeEscalation(harness, id, answer, context)` answers a blocked change loop and returns the id of a new run:

- It is accepted only when the loop ended `blocked`, and only when `answer.by` is the escalation's `to`. Otherwise it rejects with `EscalationAnswerError` and changes nothing.
- It starts a new change run that keeps the entries already recorded, so the blocked group's `runs` goes on counting.
- It hands the answer to `answerGroupEscalation` for the blocked group, waits for that group's new run, and then continues with the remaining groups and the change check.

#### Notes

- **No budget of its own.** The limits come from each group's `maxReworks` and each task's `maxIterations`, both set in `budget`.
- **Don't put a `pnpm spec:archive` task in `tasks.md`.** The change check would then validate a change that has already been archived.

### Worktrees

```bash
agentscript-task run add-shout-flag 1.1 --worktree --db .agentscript/1.1.sqlite
```

The task runs in `<worktreeDir>/<change-id>-<task-id>` (default `../<repo>-worktrees/…`) on a new branch `task/<change-id>/<task-id>`, created from `HEAD`; a group uses `<change-id>-<group>` and `task/<change-id>/<group>`. The main tree is untouched, so you can keep working and run several tasks at once, each with its own `--db`, which is mandatory here. The change must be committed first, because the worktree starts from `HEAD`. `worktreeSetup` commands run inside it before the loop. The tick lands in the worktree's `tasks.md`. The runner never reuses, removes or merges a worktree: when it ends it prints `worktree:`, `branch:`, `review: git -C <path> diff` and `remove: git worktree remove <path>`, and the rest is yours.

### Status, resume, answer

```bash
agentscript-task status                      # every loop in the database, newest first
agentscript-task resume 7                    # finish a loop whose process died
agentscript-task resume --all                # finish every interrupted loop in the database
agentscript-task answer 7 --by principal --decision "Yes, upper-case the name too."
```

`status` reads storage and runs nothing, so it works while another process holds the database. Its lines look like `loop 98  add-shout-flag  1.2  converged  1 iteration`; a group is listed as `group 1`, its iterations are check rounds, and a worktree loop adds its branch. `resume` re-attaches to a loop from the database alone (workspace, checks, allowlist and worktree are stored with it), so a crash mid-iteration resumes the same run rather than starting another. `answer` works on a loop that ended `blocked`, from the escalation's recipient (`--by` must match, or it exits 2 with `the escalation of task loop 7 goes to the principal, not the agent`).

An answer never reopens the blocked loop: it starts a *new* run of the same task, seeded with your decision as its carried feedback. For a task loop the iteration numbers carry on from the blocked run and the budget is fresh. For a group loop the blocked task is rerun first, then the rest of the group, then the check. Because the run stores what it read at start, **an answer does not pick up edits to the spec or `tasks.md`**. After an `amend-spec` block, fix the spec, commit, and start a new `run`.

#### What `status` shows

A loop's status is one of six: `running`, `interrupted`, `converged`, `blocked`, `exhausted` or `failed`. `interrupted` means the loop has no outcome yet but no live process is working it: its driver died, the session ended, or the machine rebooted. Here two drivers were working when the machine rebooted:

```console
$ pnpm task status
loop 14  add-plan-export  1.3  interrupted  2 iterations
loop 13  add-plan-export  group 1  interrupted  1 iteration
loop 12  add-plan-schema  2.1  blocked  3 iterations
loop 11  add-resume-hint  group 2  interrupted  0 iterations
loop 10  add-resume-hint  2.2  interrupted  1 iteration
loop 9  add-resume-hint  2.1  converged  2 iterations
```

Task loop `14` runs inside group loop `13`, and task loop `10` inside group loop `11`. Loop `12` is waiting for an answer, so it stays `blocked`. Loop `9` has ended, so it stays `converged`.

How a loop is told apart from a running one:

- **Every loop records its owner.** `run`, `resume`, `answer` and `resume --all` write a `loop_owner` row (`loop_id`, `pid`, `boot_at`) in the same database for each loop they start or resume. `boot_at` is the machine's boot time, rounded to the second. A nested loop gets its parent's owner.
- **The owner must be the live lock holder.** A loop with no outcome that is not blocked is `interrupted` unless `<db>.lock` names its owner's pid, that pid is alive, and the owner's `boot_at` is within 2 s of the current boot time. The boot time catches a reboot even when the pid has been reused.
- **Older loops are judged by the lock alone.** A loop started before owners were recorded has no `loop_owner` row. It is `interrupted` only when no live process holds the lock; otherwise it shows as `running`.
- **Blocked and ended loops keep their status.** `blocked`, `converged`, `exhausted` and `failed` are never shown as `interrupted`.

`status` decides this without taking the lock, so it still works while another process runs.

#### Resuming every interrupted loop: `resume --all`

```
agentscript-task resume <loop-id>|--all [--db <path>] [--json]
```

`resume --all` takes `<db>.lock` once, then resumes every `interrupted` loop in the database:

- **Through its root.** An interrupted loop is resumed through its root: the outermost loop above it that is still running (task → group → change), or the loop itself if its parent has ended. Each root resumes exactly once, and its nested loops carry on inside it rather than on their own.
- **In start order.** Roots run one at a time, ordered by when they started, with the loop id as tie-break. Loop-id order is not used. A root takes ownership only when its turn comes, so `status` from another shell shows the roots still waiting as `interrupted`.
- **As `resume <loop-id>` would.** Each root uses its recorded worktree, and its progress goes to stderr as JSON Lines events, the same as `resume <loop-id>`.

Stdout gets one line per root: `loop <id> <change> <task|group n|spec stage>[ (via <ids>)] — <status>`. `(via …)` names the nested interrupted loops the root carried on. A `blocked` line ends with `: ` and the `answer` command to run; a `refused` line ends with `: ` and the reason. `converged`, `exhausted` and `failed` stand alone. For the listing above:

```console
$ pnpm task resume --all
loop 11 add-resume-hint group 2 (via 10) — converged
loop 13 add-plan-export group 1 (via 14) — blocked: agentscript-task answer 13 --db .agentscript/task-loops.sqlite --by principal --decision "…"
$ echo $?
1
```

Group loop `11` resumes before `13` because it started first. Loops `10` and `14` get no line of their own.

A refused root does not stop the batch. If loop `11`'s worktree had been removed, its line would read `loop 11 add-resume-hint group 2 (via 10) — refused: worktree <path> does not exist`, and loop `13` would still be resumed.

With nothing to resume:

```console
$ pnpm task resume --all
no interrupted loops in .agentscript/task-loops.sqlite
$ echo $?
0
```

| Exit | Meaning |
|---|---|
| `0` | Every root converged or is a spec loop blocked for review, or there was nothing to resume |
| `1` | Some root ended blocked (other than a spec loop waiting for review), exhausted or failed, or was refused |
| `2` | Refused before any loop resumed: see below |

Each refusal exits `2` and resumes nothing:

- **A loop id with `--all`** (`resume 12 --all`) prints usage.
- **`--all --json`** prints `--json is not supported with --all`, then usage. `--json` applies to `resume <loop-id>` only.
- **Another live process holds `<db>.lock`.** You get the usual lock message, naming its pid: `the database is in use by process <pid> (<db>.lock); wait for it to finish, or use another --db`.

> **One database per call.** `--all` covers only the database given by `--db`, else the config's `db`. Worktree-mode runs each have their own `--db`, so run `pnpm task resume --all --db <path>` once for each database. Nothing searches for databases across directories or restarts loops on its own: no daemon, scheduler or watcher. If you want that, build it in the repository that integrates the loop.

### Output and exit codes

Progress is JSON Lines on **stderr**, after the resume hint. The outcome is on **stdout**: text by default, or with `--json` the loop id merged with the outcome (`{ "loop": 7, "status": …, "iterations": […], … }`). The runner is headless: it never reads stdin and never prompts.

```text
# loop 7 — converged
## iteration 1: unmet
not yet
## iteration 2: met
ticked: true
changed (uncommitted): src/a.ts
```

A group prints `# group loop <id> — <status>`, one `## task <id>: <status> (runs n)` per task and `## group check: passed|failed`. A blocked loop prints `escalation to:` and `question:` (a group: `to:` and `question:`), then the exact `agentscript-task answer …` command to run. `changed (uncommitted)` lists what the loop changed, leaving out `tasks.md` and the database files.

| Exit | Meaning |
|---|---|
| `0` | The loop converged (or `--next` found nothing to do) |
| `1` | It ended blocked, exhausted or failed; or a worktree `setup` command failed |
| `2` | Usage error or a refused start: bad flag or config, unknown change, task, group or model, dirty tree, `--worktree` without `--db`, a script that is refused, a locked database, an answer that is not accepted |

`SIGINT` exits 130 and `SIGTERM` 143, releasing the database lock; `resume` picks the loop up.

### The event stream

One JSON object per stderr line, each with `event` and `loop`. A task loop's events, in order:

| `event` | Fields besides `loop` | When |
|---|---|---|
| `loop-started` | `change`, `task`, `script` (`task`, `task-delegate` or `custom`), `at` | The loop begins |
| `iteration-started` | `iteration`, `at` | An iteration begins |
| `action` | `iteration`, `kind` (`edit`, `command`, `delegate`), `summary`, `refs` | An action ran. With the delegate script: one `delegate`, one `command` for the checks |
| `evidence` | `iteration`, `kind`, plus the evidence's fields | Evidence an action recorded. `check`: `command`, `exitCode`, `output`. `diff`: `files` (`path`, `change`) |
| `verdict` | `iteration`, `met`, `unmet`, `next` (`done`, `retry`, `ask`, `amend-spec`) | The iteration was judged. A gate failure is `met: false` with the gate's reason |
| `loop-ended` | `status`, `iterations`, `ticked`, `changed` | The loop settled. `changed` is measured from the loop's start, across `resume` and `answer`: a resumed run lists edits made before the crash, and an answered run the blocked run's. A group's task lists only its own files |
| `warning` | `message` | A condition at start: not in git (guard skipped), a stale lock taken over, uncommitted changes left in the main tree in worktree mode. Emitted for task runs, `resume` and `answer`; not for the start of a group run |

A group loop adds four, and its child task loops' events carry `group: <n>` and their own `loop` ids (the group's `loop` is the id in the resume hint):

| `event` | Fields besides `loop` | When |
|---|---|---|
| `group-started` | `change`, `group`, `tasks`, `at` | The group begins |
| `group-check` | `commands` (`command`, `exitCode`), `passed` | A check round ran |
| `rework` | `task`, `reason` | The judge reopened a task |
| `group-ended` | `status`, `tasks` (`task`, `status`, `runs`), `changed` | The group settled |

Skip the hint line when parsing: `tail -n +2 run.jsonl | jq -c 'select(.event == "verdict")'`.

## Tune the agent

Every iteration runs one Agent Script. Copy a bundled script, edit it, and point at it with `--script <path>` (or `"script"` in the config). It is refused at start, before any model call, unless it keeps the **task-script contract**: these variables, declared with exactly these types. The loop always seeds the first seven before each iteration, seeds `changed` and `delete_granted` (whether `delete_file` is granted) only into a script that declares them, and reads the last four back after it.

```
variables:
    task_id: mutable string = ""
        description: "seeded: the task's id, e.g. 2.4"
    task_text: mutable string = ""
        description: "seeded: the task's text from tasks.md"
    proposal: mutable string = ""
        description: "seeded: the change's proposal.md"
    design: mutable string = ""
        description: "seeded: the change's design.md, or empty"
    deltas: mutable string = ""
        description: "seeded: every spec delta, concatenated"
    iteration: mutable number = 1
        description: "seeded: which iteration this is"
    carried: mutable string = ""
        description: "seeded: feedback from earlier iterations or an escalation answer"
    changed: mutable string = ""
        description: "seeded if declared: files changed since the loop started, one per line; (unknown) when the workspace cannot snapshot"
    met: mutable boolean = False
        description: "read back: the judge's verdict"
    unmet: mutable string = ""
        description: "read back: what is still unmet"
    next_action: mutable string = "retry"
        description: "read back: retry, amend-spec or ask"
    question: mutable string = ""
        description: "read back: the question to escalate"
```

Everything else is yours: the bundled scripts add `plan`, `checks_passed`, `check_output` (and `act_ok`, `act_summary` for the delegate). Also:

- `next_action` must be a string whose default is one of `retry`, `amend-spec`, `ask`.
- Every `subagent` runs each iteration, in source order. The bundled four are `orient`, `act`, `check`, `judge`.
- The only actions a script can bind are the host's built-ins, with exactly these names and types: `read_file`, `edit_file`, `run_command`, `run_checks` and `delegate_claude_code` (see [04 Actions](04-actions.md)). `run_checks` fails with `no checks configured, and an empty set of checks is not a pass` when you set none.
- A script that uses a construct outside the supported subset is refused by name and position ([01 Writing Agent Script](01-agent-script.md)).

A common edit is letting the judge see the deltas, which the bundled judge does not. In `judge`, after the `Task …` line:

```text
subagent judge:
    ...
        instructions: ->
            | Task {!@variables.task_id}: {!@variables.task_text}
            | Spec deltas:                  (added)
            | {!@variables.deltas}          (added)
            | Plan: {!@variables.plan}
            ...
```

Other edits that pay for themselves: a line in `system.instructions` stating a repo rule ("tests live next to the code"), a sharper `orient` ("list the scenarios this task must satisfy"), or a different `act`. The group judge works the same way with its own contract (`group_number`, `group_title`, `tasks`, `proposal`, `deltas`, `check_output`, `rework_count` seeded; `next_action` default `rework`, `rework_task`, `feedback`, `question` read back) and `--group-script`.

`changed` is taken when the iteration begins, so the judge of iteration *n* sees what iterations 1 to *n*-1 changed, kept across `resume` and answers. It leaves out the change's `tasks.md` and the runner's database. The bundled judges show it beside the delegate's per-iteration count, so an iteration that finds the work already done is not read as "nothing was done".

### Make passing checks sufficient

The bundled judge decides whether a task is done, and passing checks are necessary, not sufficient. A host whose checks are the task (scenario-scoped tests, a CI test picker) can make them sufficient with a logic-only subagent after `judge`:

```
subagent accept:
    description: "Passing checks are enough, without the model"

    reasoning:
        instructions: ->
            if @variables.checks_passed:
                set @variables.met = True
```

This makes the configured checks the whole definition of done. The loop's gate still runs them again before converging. Don't do it with the bundled checks: `pnpm check` and `pnpm test` are repo-wide and would pass for a task whose tests were never written. The bundled scripts keep the judge.

## Use the library from code

`@specsesh/agent/task` exposes what the CLI is built from. The harness runs the loops of one workspace, check list and allowlist, so install the extensions once and pass the same values to `startTaskLoop`.

```ts
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import {
	BUNDLED_SCRIPTS,
	answerEscalation,
	startTaskLoop,
	taskLoopExtensions,
	waitForTaskLoop,
} from "@specsesh/agent/task";

const context = BACKGROUND_CONTEXT;
const workspace = process.cwd();
const checks = ["pnpm check", "pnpm test"];
const allow = ["pnpm", "node"];

const models = createModels();
models.setProvider(claudeCodeProvider());
const registry = createRegistry();
for (const extension of taskLoopExtensions({ workspace, checks, allow, delegateModel: "opus" })) {
	registry.install(extension);
}
const harness = await Harness.open(await openNodeSqliteStorage(".agentscript/loops.sqlite"), { models, registry }, context);

const id = await startTaskLoop(
	harness,
	{
		change: { dir: "openspec/changes/add-shout-flag" },
		task: "1.1",
		script: { path: fileURLToPath(BUNDLED_SCRIPTS.delegate) },
		workspace,
		checks,
		allow,
		budget: { maxIterations: 8 },
		model: { provider: "claude-code", modelId: "opus" },
		delegateModel: "opus",
	},
	context,
);
harness.resume();
let outcome = await waitForTaskLoop(harness, id, context);

if (outcome.status === "blocked") {
	const { escalation } = outcome;
	const next = await answerEscalation(
		harness,
		id,
		{ escalation, by: escalation.to, decision: "Yes, upper-case the name too.", feedback: [] },
		context,
	);
	harness.resume();
	outcome = await waitForTaskLoop(harness, next, context);
}
await harness.close(context);
console.log(outcome.status, outcome.iterations.length);
```

Leave `script` out and the bundled `task.agent` runs, which needs a provider that can call tools. `startTaskLoop` refuses before creating anything or calling a model (a `TaskLoopStartError`, an `ActionBindingError` from `@specsesh/agent/durable`, or a script error such as `UnsupportedConstructError`); `waitForTaskLoop` returns the checked `LoopOutcome<TaskOutcome>` (`waitForTaskLoopResult` also returns the `notes`). `answerEscalation` rejects with `EscalationAnswerError` unless the loop ended blocked and the answer comes from the escalation's recipient. For a change given as text, `change` takes `{ proposal, design?, deltas, tasks }`, each a `{ text }` or `{ path }`; nothing is ticked unless `tasks` is a `{ path }`.

Groups mirror it:

```ts
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { BUNDLED_SCRIPTS, startGroupLoop, waitForGroupLoop } from "@specsesh/agent/task";
import type { Harness } from "@earendil-works/pi-durable";
import type { GroupOutcome, LoopOutcome } from "@specsesh/agent/openspec";

// Install groupLoopExtensions(...) in place of taskLoopExtensions(...), then:
export async function runGroup(harness: Harness, dir: string, workspace: string): Promise<LoopOutcome<GroupOutcome>> {
	const id = await startGroupLoop(
		harness,
		{
			change: { dir },
			group: 1,
			script: { path: fileURLToPath(BUNDLED_SCRIPTS.delegate) },
			workspace,
			checks: ["pnpm check", "pnpm test"],
			allow: ["pnpm", "node"],
			budget: { maxIterations: 8, maxReworks: 2 },
			model: { provider: "claude-code", modelId: "opus" },
		},
		BACKGROUND_CONTEXT,
	);
	harness.resume();
	return waitForGroupLoop(harness, id, BACKGROUND_CONTEXT);
}
```

`answerGroupEscalation` answers a blocked group. The JSON Lines stream is a CLI feature; from code you read the outcome, whose `iterations` carry each plan, action, evidence and verdict.

## What it never does

- **It never commits, stashes, checks out or removes anything.** The only git commands it can run are `status`, `rev-parse`, `worktree add` and `worktree list`; anything else throws before spawning. You review the diff and commit.
- **It never edits specs, and writes only one thing outside the workspace's source files: the tick.** The loop itself writes `tasks.md` (ticking a converged task, unticking one a group reworks) and its database. The scripts tell the agent never to edit the spec or tick boxes. That is an instruction, not a sandbox: file actions are confined to the workspace and commands to your allowlist, so watch `changed` in `loop-ended`.
- **It never deploys or reaches for the network by itself.** It runs your checks and the commands whose first word you allowed. Do not allow `git`, `curl` or a deploy tool.

## Walkthrough: a small change, end to end

The repository is a small TypeScript CLI with `pnpm check` and `pnpm test`, the config above (minus the worktree setup), `.agentscript/` ignored, and a `CLAUDE.md` of repo rules. The output below is abridged from a run of this tool; the model's wording in the verdicts is illustrative.

**1. Propose.** Create the change and write it.

```bash
openspec new change add-shout-flag
```

`openspec/changes/add-shout-flag/proposal.md` holds a *Why* (people want shouted greetings) and *What Changes* (`greet --shout` upper-cases the greeting). `specs/cli/spec.md` holds one ADDED requirement with a scenario:

```markdown
## ADDED Requirements

### Requirement: greet can shout
`greet --shout` SHALL print the greeting in upper case.

#### Scenario: Shouting
- **WHEN** `greet Ada --shout` runs
- **THEN** it SHALL print `HELLO, ADA!`
```

**2. Write the tasks.** The `tasks.md` shown earlier: group 1 is the flag (1.1 code, 1.2 test), group 2 is the docs (2.1). Validate and commit, because the loop refuses a dirty tree:

```bash
openspec validate add-shout-flag --strict
git add -A && git commit -m "spec: add-shout-flag"
```

**3. Run group 1.**

```bash
agentscript-task run add-shout-flag 1 2> run.jsonl
```

Stdout:

```text
# group loop 7 — blocked
## task 1.1: converged (runs 1)
## task 1.2: blocked (runs 1)
to: principal
question: Should --shout also upper-case the name?
agentscript-task answer 7 --db /path/to/repo/.agentscript/task-loops.sqlite --by principal --decision "…"
```

Exit code 1. Task 1.1 took two iterations; task 1.2's judge decided it could not settle the question from the checks.

**4. Read the stream.**

```bash
tail -n +2 run.jsonl | jq -c 'select(.event == "verdict" or .event == "loop-ended" or .event == "group-ended")'
```

```text
{"event":"verdict","loop":8,"iteration":1,"met":false,"unmet":"the flag is not wired","next":"retry","group":1}
{"event":"verdict","loop":8,"iteration":2,"met":true,"unmet":"","next":"done","group":1}
{"event":"loop-ended","loop":8,"status":"converged","iterations":2,"ticked":true,"changed":["src/greet.ts"],"group":1}
{"event":"verdict","loop":67,"iteration":1,"met":false,"unmet":"two readings of the scenario","next":"ask","group":1}
{"event":"loop-ended","loop":67,"status":"blocked","iterations":1,"ticked":false,"changed":["__tests__/greet.test.ts"],"group":1}
{"event":"group-ended","loop":7,"status":"blocked","tasks":[{"task":"1.1","status":"converged","runs":1},{"task":"1.2","status":"blocked","runs":1}],"changed":["src/greet.ts","__tests__/greet.test.ts"]}
```

The tree now has uncommitted work from task 1.1 (and `tasks.md` ticked `1.1`). The loop converged only after its own gate ran `pnpm check` and `pnpm test`.

**5. Answer.**

```bash
agentscript-task answer 7 --by principal --decision "Yes, upper-case the name too."
```

The blocked task reruns first, with your decision as its carried feedback, then the group check runs:

```text
# group loop 97 — converged
## task 1.1: converged (runs 1)
## task 1.2: converged (runs 2)
## group check: passed
```

The answer started a new group loop (97), and the counts carried over from the blocked one: `1.1` ran once, `1.2` twice (the blocked run and the rerun).

**6. Review and commit.** The loop never commits.

```bash
git diff
git add -A && git commit -m "feat(cli): add --shout"
agentscript-task run add-shout-flag --next-group    # group 2: the docs
git add -A && git commit -m "docs: document --shout"
```

**7. Archive.** `openspec validate add-shout-flag --strict`, then `openspec archive add-shout-flag --yes` folds the delta into `openspec/specs/cli/spec.md` and moves the change under `openspec/changes/archive/`. OpenSpec 1.14.1 archives a change that fails validation with exit 0 and drops requirements, so this repository wraps it: `pnpm spec:archive <id>` (`scripts/spec-archive.mjs`) validates the change strictly, folds it into a throwaway copy of `openspec/`, validates that result strictly, and only then archives for real. Copy that script if you want the same guard.

## Next

- [08 Troubleshooting](08-troubleshooting.md): refused scripts, a dirty tree, a locked database, a loop that exhausts or blocks, delegate timeouts.
- [06 The OpenSpec ontology](06-openspec.md): the types behind `LoopOutcome`, `Iteration` and `Escalation`.
- [04 Actions](04-actions.md): the built-in actions a task script binds.
- [01 Writing Agent Script](01-agent-script.md) and [02 Running a script](02-running-scripts.md): the language the loop runs.
- [03 Durable agents on Node](03-durable-agents.md): pi-durable, resume and the database.
- [05 Agents on Cloudflare](05-cloudflare.md)
- Planned, not built: granting delegates in config and a runtime-neutral agent harness; see the [roadmap](../packages/agent/README.md#roadmap).
