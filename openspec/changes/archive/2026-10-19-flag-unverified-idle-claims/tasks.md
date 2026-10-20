## 1. The idle judge line

- [x] 1.1 `packages/agent/src/task/scripts/task-delegate.agent`, judge: replace the single `Files the delegate changed in this iteration: …` line with an `if @variables.act_files == 0 and @variables.changed == "":` branch rendering `Files the delegate changed in this iteration: 0 (-1 means unknown). 0 means the delegate changed nothing.` and the `No file has changed since the loop started either, …` line, and an `else:` branch rendering the existing line unchanged. Tests: "Scenario: The judge sees an idle delegate" (updated, `delegation-loop.test.ts`), "Scenario: The judge sees an idle delegate after earlier changes" and "Scenario: The judge sees a delegate that changed files" (`changed-scripts.test.ts`). Run `pnpm check`, `pnpm test`, `pnpm spec:check`

The change ends with `pnpm change close flag-unverified-idle-claims`.
