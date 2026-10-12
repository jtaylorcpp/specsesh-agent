# Troubleshooting

After this guide you can read a refusal or a failed loop from `agentscript-task`, find its cause, and fix it. Entries are grouped by when the problem shows up: a run refused before it starts (exit 2), a loop that ends badly (exit 1), the Claude Code subscription path, and how to look inside a loop. Messages are quoted as the code prints them; paths and numbers vary.

## Prerequisites

- You have read [07 Executing changes with the task loop](07-task-loop.md), or at least know the commands: `run`, `status`, `resume`, `answer`.
- Exit codes: `0` converged, `1` blocked, exhausted or failed, `2` a refusal or usage error (nothing ran, or nothing was accepted).

## Refused before anything runs (exit 2)

A refusal creates no loop and calls no model. The message is on stderr.

### The script is refused

Scripts are checked in full at start: parsed, linted, scanned against the supported subset, checked against the task-script contract and bound to the host's actions.

**Unsupported construct.**

```text
this runtime does not implement 1 construct(s) used by the document:
  - TransitionStatement at 127:13, in subagent "extra", is unsupported by this runtime. It may well be valid Agent Script — @specsesh/agent implements an enumerated subset and does not execute this construct. Supported: config, system.instructions, variables, …
```

The runtime executes a declared subset of Agent Script; anything else is refused, by name and position, rather than skipped. The message ends with the supported list. Rewrite the construct with supported ones: [01 Writing Agent Script](01-agent-script.md).

**The document has errors.**

```text
the document has 1 error(s) and was not run. Nothing was dispatched:
  - 'plna' is not defined in variables at 109:23
```

The parser recovers from syntax errors, so a typo (an unterminated string, a misspelled variable) still yields a tree; the runtime refuses to run what the recovery invented. Go to the line and column. A reference to a variable that no `variables:` block declares is reported this way, or as `the document references @variables.x at …, but declares no such variable.`

**Contract broken.**

```text
the script breaks the task-script contract, so the loop was not started:
  - met is not declared; declare it as boolean
  - iteration is declared string; the contract needs number
  - @variables.next_action defaults to "stop", which is not one of "retry", "amend-spec", "ask"
```

