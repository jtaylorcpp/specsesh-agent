## Why

`specsesh change` (`add-specsesh-command`) runs `agentscript-change` in process, but every line that tells the user what to run next still says `pnpm change …`, which exists only in this repository, and the usage and resume hints say `agentscript-change …`, a bin `npx specsesh` users never see. Before the first publish, the change CLI should name the command its users have.

## What Changes

- The usage lists `specsesh change draft|approve|build|close …`, from both `specsesh change` and the `agentscript-change` bin.
- Every next-command line of `draft`, `approve` and `build` (revise, approve, answer, build, amend, close, retry and the slice `draft … --intent` lines) names `specsesh change`.
- Refusals that name a command (approve is not feedback, a question cannot be approved, the stale-approval refusal, `close`'s unfinished-build refusals) name `specsesh change`.
- The resume hints become `draft loop <n> — resume with: specsesh change draft <change> --db <path>` and `change loop <n> — resume with: specsesh change build <change> --db <path>`.
- The root `change` script becomes `node packages/specsesh/bin/specsesh.js change`.
- The `agentscript-change` bin stays, with the same arguments, exit codes and output.

## Out of scope

- The task CLI's wording (`name-specsesh-in-task-output`).
- The guides, READMEs and `CLAUDE.md`, which keep `pnpm change` for this repository.
- Removing or renaming the `agentscript-change` bin.

## Capabilities

- **Modified:** `change/cli`.

## Impact

- `packages/agent/src/bin/agentscript-change.ts` (usage, resume hints), `packages/agent/src/task/change-output.ts` (next-command lines), `cmd-draft.ts`, `cmd-approve.ts`, `cmd-close.ts` (refusals), root `package.json` (`change` script).
- Tests under `packages/agent/__tests__/change/` and `__tests__/task/` that assert these lines; `__tests__/change/cli-specsesh.test.ts` (new); `__tests__/repo/config.test.ts`.
