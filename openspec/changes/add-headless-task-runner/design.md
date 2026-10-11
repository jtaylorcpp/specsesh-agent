## Context

Goal: use the task agent on this repo the day this merges, without an API key, without flags, without anyone at the keyboard. Checked on 2026-10-11 against the installed `claude` CLI:
- `--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` and `plan`.
- `--allowedTools` takes patterns.
- `--tools` takes the built-in tool names.

## Configuration

`agentscript.config.json` at the repo root, found by walking up from the current directory:

```json
{
  "task": {
    "changesDir": "openspec/changes",
    "db": ".agentscript/task-loops.sqlite",
    "provider": "claude-code",
    "model": "claude-haiku-4-5",
    "delegateModel": "sonnet",
    "script": "task-delegate",
    "checks": ["pnpm check", "pnpm test"],
    "allow": ["pnpm", "node"],
    "maxIterations": 3,
    "escalateTo": "principal",
    "delegateContext": ["CLAUDE.md"],
    "requireCleanTree": true
  }
}
```

- **Every field is optional.** A missing field falls back to the `add-task-agent` CLI default.
- **Precedence is flag → environment → config → default**, field by field. The environment covers `AGENTSCRIPT_PROVIDER` and `AGENTSCRIPT_MODEL`.
- **`script` names a bundled script** (`task`, `task-delegate`) or a path to a `.agent` file.
- **Paths are relative to the config file's directory.**
- **An unknown key or a wrongly typed value refuses the run**, naming the key. A typo must not silently fall back to a default.

## Resolving the work

- **`run <change>` takes an id or a path.** A value containing a path separator, or naming an existing directory, is a path. Otherwise it is an id under `changesDir`, and an unknown id lists the open changes.
- **`--next` replaces the task id** with the first `- [ ]` task in `tasks.md`, in file order. A change with none exits `0`, printing `no unticked task in <change>`.

## Headless output

```
stderr  {"event":"loop-started","loop":7,"change":"…","task":"2.4","script":"task-delegate","at":"…"}
        {"event":"iteration-started","loop":7,"iteration":1,"at":"…"}
        {"event":"action","loop":7,"iteration":1,"kind":"delegate","summary":"…","refs":["…"]}
        {"event":"evidence","loop":7,"iteration":1,"kind":"check","command":"pnpm test","exitCode":1}
        {"event":"verdict","loop":7,"iteration":1,"met":false,"unmet":"…","next":"retry"}
        {"event":"loop-ended","loop":7,"status":"converged","iterations":2,"ticked":true,"changed":["src/…"]}
stdout  the outcome (text, or --json)
```

- **One JSON object per line.** Events carry the ontology's own field names. The `add-task-agent` resume hint stays the first stderr line, printed as is.
- **`changed`** lists the files whose git status changed during the loop, from `git status --porcelain` before and after.
- **When a loop is blocked,** the text outcome ends with the escalation and the exact resume command: `agentscript-task answer <loop> --by <to> --decision "…"`.

## The delegate, headless

```
claude -p --safe-mode --model <delegateModel> --output-format json --no-session-persistence
       --tools Read,Edit,Write,Glob,Grep,Bash --permission-mode dontAsk
       --allowedTools Read Edit Write Glob Grep "Bash(pnpm:*)" "Bash(node:*)"
       --append-system-prompt-file <each delegateContext file>
       cwd = workspace; ANTHROPIC_API_KEY and CLAUDECODE stripped; never --bare; never the OAuth token
```

- **`dontAsk` denies rather than prompts.** A denied tool use comes back to Claude Code as a denial, so the session carries on within the allowlist. It never hangs.
- **The `Bash(...)` patterns come from the same allowlist** `run_command` uses. One list governs both paths.
- **`--safe-mode` stays.** Repo conventions arrive through `--append-system-prompt-file`, which adds the repo's `CLAUDE.md` without loading the principal's global configuration.

## Clean tree

- **Before creating the loop,** `run` runs `git status --porcelain` in the workspace. Non-empty output refuses the run (exit `2`), listing up to 20 paths, unless `--allow-dirty` is set or `requireCleanTree` is `false`.
- **Outside a git repository** the guard is skipped, and a warning event is emitted.
- **Ignored files don't count.** The database lives in a gitignored directory, so the guard doesn't trip on its own state.

## Worktree mode

```
agentscript-task run <change-id> <task-id> --worktree
  1. path   = <worktreeDir>/<change-id>-<task-id>   (worktreeDir default: ../<repo-dir-name>-worktrees)
     branch = task/<change-id>/<task-id>
  2. refuse (exit 2) if the branch or the path already exists, naming it: a worktree is never reused or clobbered by `run`
  3. refuse (exit 2) if the change is not committed at HEAD: the worktree starts from HEAD and would not contain it
  4. git worktree add -b <branch> <path> HEAD
  5. run each worktreeSetup command in <path>; a non-zero exit ends the run as failed (exit 1), naming the command, and leaves the worktree for inspection
  6. run the loop with workspace = <path> and the change resolved inside <path>, so ticking lands in the worktree
  7. print the path and branch, `git -C <path> diff`, and `git worktree remove <path>`
```

- **The clean-tree guard checks the worktree, not the main tree.** It is clean by construction. Main-tree uncommitted changes produce a `warning` event with their count, because they are absent from the worktree.
- **The database is the main repo's** (paths resolve from the config file). The loop's record holds `worktree: { path, branch }`; `resume` runs in that path and `status` shows it.
- **One process per database at a time.** Parallel tasks in separate worktrees each need their own `--db` in this change; concurrent writers to one SQLite database are not supported yet.
- **Git commands the runner may run:** `status`, `rev-parse`, `worktree add` and `worktree list`. It still never commits, adds, stashes, checks out or removes anything.

Config: `worktree` (boolean, default `false`), `worktreeDir` (string), `worktreeSetup` (string array, default `[]`). This repo's config sets `worktreeSetup: ["pnpm install --frozen-lockfile --offline"]`; `worktree` stays `false` by default and is turned on per run with `--worktree`.

## Acceptance: `pnpm test:live`

1. Copy the repo to a temp directory, `git init` it and commit.
2. Add a fixture change, `fixture-live-task`, with one small task: replace a stale comment named in the task with given text. The checks are a vitest file that asserts the new text.
3. Run `agentscript-task run fixture-live-task 1.1`, using the repo config.
4. Expect exit `0`, a `loop-ended` event with `status: "converged"`, the task ticked in the fixture's `tasks.md`, and only the target file in `changed`.
5. Repeat with `--worktree`: the main copy's HEAD and files are unchanged, and the work and tick are in the worktree on `task/fixture-live-task/1.1`.

It needs `claude` logged in. Without it, the test skips and says why. It is never part of `pnpm test`.

## Risks

- **A broad allowlist entry like `pnpm` still lets the delegate run any pnpm script.** The clean tree and the "never commits" rule mean every effect is reviewable and revertable with git.
- **Model-quality variance:** a live run can fail on a bad day. The live test uses the smallest possible task, and is opt-in for that reason.
