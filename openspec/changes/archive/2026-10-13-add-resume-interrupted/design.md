# Design: add-resume-interrupted

## Context

gaps.md #6: during the 21-change run, the driver died twice: once when a session ended, and once when the machine rebooted. Every loop's state was still in SQLite. But each interrupted loop had to be found by hand and resumed with `pnpm task resume <loop>`. `pnpm task status` showed these loops as `running`, the same as a loop that really was running, so you could not see which ones needed a resume.

What the code already gives us (from `task/cli` and `task/headless`):

- `resume <loop-id>` continues a stored task, group or spec loop from the database alone (`--db`, else the config's `db`). It uses the loop's recorded worktree when it has one.
- `run`, `resume` and `answer` take `<db>.lock`, which holds the pid. Only one live process can hold a database. A lock whose pid is dead is taken over, with a `warning` event.
- `status` lists every loop, newest first, as `running`, `converged`, `blocked`, `exhausted` or `failed`.
- Task loops started by a group loop have a parent link to that group loop in the database. A change loop links to its group loops in the same way.

What is missing is a way to tell a loop that is running from one whose process has died. The lock alone cannot do this. One database can hold a stale `running` loop from a run that crashed earlier while a new, live process holds the lock for a different loop. As the proposal's Impact section expects, the loop record has to change.

## How it is used

Every command reads the database from `--db`, else from the config's `db`. This is unchanged.

**1. See what was interrupted.** `status` gains a sixth state, `interrupted`. In this example the machine rebooted while two drivers were working:

```console
$ pnpm task status
14  add-plan-export      1.3        interrupted   2 iterations
13  add-plan-export      group 1    interrupted   1 iteration
12  add-plan-schema      2.1        blocked       3 iterations
11  add-resume-hint      group 2    interrupted   0 iterations
10  add-resume-hint      2.2        interrupted   1 iteration
 9  add-resume-hint      2.1        converged     2 iterations
```

Loop `14` is a task loop inside group loop `13`. Loop `10` is a task loop inside group loop `11`. Loop `12` is waiting for an answer, so it stays `blocked`. Loop `9` has ended, so it stays `converged`.

**2. Resume all of them.** The command prints one line per loop it resumes, with that loop's outcome:

```console
$ pnpm task resume --all
loop 11 add-resume-hint group 2 (via 10) — converged
loop 13 add-plan-export group 1 (via 14) — blocked: agentscript-task answer 13 --db .agentscript/task-loops.sqlite --by principal --decision "…"
$ echo $?
1
```

- **Order.** `11` resumes before `13` because group loop `11` started before group loop `13`. The order is by when the outermost loop started, not by loop id.
- **Nesting.** Task loops `10` and `14` are not resumed on their own. Each one carries on inside its parent group loop. `(via …)` names the nested interrupted loops that the parent carried on.
- **Progress.** While each loop runs, stderr carries the usual JSON Lines progress events, exactly as for `resume <loop-id>`.
- **Exit code.** `0` when every resumed loop converged, or when a spec loop stopped for review. Otherwise `1`. These are the same rules `resume <loop-id>` follows.

**3. Nothing to do.**

```console
$ pnpm task resume --all
no interrupted loops in .agentscript/task-loops.sqlite
$ echo $?
0
```

**4. Refusals** use the existing rules:

| Situation | Output | Exit |
|---|---|---|
| Another live process holds `<db>.lock` | stderr names the holder's pid (the existing lock rule) | `2` |
| `resume 12 --all` (a loop id and `--all` together) | usage | `2` |
| `resume --all --json` | message naming `--json`, then usage (see Decisions) | `2` |

One loop failing does not stop the batch. Say loop `11`'s worktree was removed, so its resume is refused. Its line reads `loop 11 add-resume-hint group 2 — refused: <message>`. The command then carries on with loop `13` and exits `1` at the end.

The usage line for `resume` becomes:

```
agentscript-task resume <loop-id>|--all [--db <path>] [--json]
```

`--json` applies to `<loop-id>` only.

The commands as a user would type them are in `design/examples/resume-all.sh`. The liveness check, written as code, is in `design/examples/loop-liveness.ts`. A rendered terminal session showing each state (interrupted, resumed, nothing to resume, refused) is in `design/mock.html`.

## Decisions

1. **The record of which process owns each loop.** Whenever a process starts or resumes a loop (`run`, `resume`, `answer`, and each loop resumed by `resume --all`), it writes an owner record for that loop: `{ pid, bootAt }`. `bootAt` is the machine's boot time, `Date.now() - os.uptime() * 1000`, rounded to the second. Nested loops get the owner of the process that runs them.
   - This is a new `loop_owner (loop_id PRIMARY KEY, pid, boot_at)` table in the same database, written by the CLI.
   - The harness and the `openspec/loops` ontology are not touched.

2. **The `interrupted` rule.** `status` and `resume --all` decide this without taking the lock. A loop is `interrupted` when all three hold:
   - Its stored state is still running. It has no outcome, and it is not blocked on an escalation.
   - Its owner is not the current live holder of the lock. That means one of these: `<db>.lock` is missing; `<db>.lock` names a pid that is dead; `<db>.lock` names a pid other than the owner's pid; or the owner's `bootAt` differs from the current boot time by more than 2 s, which catches a reboot even when the pid has been reused.
   - A loop with no owner record (one started before this change) counts as interrupted when no live process holds the lock. Otherwise it is shown as `running`.

   `blocked`, `converged`, `exhausted` and `failed` are never re-labelled.

3. **Resume through the outermost parent.** For each interrupted loop, follow its parent links up to the outermost loop that is still running (task → group → change). Group the interrupted loops by that root, so each root is resumed exactly once. If a loop's parent has already ended (this should not happen), the loop is its own root.

4. **Start order.** Sort the roots by their stored start time, with the loop id as a tie-break. Resume them one after another, in a single process, under a single lock taken once at the start. Each root is resumed the same way `resume <loop-id>` resumes it, including its recorded worktree. There is no parallelism: one process holds a database.

5. **One line per resumed root.** The line is `loop <id> <change> <task|group n|spec stage>[ (via <ids>)] — <status>`. Each status ends its line differently:
   - `blocked` ends with the `answer` command.
   - `refused` ends with the reason.
   - `converged`, `exhausted` and `failed` stand alone.

   Per-iteration detail is left to the stderr event stream and to `resume <loop-id>`.

6. **No `--json` with `--all`.** The proposal asks for text lines only. A JSON form of the batch result is left for a later change, and is refused for now rather than guessed at.

7. **One database per call.** `--all` covers the database given by `--db` or the config. Worktree-mode runs, which each have their own `--db`, are resumed one database at a time. Finding databases across directories would be a form of automatic discovery, and the proposal leaves that out of scope.

## Risks

- **Pid reuse within one boot.** Suppose a loop's process dies, its stale lock remains, and an unrelated process gets the same pid. That loop then reads as `running` until the lock is taken over. This is rare, and running `resume <loop-id>` takes over the stale lock, as it does today.
- **Clock and uptime drift.** `bootAt` is derived from the wall clock. A large clock change (an NTP step of more than 2 s) can make a live loop look interrupted. The cost is small: `resume --all` would then fail on the lock (exit `2`) and resume nothing, so no work is lost.
- **Loops from before this change** have no owner record. They are judged by the lock alone, so a live run on the same database hides them as `running` until it ends.
- **A long batch.** The roots run one after another, so the last one waits for all the others. `status` from another shell shows the roots still waiting as `interrupted` until their turn, because ownership is written when each loop resumes, not when the batch starts.
- **"Change loop" nesting** relies on parent links being present in the database. Where a level has no parent link, that loop is resumed as its own root. It is then still resumed once, but it may show up as a separate line.
