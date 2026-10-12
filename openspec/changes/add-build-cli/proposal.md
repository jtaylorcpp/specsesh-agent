## Why

`add-build-loop` builds a whole change from the library: every group in order, each with its own task loops and judge agent. The principal wants a command for it, so the flow from an idea to working code is two commands: `draft` writes the change, and `build` executes it, stopping only when an agent needs a decision.

## What Changes

- **`agentscript-task build <change>`** starts a change loop and waits for it.
  - It takes the same flags as a group run (`--check`, `--allow`, `--max-iterations`, `--escalate-to`, `--provider`, `--model`, …) plus `--change-check <command>`, which can be repeated.
  - A dirty tree is refused unless `--allow-dirty`, as with `run`. The loop's guard refusals exit `2`: an invalid change, or an approved file edited since.
  - It exits `0` when the change converges and `1` otherwise.
- **`answer` routes a change loop to `answerChangeEscalation`** and prints the new run as `build` does.
- **`status` lists change loops** as `build <group>`, the group the build reached.
- **Text output** has one line per group, with its status, task count and reworks, then the change check and any scenario no task names. A blocked build ends with the question and the `answer` command. A finished build ends with `pnpm spec:archive <change>`.
- **A converged draft now points at `build`:** `Every stage of <change> is approved. Build it: pnpm task build <change>`.

## Out of scope

- `build --worktree` (one worktree for the whole change), and `changeChecks` in `agentscript.config.json`. Both are in `parked.md`.
- JSON Lines events for change loops.

## Capabilities

- **Modified:** `task/cli`.

## Impact

- New: `packages/agent/src/task/build-cli.ts`. Updated: `src/bin/agentscript-task.ts`, `src/task/status.ts`, `src/task/draft-cli.ts`, the package README, `guides/07-task-loop.md`.
- Depends on `add-draft-cli` and `add-build-loop`, archived first.
