# Running locally

On Node, from the `specsesh` command or the library: one-shot runs, durable runs on SQLite that resume after a crash, and the OpenSpec task and change loops.

## Setup

Node 22.19.0 or newer. For the command line, install `specsesh`, which brings pi-ai, pi-durable and chord with it:

```bash
npm install -g specsesh        # or without installing: npx specsesh --help
specsesh agent check examples/agents/01-hello.agent
```

For the library, install `@specsesh/agent` plus the optional peers of the layers you use: `@earendil-works/pi-ai` for `./pi` and `./claude-code`, and `@earendil-works/pi-durable` and `@earendil-works/chord` as well for `./durable`, `./node`, `./task` and `./cli`. `@specsesh/agent` installed alone gives `agentscript-*` bins that fail on import.

The provider and model come from `--provider` and `--model`, or from `AGENTSCRIPT_PROVIDER` and `AGENTSCRIPT_MODEL`. The task and change loops also read `agentscript.config.json` at the repository root; a flag overrides a `task` value there, never a delegate grant.

## Providers

Three of the four providers run locally (see the [matrix](../providers/README.md)):

- [API-key providers](../providers/api-keys.md): pi-ai's built-ins, on their environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...).
- [claude-code](../providers/claude-code.md): your own `claude` binary on your subscription.
- [ollama](../providers/ollama.md): a local Ollama server, keyless.

[workers-ai](../providers/workers-ai.md) needs a Worker's `AI` binding, so `--provider workers-ai` is refused on Node. `specsesh agent models <provider>` lists a provider's models.

## Running and resuming

A one-shot run keeps its state in memory: a killed process loses the run.

```bash
specsesh agent run examples/agents/01-hello.agent --provider anthropic --model claude-haiku-4-5 --var name=Ada
```

Without `--entry` a run starts at the first subagent only; list every subagent to run, in order, with `--entry`.

A durable run checkpoints every step in a SQLite database. Its task id is printed at start; a run whose process died resumes on the model it started on and never repeats a finished step:

```bash
specsesh durable run examples/agents/01-hello.agent --db runs.sqlite --provider claude-code --model claude-haiku-4-5
specsesh durable resume <task-id> --db runs.sqlite
```

The task loop works one task (`2.1`), a group (`2`), `--next` or `--next-group` of an OpenSpec change until its checks pass, it blocks, or its budget runs out. Its `--db` is a flag or `task.db` in the config:

```bash
specsesh task add-thing 2.1 --db .agentscript/task-loops.sqlite
specsesh task status --db .agentscript/task-loops.sqlite
specsesh task resume <loop-id> --db .agentscript/task-loops.sqlite
specsesh task answer <loop-id> --by principal --decision "…" --db .agentscript/task-loops.sqlite
```

`run` refuses uncommitted changes unless `--allow-dirty`. `--worktree` runs the loop in `../<repo>-worktrees/<change-id>-<task-id>` on branch `task/<change-id>/<task-id>`, from `HEAD`, so the main tree stays untouched and several loops can run at once, each with its own `--db`.

The change loop drafts, approves, builds and closes a whole change: `specsesh change draft|approve|build|close <change>`. `specsesh change help` and `specsesh task help` give every flag.

## Limits

- [claude-code](../providers/claude-code.md) serves at most one tool per step, and none under `specsesh agent run`: a step that offers actions as tools needs an API-key provider, or a delegate (`task-delegate`).
- Small [Ollama](../providers/ollama.md) models may answer a structured step in text instead of the forced `submit_result` call, which fails the step.
- One live process per database: a second is refused, naming the holder's pid.
- specsesh never commits. Review the diff and commit it yourself; only the principal approves a stage or answers a review.
