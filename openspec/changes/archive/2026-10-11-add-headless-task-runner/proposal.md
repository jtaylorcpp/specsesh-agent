## Why

`add-task-agent` gives the task loop a CLI. Using it on this repo today would still mean passing a change-directory path, a database, checks and an allowlist on every run, and an Anthropic API key, because the CLI defaults to the API. Nothing would show progress during a long unattended run, and the Claude Code delegate (the subscription path) would stall: in `-p` mode with tools allowed, each edit or command waits for a permission prompt that no one can answer.

The outcome this change is for: **the moment it merges, `pnpm task <change-id> <task-id>` works the next task in this repo, unattended, on the principal's Claude subscription**, with no flags.

## What Changes

- **Repo configuration.** A root `agentscript.config.json` with a `task` section holds every default the CLI otherwise takes as flags:
  - where changes live, the database path, the script;
  - provider and models, check commands, the command allowlist;
  - the budget, the escalation recipient;
  - extra context files for the delegate, and the clean-tree guard.

  Flags still override it. This repo ships its own config:
  - the claude-code provider with `task-delegate.agent`;
  - checks `pnpm check` and `pnpm test`;
  - an allowlist of `pnpm` and `node`;
  - the database at `.agentscript/task-loops.sqlite` (gitignored);
  - `CLAUDE.md` as delegate context.
- **Changes by id, and the next task.** `agentscript-task run <change-id> <task-id>` resolves the change under the configured changes directory. `--next` picks the first unticked task. A path still works.
- **Headless by construction:**
  - **No prompts:** the CLI never prompts, and needs no terminal.
  - **Progress as JSON Lines:** it writes progress to stderr, one event per line (`loop-started`, `iteration-started`, `action`, `evidence`, `verdict`, `loop-ended`), so a run can be watched or logged.
  - **Result on stdout:** the final outcome goes to stdout, as text or `--json`.
  - **Escalation as output:** a blocked loop exits `1` and prints the escalation, with the exact `answer` command to resume it.
- **A delegate that can't stall.** `delegate_claude_code` runs `claude -p --safe-mode` with:
  - `--tools Read,Edit,Write,Glob,Grep,Bash`;
  - `--permission-mode dontAsk`;
  - `--allowedTools` built from the allowlist (`Bash(pnpm:*)`, …).

  Anything not pre-allowed is denied, never prompted. The configured context files reach it through `--append-system-prompt-file`, so it knows the repo's conventions without `--safe-mode` being lifted. A separate `delegateModel` lets orient and judge run on Haiku while the delegate runs on a stronger model.
- **A clean-tree guard.** By default `run` refuses to start when the git working tree has uncommitted changes, naming them, so every edit after it is the loop's. `--allow-dirty` overrides. The runner never commits; it prints the files the loop changed.
- **Worktree mode.** With `--worktree` (or `worktree: true` in the config), `run` creates a git worktree for the task on branch `task/<change-id>/<task-id>`, from `HEAD`, runs the configured setup commands there (this repo: `pnpm install --frozen-lockfile --prefer-offline`), and runs the loop inside it.
  - **The main tree stays untouched,** so the clean-tree guard does not apply to it; you can keep working while a task runs.
  - **Uncommitted main-tree changes are not carried over.** A warning says how many there are.
  - **`--db` is mandatory in worktree mode,** and the config's `db` is not used, so each worktree run names its own database.
  - **That makes parallel tasks safe:** several worktree runs on different tasks, each with its own database, run at once. A database is locked to one live process; a second process using it is refused.
  - **The loop records the worktree's path and branch,** and `resume` and `status` use them.
  - **The work is left for review.** The runner never commits; it prints the worktree path, its branch, and the commands to review and remove it.
- **Status.** `agentscript-task status [--db]` lists loops with their change, task, status and iteration count.
- **Root script** `pnpm task …`, and a section in `CLAUDE.md` on using it.
- **Proof it works here.** An opt-in `pnpm test:live` runs the CLI headless on a copy of this repo, against a small fixture change, on the subscription. It converges and ticks the task. This is the only test that makes a real model call, and it is not part of the default gate.

## Out of scope

- Committing, branching or opening pull requests for the loop's work.
- Running several tasks or a whole group unattended (the group loop).
- Answering escalations anywhere but the CLI.

## Capabilities

- **New:** `task/headless` (repo config, id resolution, `--next`, JSON Lines events, the clean-tree guard, worktree mode, `status`, this repo's config, the live acceptance run).
- **Modified:**
  - `task/cli` (config-driven defaults, positional change id, `status`, the event stream on stderr);
  - `actions/registry` (`delegate_claude_code` runs headless: tools, `dontAsk`, the allowlist, context files, `delegateModel`);
  - `task/agent` (`TaskLoopOptions` and `taskLoopExtensions` carry `delegateModel`, `delegateContext` and the recorded `worktree`).

## Impact

- Depends on `add-task-agent` (and through it `add-agentscript-actions` and `add-openspec-ontology`). Its MODIFIED deltas apply after those archive.
- New root files: `agentscript.config.json`, and `.agentscript/` added to `.gitignore`.