Your script must declare the seven seeded and four read-back variables with exactly those types, and `next_action` must default to one of its three values. The full list is in [07, Tune the agent](07-task-loop.md#tune-the-agent). A group judge script has its own contract and a message that begins `the group script breaks the group-judge contract`; its `next_action` must default to `rework`, `ask` or `amend-spec`.

**An action that does not match the host.** `ActionBindingError`:

```text
the script's actions do not match what this host provides, so the run was not started:
  - subagent "check", action run_checks: mcpTool://run_tests is not registered on this host
```

A script can bind only the built-ins `read_file`, `edit_file`, `run_command`, `run_checks` and `delegate_claude_code`, with exactly their input and output names and types. Other mismatches read `input x is not one the host action has`, `input x is declared string, registered number` and `output y of the host action is not declared`. See [04 Actions](04-actions.md).

### The change, task or group is not found

```text
no change "nope" in /repo/openspec/changes; open changes: add-shout-flag
task 9.9 is not in /repo/openspec/changes/add-shout-flag/tasks.md; the tasks it holds are 1.1, 1.2, 2.1
no group 7 in /repo/openspec/changes/add-shout-flag/tasks.md; groups: 1, 2
group 3 has no tasks
```

Each lists what exists. A bare integer is a group (`2`), `n.m` is a task (`2.1`); a group heading must look like `## 2. Title`, and a task line like `- [ ] 2.1 text` at column 0. A word that is neither (`abc`) reads as a task id and is refused with `"abc" is not a task id; task ids look like 2.4`. A change needs `proposal.md`, `tasks.md` and at least one `specs/<capability>/spec.md`; a missing file is reported as `<path> does not exist; the loop was not started`, and a missing delta as `…/specs/<capability>/spec.md does not exist: the change has no delta; the loop was not started`.

### Usage and config errors

```text
give exactly one of a task id, a group number, --next or --next-group
--max-iterations must be a positive integer, got "0"
run needs --db <path>, or a db in agentscript.config.json
no model "gpt-9" on provider "claude-code"
```

Each prints the usage text after it. The printed usage omits `--max-reworks` and `--group-script`, but both exist. For a config file:

```text
/repo/agentscript.config.json: unknown key "task.check" (known: changesDir, db, provider, model, delegateModel, script, groupScript, checks, allow, maxIterations, maxReworks, escalateTo, delegateContext, requireCleanTree, worktree, worktreeDir, worktreeSetup)
/repo/agentscript.config.json: "task.allow" must be an array of strings, got "pnpm"
/repo/agentscript.config.json: not valid JSON (…)
the script nope.agent does not exist (looked for /repo/nope.agent)
```

The config is strict on purpose: a misspelled key is an error, never a silent default. `--script` paths are relative to where you run the command, `"script"` paths to the config file.

### Dirty tree refused

```text
the working tree has 2 uncommitted changes; commit or stash them, or pass --allow-dirty:
   M openspec/changes/add-shout-flag/tasks.md
   M src/a.ts
```

The guard keeps every edit after the run the loop's, so `changed` in `loop-ended` is meaningful. Because a converged loop edits files *and* ticks `tasks.md`, the next run will see a dirty tree: **review and commit between runs**. Lists longer than 20 paths are cut with `… and N more`. `--allow-dirty` overrides it for one run (or `requireCleanTree: false` for all). If the list includes `.agentscript/…`, add `.agentscript/` to `.gitignore`. In worktree mode the main tree may be dirty; the worktree starts clean from `HEAD`. Outside a git repository the guard is skipped, with a `warning` event.

### Worktree refused

```text
worktree mode needs --db <path>: each worktree run names its own database, and the config's db is not used
the branch task/add-shout-flag/2.1 already exists; run never reuses a task branch
the worktree path /…/repo-worktrees/add-shout-flag-2.1 already exists; run never reuses or clobbers one
the change /repo/openspec/changes/add-shout-flag is not committed at HEAD, and the worktree starts from HEAD; commit it first
worktree mode needs a git repository, and /… is not inside one
worktree setup failed: "pnpm install" exited 1 in /…/repo-worktrees/…; the worktree is left for inspection
```

Give each worktree run its own `--db`. A branch or directory from an earlier run is never reused: after reviewing it, `git worktree remove <path>` and `git branch -D <branch>`. Commit the change before you use `--worktree`. A failing setup command exits 1 and leaves the worktree where it is.

### The database is locked

```text
the database is in use by process 3569444 (/repo/.agentscript/task-loops.sqlite.lock); wait for it to finish, or use another --db
```

One live process holds a database at a time. Wait for it, or give a parallel run its own `--db` (the usual pattern with `--worktree`). A lock whose process died is taken over automatically, with a `warning` event: `took over a stale lock on <db> left by process N, which is no longer running`. `status` ignores the lock. If you are sure nothing is running and the holder's pid has been reused, delete `<db>.lock`.

## A loop that ends badly (exit 1)

Read the stdout summary first: each iteration's `unmet` reason is printed, and a failed or blocked loop prints a `note:` or the question.

### Exhausted: the budget ran out

```text
# loop 157 — exhausted
## iteration 1: unmet
the judge said met, but the checks failed: pnpm check exited 1, pnpm test exited 1
```

The loop used all `maxIterations` (default 8) without the checks passing. Look at the last iterations before you spend more:

- If the reasons change each time and the code is moving toward green, raise the budget: `--max-iterations 16`. A new run of the same task gets a fresh budget; ticked tasks are skipped in a group.
- If the same failure repeats, more iterations will not help. Read the failing check output (the `evidence` events, below), then either fix the cause yourself (a flaky test, a missing dependency, a check that needs credentials the sandbox lacks) or **split the task**: a task that must satisfy many scenarios, or that cannot go green until a later task lands, will not converge. See [Shape tasks so the checks can go green](07-task-loop.md#shape-tasks-so-the-checks-can-go-green).
- `the judge said met, but the checks failed` means the gate overruled the judge: the agent believed it was done, and your checks disagreed. The checks win.

A group whose task exhausted ends `failed` (the task shows `exhausted` in `## task <id>: exhausted (runs n)`). A group that used up `maxReworks` ends `exhausted`. Raise `--max-reworks`, or reopen the task you think is at fault and run it alone.

### Blocked: it is waiting for you

```text
# loop 66 — blocked
## iteration 1: unmet
two ways
escalation to: principal
question: Should --shout also upper-case the name?
agentscript-task answer 66 --db /repo/.agentscript/task-loops.sqlite --by principal --decision "…"
```

The judge chose `ask` (a decision no check can settle) or `amend-spec` (the deltas contradict each other or the code). Run the printed command with your decision. Know what an answer does and does not do:

- It starts a new run of the task with your decision as its carried feedback; the blocked loop stays as it was.
- It does **not** reread the spec or `tasks.md`; the loop keeps the text it read at start. For `amend-spec`, edit the delta, commit, and start a new `run` instead.
- `--by` must be the escalation's recipient (`principal` unless you set `escalateTo`):

```text
the escalation of task loop 66 goes to the principal, not the agent
loop 7 has not ended blocked, so it has no escalation to answer
loop 7 ended exhausted, not blocked, so it has no escalation to answer
no loop 9999 in /repo/.agentscript/task-loops.sqlite
```

If `ask` fires on questions your checks could settle, tighten the script's judge (see [07, Tune the agent](07-task-loop.md#tune-the-agent)); the bundled judges already say retry is the default.

### Failed: a step could not complete

A `failed` loop ends on the first iteration that hits an error it cannot retry. The reason is the iteration's `unmet` text and a `note:` line, always shaped `the run ended failed: <category>: <message>`.

**`next_action` outside its values.**

```text
the run ended failed: unknown: the step's result was refused 3 times; last: The result was not recorded: "next_action" must be one of "retry", "amend-spec", "ask", got "retry. both questions can be settled". Call again.
```

The judge must answer `next_action` with exactly one word and put explanations in `unmet`. The loop offers only those values, so the model's answer is refused up to three times, then the step fails. The bundled scripts already say so; a custom judge prompt that invites prose into `next_action` produces this. A custom script that sets `next_action` from logic can still end up outside the three; the loop then fails with `the script broke the task-script contract: next_action is "x", not one of "retry", "amend-spec", "ask"`. For a group judge the values are `rework`, `ask` and `amend-spec`, and a `rework_task` that is not a task of the group fails the group (`# group loop N — failed`).

**`task.agent` with the `claude-code` provider.**

```text
the run ended failed: unknown: the step was not answered: model_error ("the claude-code provider runs at most one pi tool per request; this one offered 3 (read, edit, shell)")
```

`task.agent` gives the model three tools in its `act` step, and the `claude-code` provider serves at most one. Use `--script task-delegate` with `claude-code`, or switch to a provider that can call tools.

**Provider errors.** A rate limit, an invalid model, a network failure: the provider's message follows `the step was not answered: model_error (…)`. The loop does not retry a failed step; run `agentscript-task resume <id>` once the cause is gone, or start a new run.

### Delegate and action failures

A failed *action* is different from a failed step. It does not end the loop: the iteration is recorded unmet with the action's message carried into the next one, and it costs one iteration. If the last iteration fails this way, the loop ends `exhausted`. The messages:

| Message | Cause and fix |
|---|---|
| `Claude Code timed out after 600000ms` | The delegate ran for 10 minutes and was killed. Make the task smaller, or fix what makes the work slow. The limit is not configurable from the CLI. |
| `Claude Code could not start: …` | The `claude` binary is not on `PATH` for the runner. |
| `delegate context file /repo/CLAUDE.md does not exist; Claude Code was not started` | A `delegateContext` entry points at a missing file. Paths are relative to the config file. |
| `pnpm is not on the allowlist (allowed: node); nothing was run` | `task.agent`'s `run_command` refused a command whose first word is not in `allow`. Add the word, or leave it out on purpose. |
| `<command> timed out after 600000ms` | A command run by `run_command` ran too long. |
| `src/x.ts is outside the workspace; nothing was read or written` | A path was absolute, escaped with `..`, or resolved through a symlink out of `--workspace`. |
| `no checks configured, and an empty set of checks is not a pass` | The script's `run_checks` ran with no `checks`. Configure at least one. |

The delegate's own Bash is limited to your `allow` words and runs with `--permission-mode dontAsk`, so a command outside the list is denied rather than prompted. If the delegate keeps failing to run your checks, check that the check's first word (`pnpm`) is in `allow`.

### Converged, but `ticked: false`

```text
# loop 338 — converged
## iteration 1: met
ticked: false
note: task 1.1 is already ticked in /repo/openspec/changes/add-shout-flag/tasks.md; nothing was written
```

The task converged but the loop did not write the box. The `note:` says why: the task was already ticked, `tasks.md` changed meanwhile and the line is gone, the file cannot be read, or `tasks.md` was given to the library as text. The loop never ticks in doubt.

## Claude Code authentication

`--provider claude-code` runs your own `claude` binary, logged in as you. If it fails to start or is not logged in, the loop fails on its first step:

```text
the run ended failed: unknown: the step was not answered: model_error ("could not start claude: spawn claude ENOENT. Is Claude Code installed and on PATH?")
the run ended failed: unknown: the step was not answered: model_error ("claude exited 1 without a JSON result: <what claude printed>")
```

- **Not installed or not on `PATH`**: install Claude Code, and check `which claude` in the same shell and environment (a cron job or CI step has a different `PATH`).
- **Not logged in**: run `claude` interactively once and sign in with your subscription (`/login`). The runner uses that login. It never reads Claude Code's OAuth token or passes it to anything, and it removes `ANTHROPIC_API_KEY` from the `claude` child's environment so a metered API key is not used by accident. If you want API billing, use `--provider anthropic` instead, with the key in your environment.
- **Running inside a Claude Code session**: the runner clears `CLAUDECODE` from the child's environment, so a nested run is not refused.
- **Your global `CLAUDE.md` is not read**: steps run with `--safe-mode`. Give the delegate repo guidance with `delegateContext`.

## Look inside a loop

**`status`** lists every loop in a database, newest first, without running anything:

```text
loop 98  add-shout-flag  1.2  converged  1 iteration
loop 97  add-shout-flag  group 1  converged  1 iteration
loop 67  add-shout-flag  1.2  blocked  1 iteration
```

**The event stream** is the live view. Redirect stderr to a file and filter it (the first line is the resume hint, not JSON):

```bash
agentscript-task run add-shout-flag 1.1 2> run.jsonl
tail -n +2 run.jsonl | jq -c 'select(.event == "verdict") | {iteration, met, unmet, next}'
tail -n +2 run.jsonl | jq -r 'select(.event == "evidence" and .kind == "check" and .exitCode != 0) | "$ \(.command) (exit \(.exitCode))\n\(.output)"'
```

`verdict` says why each iteration was unmet, `evidence` carries each check's command, exit code and output, and `action` shows what the agent did. `loop-ended.changed` lists the files the loop touched. All event kinds are in [07, The event stream](07-task-loop.md#the-event-stream).

**A finished loop, in full.** `resume` on a loop that already ended prints its recorded outcome; with `--json` that is every iteration's plan, actions, evidence, verdict and feedback:

```bash
agentscript-task resume 128 --json 2> /dev/null | jq '.iterations[-1].verdict'
```

It replays the events on stderr and exits with the loop's code. **The diff**: `git diff` (or `git -C <worktree> diff`) is the final authority on what the agent changed; the loop never commits.

**A crashed run.** If the process died (`kill`, a closed laptop), `agentscript-task resume <id>` finishes the same loop. It re-reads nothing from the repository: the workspace, checks, allowlist and worktree are stored with the loop. An interrupted check or command is not re-run blindly: a command action that was in flight is marked failed (`<action> was interrupted and not re-run`) and the iteration retries.

## Next

- [07 Executing changes with the task loop](07-task-loop.md): configuration and how to write tasks.
- [06 The OpenSpec ontology](06-openspec.md): what `Iteration`, `Verdict` and `Escalation` contain.
- [04 Actions](04-actions.md): allowlists, the workspace boundary and replay policy.
- [03 Durable agents on Node](03-durable-agents.md): resume, the database and the lock.
- [02 Running a script](02-running-scripts.md) and [01 Writing Agent Script](01-agent-script.md): the runner and the language.
- [05 Agents on Cloudflare](05-cloudflare.md)
