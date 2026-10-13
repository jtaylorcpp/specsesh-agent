## Why

After `add-spec-proposal-stage` the spec loop works from the library, but a user can't run it. The guided flow belongs in the CLI the task loops already use: one command to draft a stage, the same `answer` to approve or revise, and the same `status` to see where each change stands. After every review, the output should tell the user exactly what to type next.

## What Changes

- **`agentscript-task spec <change> [<stage>] [--intent <words> | --intent-file <path>]`.**
  - With no stage, it runs the first stage in `SPEC_STAGES` order that has no current approval. Only `proposal` exists until the stage changes add theirs.
  - A new change needs an intent. It creates `openspec/changes/<change>/` and writes the words to `intent.md`, which is the principal's record and is seeded into every stage.
  - It never checks that the tree is clean, since it writes only inside the change, and it refuses `--worktree`.
- **`answer` routes to `answerSpecLoop`** for a spec loop, with `--principal <name>`, defaulting to `git config user.name`, then `$USER`.
- **`status` lists spec loops** as `spec <stage>`.
- **Exit codes:** `0` when a spec loop ends waiting for review or approved, and `1` when it ends on a question, exhausted or failed.
- **Text output** ends with the next step:
  - after a review, the files to read and both commands, approve and revise;
  - after an approval, the next stage's command, or, once every stage is approved, `pnpm task <change> --next-group`.

## Out of scope

- JSON Lines events for spec loops and the live run: `add-spec-cli-events`.
- Running a stage in a worktree.

## Capabilities

- **Modified:** `task/cli`, and `task/headless` so the runner may read `git config user.name` (read only) for `--principal`.

## Impact

- New: `packages/agent/src/task/spec-cli.ts`. Updated: `src/bin/agentscript-task.ts`, `src/task/status.ts`, the package README's CLI section.
- Depends on `add-spec-proposal-stage`, archived first.
