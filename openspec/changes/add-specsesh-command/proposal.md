## Why

The harness is four bins (`agentscript-pi`, `agentscript-durable`, `agentscript-task`, `agentscript-change`) that only this repository runs, through `pnpm agent|durable|task|change`. To publish it as a CLI on public npm, it needs one command, `specsesh`, that any repository can run as `npx specsesh change build <change>`. This change adds that command as a library entry of `@specsesh/agent`; the package that puts it on PATH and the release follow (slices.md).

## What Changes

- New entry `@specsesh/agent/cli` (`src/cli/index.ts`) exporting `main(argv, deps)` and `USAGE`. Importing it runs nothing.
- `specsesh agent|durable|task|change …` routes in-process to the main of `agentscript-pi`, `agentscript-durable`, `agentscript-task` and `agentscript-change`, passing the remaining arguments and returning their exit code.
- `specsesh task <change> <task-id>` implies `run`, as `pnpm task` does today.
- `specsesh`, `--help`, `-h`, `help` print the usage; `--version` and `-v` print `specsesh <version>` from the package manifest.
- `agentscript-pi.ts` exports its `main`, as the other three bins already do.
- The exports map gains `./cli`, a tenth entry, last.

## Out of scope

- The package that installs a `specsesh` bin, and its README (`add-specsesh-package`).
- Publishing, versioning and the release workflow (`add-npm-release-workflow`).
- Renaming `agentscript-*` and `pnpm …` in the sub-CLIs' usage and next-command lines (`name-specsesh-in-change-output`, `name-specsesh-in-task-output`).
- Removing or renaming the four `agentscript-*` bins: they stay for 0.x.
- Moving to `@specsesh/ontology` (`use-published-ontology`).

## Capabilities

- **New:** `package/command`.
- **Modified:** `package/distribution`.

## Impact

- `packages/agent/src/cli/index.ts` (new), `packages/agent/src/bin/agentscript-pi.ts` (exports `main`), `packages/agent/package.json` (`./cli` export).
- Tests: `__tests__/cli/specsesh.test.ts` (new), `__tests__/package/manifest.test.ts`, `__tests__/package/pack.test.ts` (which imports every Node entry, now `./cli` too).
- `CLAUDE.md` names ten exports and the `./cli` entry.
