## Why

gaps.md #6: during the 21-change run, the driver died twice: once when a session ended, and once when the machine rebooted. The loops' state was safe in SQLite. But each interrupted loop had to be found and resumed by hand with `pnpm task resume <loop>`. Nothing showed which loops were interrupted, and nothing resumed them all in one go.

## What Changes

- Add `pnpm task resume --all`. It resumes every stored loop that is interrupted. A loop is interrupted when its record says it is still running but no process is running it any more, for example after a reboot or after the session that started it was killed.
- Loops resume in the order they started.
- A nested loop resumes through its parent and is never resumed twice. A change loop carries on its group loop, and a group loop carries on its task loop.
- `resume --all` prints one line for each loop it resumes, with that loop's outcome.
- `pnpm task status` marks interrupted loops as `interrupted`, so they can be seen before resuming.
- Loops blocked waiting for an answer, and loops that have ended, are not marked and not resumed.

## Out of scope

- Anything that restarts loops on its own, such as daemons, systemd units, file watchers, schedulers or queues of changes. This repo is the agent, the harness and the OpenSpec tools. Restarting work automatically belongs to the repo that integrates them.
- Changes to how a single loop resumes. `pnpm task resume <loop>` keeps its current behaviour.
- Answering escalations of blocked loops.

## Capabilities

**Modified:**
- `task/cli`: `resume --all`, which finds interrupted loops, resumes them in start order through their outermost parent, and prints one outcome line per loop.
- `task/headless`: the status listing shows the `interrupted` state, separate from running, blocked and ended loops.

## Impact

- The `agentscript-task` command (`pnpm task`): a new `--all` flag on `resume`, and a new state in `status`.
- Telling "running" apart from "interrupted" needs a check that a loop's recorded process is still alive. If the stored loop record does not hold enough to do that check, the record has to change.
- The nested change, group and task loops are resumed through their parents, so they need their parent links in the database to be read.
- No change to the `openspec/loops` ontology or to how a single loop runs.