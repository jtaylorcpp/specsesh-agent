## Why

`specsesh llm` prints everything at once: the whole workflow, every rule and every command's detail. An agent loads all of it into context before its first command, whether it needs `change` or only `agent check`. Context is a budget, so the guide should be a map that gets the agent to the right command, and each command should explain itself in depth only when asked. Today only `specsesh agent help` answers at all. `change`, `task` and `durable` reject `help` with exit 2, and `specsesh task help` is taken as a change named `help`.

## What Changes

- `specsesh llm` becomes a short map, at most 60 lines. It covers what specsesh is, which command fits which job, the rules that must always be in context (only the principal approves, it never commits, the exit codes) and the top-level usage. It points at `specsesh <command> help` for the rest.
- `specsesh <change|task|durable|agent> help`, `--help` or `-h` prints that command's full usage, then an in-depth page from `docs/llm/<command>.md`, to stdout with exit 0. The detail moves there from the guide.
- The starter skill tells the model to read the map, then run `specsesh <command> help` before it first uses a command.
- The four command pages ship and are required by the build.

## Out of scope

- Help for a single subcommand (`specsesh task answer help`).
- Changing any command's behaviour other than its help.

## Capabilities

- **Modified:** `package/llm`.

## Impact

- `packages/agent/src/cli/index.ts` (help routing before `task`'s implied `run`), `src/cli/llm.ts` (renders a command page).
- The `change`, `task` and `durable` bins export their `USAGE`.
- `packages/agent/docs/llm/{guide,change,task,agent,durable}.md`, `templates/SKILL.md`, `scripts/check-assets.mjs`.
- Tests in `__tests__/cli/llm.test.ts`.
