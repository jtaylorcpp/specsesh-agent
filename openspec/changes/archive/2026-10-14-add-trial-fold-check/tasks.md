## 1. Structured trial fold in close

- [x] 1.1 In `packages/agent/src/task/cmd-close.ts`, make `trialFold` run `openspec validate --specs --strict --json` and return `TrialFoldResult`, export `formatTrialFold`, and have close print its text
- [x] 1.2 Test in `packages/agent/__tests__/change/cli-close.test.ts` "INFO issues are dropped", "A fold with no parseable JSON", "openspec cannot be spawned", and that close prints unchanged text on a failing fold

## 2. Trial fold in the specs gate

- [x] 2.1 Create `packages/agent/src/task/stages/trial-fold-issues.ts` exporting `trialFoldIssues`, which maps fold issues to delta or workspace paths and turns a `failure` into one `ERROR` with no path
- [x] 2.2 In `packages/agent/src/task/stages/specs-gate.ts`, when strict change validation reports no `ERROR`, append `trialFoldIssues` results before the coverage and size issues
- [x] 2.3 Test in `packages/agent/__tests__/task/stages/specs-gate.test.ts` "A folded requirement over 500 characters is sent back", "An invalid change skips the trial fold", "A clean trial fold lets the draft wait for review"
- [x] 2.4 Test in `packages/agent/__tests__/task/stages/trial-fold-issues.test.ts` "A fold warning on a spec without a delta", "The fold prints no parseable JSON", "openspec is missing at the fold"

## 3. Trial fold in the change loop

- [x] 3.1 In `packages/agent/src/task/change-loop.ts`, run `trialFold` once every change check exits 0, record its `CheckEvidence`, and end `blocked` at `"change"` to `principal` when the fold is not `ok`
- [x] 3.2 In `packages/agent/src/task/answer.ts`, make `answerChangeEscalation` accept a trial fold block and start a new change run, carrying the entries, that goes straight to `check`
- [x] 3.3 Test in `packages/agent/__tests__/task/change-loop.test.ts` "An unclaimed scenario is reported", "A failing change check fails the change", "A folded requirement over 500 characters blocks the build"
- [x] 3.4 Test in `packages/agent/__tests__/task/change-loop.test.ts` "A fold that cannot run blocks the build", "Killed during the trial fold"
- [x] 3.5 Test in `packages/agent/__tests__/task/answer.test.ts` "Answering after fixing the deltas builds the change", "Answering without a fix blocks again"

## 4. Documentation

- [x] 4.1 In `docs/ontology/loops/change-loop.md`, describe the trial fold's evidence in `check`, the `blocked` escalation a failing fold raises, and how answering it re-runs `check`
