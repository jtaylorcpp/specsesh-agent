# specsesh task: run one task or group, and manage loops

`specsesh task` works below `change build`: one task, one group, or one loop at a time. It reads defaults from `agentscript.config.json` (provider, model, checks, allowlist, delegates, `db`); flags override them, never a delegate grant.

## Run

- `specsesh task <change> <task-id>` runs one task, such as `2.1`. A bare integer such as `2` runs that group's unticked tasks in order, then the group check.
- `--next` picks the first unticked task and `--next-group` the first group with one. With nothing left, it prints `no unticked task in …`.
- **How a task converges.** It iterates: plan, act, check, judge. A `met` verdict converges only when every configured check passes. Otherwise the failing output goes into the next iteration, up to `--max-iterations` (default 8). The task is then ticked in `tasks.md`.
- **The judge's next action** is `retry`, `amend-spec` (the spec deltas are wrong; the loop blocks with a proposed amendment) or `ask` (a decision for the principal).
- **Clean tree.** A run refuses uncommitted changes, listing them; `--allow-dirty` overrides.
- **`--worktree`** runs in `../<repo>-worktrees/<change>-<task>` on branch `task/<change>/<task>`, from `HEAD` (commit the change first). `--db <path>` is then required. Review there with `git -C <path> diff`.
- **Delegates.** A script may hand work to a delegate (for example Claude Code) only under a grant in the config. `--no-delegates` withdraws every grant for one run.

## Manage loops

- `specsesh task status` lists loops: id, change, task or `group <n>`, status, iterations.
- `specsesh task resume <loop-id>` finishes a loop whose process died; `--all` resumes every unfinished one. Use the same `--db`.
- `specsesh task answer <loop-id> --by principal --principal <name> --decision "<text>"` answers a blocked loop and starts a new run of it. A blocked loop prints this exact command. Use the principal's words; `--by agent` answers questions escalated to an agent.
- `specsesh task spec <change> [<stage>]` runs the spec loop for one stage. Prefer `specsesh change draft`, which runs the stages in order.
- `specsesh task pick-tests --input <file.json>` picks the tests that cover one closed task, for CI.

## Local model (Ollama)

- **One run.** `specsesh task <change> <task-id> --provider ollama --model qwen3:8b` puts the judge on a model you pulled. The server is `OLLAMA_HOST` (default `http://127.0.0.1:11434`); no key is needed.
- **In the config.** `"provider": "ollama"` makes the judge local. A `models` entry on `ollama` gives an `agent` delegate a local model:

  ```json
  {
    "task": { "provider": "ollama", "model": "qwen3:8b", "script": "task", "checks": ["pnpm test"], "allow": ["pnpm"] },
    "models": { "local": { "provider": "ollama", "model": "qwen3:8b" } },
    "delegates": { "editor": { "runner": "agent", "model": "local", "script": "edit",
      "tools": ["read_file", "list_files", "search_files", "edit_file", "run_command"] } }
  }
  ```

  A script calls it with `run @actions.<x>` (target `mcpTool://delegate/editor`) and `instructions`. `tools` must cover the script's actions: the bundled `edit` uses `edit_file` and `run_command` beyond the default three.

- **Fully local.** Pair the local judge with the bundled `task` script, or with an `agent` delegate on a local model. A `claude_code` grant (runner `claude-code`) always runs on Claude Code, whatever the provider.
- **When the server is contacted.** Only when the run's model, a stored loop's model (`resume`, `answer`) or a `models` entry is on `ollama`. `resume` and `answer` finish a loop on the model it was started on.
- **Refusals.** An `ollama` model that doesn't resolve exits `2` before a task exists: `no model "<model>" on provider "ollama"`, ending with ` (Ollama at <url>: <reason>)` when the server didn't answer.
- **Small models** may fail structured steps, such as the judge's `submit_result`. That is the model's limit, not the loop's.
- In this repo, `pnpm test:ollama` runs a durable run and a one-task loop on a pulled model, and skips when no server answers.

## Output

- **stdout:** the outcome, `# loop <id> — <status>` and one line per iteration. With `--json`, the outcome is JSON.
- **stderr:** first a line naming the loop and how to resume it, then progress as JSON Lines: `loop-started`, `iteration-started`, `action`, `evidence`, `verdict`, `warning`, `loop-ended` (its `changed` lists the files the loop changed). Group runs add `group-started`, `group-check`, `rework` and `group-ended`.
- **One process per database.** A second one is refused, naming the holder's pid.
- **It never commits.** It runs only `git status`, `rev-parse`, `worktree add` and `worktree list`.

## Exit codes

`0` converged; `1` blocked, exhausted or failed; `2` usage or a refused start (bad config, unknown change or task, dirty tree, locked database).
