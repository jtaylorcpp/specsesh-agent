## 1. Loop owner record

- [ ] 1.1 Create `packages/agent/src/task/owner.ts` with the `loop_owner (loop_id PRIMARY KEY, pid, boot_at)` table, `writeOwner`, `readOwner`, `currentBootAt` and `isInterrupted` following design Decision 2
- [ ] 1.2 In `packages/agent/src/task/start.ts`, write a `loop_owner` row with the process pid and current boot time for every loop that `run`, `resume` or `answer` starts or resumes, nested loops included
- [ ] 1.3 Test in `packages/agent/__tests__/task/owner.test.ts` the scenarios "run records the owner", "A live lock on another loop does not hide a dead one" and "A reboot is caught despite a reused pid"

## 2. Status shows interrupted loops

- [ ] 2.1 In `packages/agent/src/task/status.ts`, show `interrupted` for a loop with no outcome and not blocked when `isInterrupted` holds, and never re-label blocked or ended loops
- [ ] 2.2 Test in `packages/agent/__tests__/task/status.test.ts` the scenarios "Two loops are listed newest first", "An empty database", "A group loop and its task loops are listed" and "An interrupted loop is marked and a blocked one is not"
- [ ] 2.3 Test in `packages/agent/__tests__/task/cli.test.ts` the scenario "status is a command"

## 3. resume --all

- [ ] 3.1 Create `packages/agent/src/task/resume-all.ts` that finds interrupted loops, groups them by outermost running root, sorts roots by start time then id, resumes each like `resume <loop-id>` and returns outcome lines and exit code
- [ ] 3.2 In `packages/agent/src/bin/agentscript-task.ts`, add `resume --all` taking the lock once and calling `resumeAll`, refuse a loop id with `--all` and `--all --json` with exit `2`, and change the resume usage line
- [ ] 3.3 Test in `packages/agent/__tests__/task/resume-all.test.ts` "Nested loops resume through their parents in start order", "A refused root does not stop the batch", "A blocked root ends with the answer command", "Nothing to resume"
- [ ] 3.4 Test in `packages/agent/__tests__/task/cli.test.ts` the scenarios "A loop id with --all prints usage", "--json with --all is refused", "An unknown command prints usage" and "No command prints usage"
- [ ] 3.5 In `guides/07-task-loop.md`, document the `interrupted` status and `pnpm task resume --all`, including the one-database-per-call rule
