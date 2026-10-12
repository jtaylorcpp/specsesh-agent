# Gaps

Things we had to do by hand, or with a throwaway script, while executing the changes in `openspec/changes/` with our own tools (`pnpm task`, `pnpm spec:archive`). Each is a candidate for a tool. Newest last. When a later change closes a gap, it says so in **Closed by**.

| # | What we had to do | How we did it | Closed by |
|---|---|---|---|
| 1 | Run a change's task groups one after another, stopping at the first that doesn't converge | A shell loop over `pnpm task <change> <group>` (`.agentscript/drive/drive-change.sh`) | `add-build-loop` + `add-change-build` (`pnpm change build`) |
| 2 | Commit each converged group, so the next group starts on a clean tree (`requireCleanTree`) | `git add -A && git commit` in the same shell loop | — nothing planned; every tool leaves committing to the principal |
| 3 | Rebuild `dist/` before each group. `pnpm task` runs the built bin, so a change to the runner's own source only takes effect after `pnpm build` | `pnpm build` in the shell loop before each group | — |
| 4 | Watch a running group: which task, which iteration, what the agent did | `tail` and `grep` on the stderr JSON Lines | — (`pnpm task status` lists loops only after the fact) |
| 5 | The verify group's tasks ("run `pnpm test:live`", "the orchestrator runs it", `pnpm spec:archive`) are orchestrator steps, not agent tasks | Run by hand at the end of each change | `add-change-close` (`pnpm change close`) covers the archive; nothing covers the live run |
| 6 | Keep the driver running when the agent session ends or the machine reboots. Twice the loop was cut off mid-task (session ended; then a reboot wiped `/tmp`). The loops themselves were safe in SQLite and `pnpm task resume` picked them up | Driver moved to `.agentscript/drive/`, started with `setsid nohup`; resumed by hand with `pnpm task resume <loop>` | — nothing restarts a stored loop on its own |
| 7 | Delete files a task retires. The agent's actions can read, write and run allowlisted commands, but nothing deletes a file, and the grant's allowlist is `pnpm`/`node`. Task 3.6 of `add-actors-and-workspaces` blocked after three refused attempts | The orchestrator ran `git rm` and answered the loop | — a `delete_file` built-in, confined like `write_file`, would close it |
| 8 | Fix a spec defect an agent finds mid-build (wrong requirement names in a REMOVED block's Migration lines). The loops can escalate `amend-spec`, but nothing applies the amendment | The orchestrator edited the delta and answered the loop | — |
| 9 | Answer a loop across a change to the host itself. A group loop stores its scripts when it starts. Group 3 of `add-actors-and-workspaces` retired `delegate_claude_code`, so the answered run's stored script named an action the new config no longer grants, and failed at start | Committed the group's work so far, rebuilt, and started the group again (ticked tasks are skipped) | — |
| 10 | Find out why a loop failed. `pnpm task` printed `failed (runs 2)` and nothing else; the reason was only in the stored task record | Read `tasks.record` from `.agentscript/task-loops.sqlite` (`.agentscript/drive/peek.cjs`) | — |
