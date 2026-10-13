## Why

Once a change is drafted, `pnpm change draft` points at `pnpm task <change> --next-group`, one group at a time. The principal wants the third verb: `pnpm change build <change>` executes the whole change, with agents managing each chunk of tasks, and stops only when one of them needs a decision. `add-build-loop` gives the loop. This change gives the verb.

## What Changes

- **`pnpm change build <change> [<answer>]`.**
  - With nothing waiting, it starts a change loop and waits for it. It takes the same flags as a group run (`--check`, `--allow`, `--max-iterations`, `--escalate-to`, `--provider`, `--model`, …) plus `--change-check <command>`, which can be repeated.
  - A dirty tree is refused unless `--allow-dirty`, as with `pnpm task`. So are the loop's guard refusals: an invalid change, or an approved file edited since.
  - On a build waiting for an answer, the answer goes to the agent that asked, and the build continues. Without an answer, `build` shows the question again.
  - A change that is already built says so and starts nothing.
- **Build output**: one line per group, with its status, task count and reworks, then the change check and any scenario no task names. It ends with the next command:
  - `pnpm change build <change> "<answer>"` when blocked;
  - `pnpm spec:archive <change>` when built, until `add-change-close`.
- **A drafted change points at `pnpm change build <change>`.**
- **Exit codes:** `0` built, `1` waiting for an answer, exhausted or failed, `2` on usage or a refusal.

## Out of scope

- `build --worktree`, and `changeChecks` in the config. Both are parked.
- Events for change loops.

## Capabilities

- **Modified:** `change/cli`.

## Impact

- New: `packages/agent/src/task/cmd-build.ts`. Updated: `change-state.ts`, `change-output.ts`, `src/bin/agentscript-change.ts`, `guides/07-task-loop.md`.
- Depends on `add-change-approve` and `add-build-loop`, archived first.
