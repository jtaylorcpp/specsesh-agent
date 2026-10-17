## Why

`specsesh task` (`add-specsesh-command`) runs `agentscript-task` in process, but its usage, its resume hints and the answer commands of a blocked loop name `agentscript-task …`, and the spec loop's next steps name `pnpm task …`, which exists only in this repository. Before the first publish, the task CLI should name the command `npx specsesh` users have, as `name-specsesh-in-change-output` does for the change CLI.

## What Changes

- The usage lists `specsesh task run|spec|resume|answer|status …`, from both `specsesh task` and the `agentscript-task` bin.
- Every resume hint becomes `loop <id> — resume with: specsesh task resume <id> --db <path>`.
- The answer command of a blocked task, group or spec loop, in text output and in `resume --all`, becomes `specsesh task answer <loop> …`.
- The spec loop's next-step lines (approve, revise, answer, next stage, `--next-group`, later slices) name `specsesh task`.
- The root `task` script becomes `node packages/specsesh/bin/specsesh.js task`, and `scripts/task.mjs`, whose `run` rule `specsesh task` now carries, is deleted.
- The `agentscript-task` bin stays, with the same arguments, exit codes and output.

## Out of scope

- The change CLI's wording (`name-specsesh-in-change-output`).
- The guides, READMEs and `CLAUDE.md`, which keep `pnpm task` for this repository.
- JSON Lines events and `--json` output, which name no command.
- Removing or renaming the `agentscript-task` bin.

## Capabilities

- **Modified:**
  - `task/cli`;
  - `task/headless`.

## Impact

- `packages/agent/src/bin/agentscript-task.ts` (usage, resume hints, answer lines), `packages/agent/src/task/spec-cli.ts` (next steps, resume hint), `packages/agent/src/task/resume-all.ts` (answer line), root `package.json` (`task` script); `scripts/task.mjs` deleted.
- Tests under `packages/agent/__tests__/task/` that assert these lines; `__tests__/task/cli-specsesh.test.ts` (new); `__tests__/repo/config.test.ts`.
