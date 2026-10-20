## 1. Command help

- [x] 1.1 Export `USAGE` from `agentscript-change`, `agentscript-task` and `agentscript-durable`. In `src/cli/index.ts`, answer `help`, `--help` and `-h` as the only argument of `change`, `task`, `durable` and `agent` before routing (before `task`'s implied `run`), through a `runCommandHelp` in `src/cli/llm.ts` that prints the usage (durable's as `specsesh durable`), a blank line and `docs/llm/<command>.md`. Tests in `__tests__/cli/llm.test.ts`: "Scenario: Each command explains itself", "Scenario: --help and -h say the same", "Scenario: task help is not a change", "Scenario: agent help still lists every subcommand", "Scenario: durable help names specsesh"

## 2. The map and the pages

- [x] 2.1 Rewrite `docs/llm/guide.md` as a map of at most 60 lines; move the detail into `docs/llm/change.md`, `task.md`, `agent.md` and `durable.md`; update `templates/SKILL.md`; require all of them in `scripts/check-assets.mjs`. Update the tests "Scenario: The guide covers the workflow and its rules" (now: a map of at most 60 lines naming each command's help), "Scenario: The skill points at the guide", "Scenario: Both are packed" and "Scenario: The build requires them". README names `specsesh <command> help`. Run `pnpm check`, `pnpm test`, `pnpm spec:check`, `pnpm docs:check`

The change ends with `pnpm change close add-command-help`.
