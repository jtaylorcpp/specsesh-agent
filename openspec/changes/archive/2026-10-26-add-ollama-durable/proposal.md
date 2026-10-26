## Why

`add-ollama-provider` lets `agentscript-pi` run a script on a local model, but only once and in process. The runs that matter, a crash-safe durable run and an unattended task loop, still need an API key or a Claude subscription, because `agentscript-durable` and `agentscript-task` each build their model collection as pi-ai's built-ins plus `claude-code`, and only those resolve. A task loop should be able to run start to finish on a local model, judge and delegate included, and resume on that model after a crash.

## What Changes

- `agentscript-durable` and `agentscript-task` (every subcommand that opens a harness: `run`, groups, `resume`, `answer`, spec loops, `pick-tests`) build their collection from one shared function: pi-ai's built-ins, `claude-code`, then `ollama` through `registerOllama`.
- The Ollama server is contacted only when a model the command needs is on `ollama`: the chosen provider, a stored run's model on `resume` or `answer`, or a `models` entry in `agentscript.config.json`. No other command makes a network call to it.
- `resume` and `answer` refresh `ollama` before checking the stored model, so a run started on a local model finishes on it after a crash.
- An `ollama` model that doesn't resolve is refused as today (`no model "<model>" on provider "ollama"`, exit `2`, before a task exists), with ` (Ollama at <url>: <reason>)` added when the server didn't answer.
- In `agentscript.config.json`, `"provider": "ollama"` makes the judge local, and a `models` entry on `ollama` gives an `agent` delegate a local model. A fully local task loop pairs them with the bundled `task` script or an `agent` delegate; the `claude_code` grant stays on Claude Code.
- `docs/llm/durable.md` and `docs/llm/task.md` gain a local-model example; an opt-in `pnpm test:ollama` (never in `pnpm test`) runs a durable run with a `kill -9` mid-step and a one-task loop on a pulled model, and skips when no server answers.

## Out of scope

- Making the `claude-code` runner or `claude_code` grant use Ollama: that delegate is Claude Code by definition.
- Cloudflare (`defineAgentHost`, `AgentScriptHost`): a Worker can't reach a local server.
- Changing this repo's own `agentscript.config.json`, which stays on Claude Code.
- Tuning the bundled scripts for small models. Live results go in the design; prompt changes are their own change.

## Capabilities

- **Modified:**
  - `durable/cli`;
  - `task/cli`.

## Impact

- One shared model-collection builder replacing the copies in `src/bin/agentscript-durable.ts` and `src/bin/agentscript-task.ts` (and its `io.models`), deciding when to refresh `ollama`.
- `src/task/config.ts` (`ollama` entries in `models`) and `src/task/spec-cli.ts` (the same collection).
- Tests in `__tests__/durable/` and `__tests__/task/` against the fake Ollama server from `add-ollama-provider`; crash/resume on node SQLite against it.
- `scripts/test-ollama.mjs` and a root `test:ollama` script; `docs/llm/{durable,task}.md`; README's provider list.
- Depends on `add-ollama-provider`, which must be built and closed first.
