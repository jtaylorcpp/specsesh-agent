# Example agents

Six Agent Script files, one idea each. The [language tour](../../guides/00-language-tour.md) builds
up the same constructs step by step, and `specsesh agent language <topic>` has the full rules.

| File | Shows |
|---|---|
| [`01-hello.agent`](01-hello.agent) | A prompt that uses a variable. |
| [`02-structured-output.agent`](02-structured-output.agent) | `@outputs` into a string, a number and a boolean, then a prompt that uses them. |
| [`03-branching.agent`](03-branching.agent) | `if` and `else` on a variable, in code, with no model request. |
| [`04-run-action.agent`](04-run-action.agent) | `run` of the built-in `read_file`, from the program, with no model. |
| [`05-model-tools.agent`](05-model-tools.agent) | `reasoning.actions`: `run_command` and `read_file` offered to the model as tools. |
| [`06-custom-task-agent.agent`](06-custom-task-agent.agent) | A trimmed task agent for `specsesh task`, keeping the task-script contract. |

## Check and run

Every example checks clean, with no model:

```bash
specsesh agent check examples/agents/01-hello.agent
```

`01` to `03` run with `specsesh agent run`, on pi's `anthropic/claude-haiku-4-5` by default (it
needs `ANTHROPIC_API_KEY`), or on your Claude subscription with `--provider claude-code`. A run
starts with the first subagent only, so name every subagent of `02` with `--entry`:

```bash
specsesh agent run examples/agents/01-hello.agent --var name=Ada
specsesh agent run examples/agents/02-structured-output.agent --entry estimate --entry advise
specsesh agent run examples/agents/03-branching.agent --var severity=high
```

## Examples that need a host

`04`, `05` and `06` call actions, and `specsesh agent run` has no action host. It refuses a `run`
statement before anything runs, and fails a step that offers tools. A host provides the actions:

- `04` and `05`: `builtinActions` from `@specsesh/agent/node` with `runScript` from
  `@specsesh/agent/durable`, as [Host actions](../../guides/04-actions.md) shows. Pass
  `entry: ["load", "summarise"]` for `04`, and `allow: ["git"]` to `builtinActions` for `05`, whose
  `files` tool runs `git ls-files`. `specsesh agent actions` lists the built-ins with their inputs
  and outputs, which each declaration matches.
- `06`: the task loop, which seeds the contract's variables, runs every subagent in order and reads
  the verdict back. Use it for one run (the path is relative to the current directory):

  ```bash
  specsesh task <change> <task-id> --script examples/agents/06-custom-task-agent.agent
  ```

  or for every run, in `agentscript.config.json` (the path is relative to that file):

  ```json
  { "task": { "script": "examples/agents/06-custom-task-agent.agent" } }
  ```

## Write your own

`specsesh agent new <name>` writes a commented starter script, and `specsesh agent language` lists
the reference topics.
