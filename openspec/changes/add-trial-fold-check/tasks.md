## 1. Shared trial fold wrapper

- [ ] 1.1 Create `packages/agent/src/spec/trial-fold-issues.ts` exporting `trialFoldIssues` and the raw result over close's shared fold; a throw becomes one `ERROR` at `trial fold (openspec validate --specs --strict)`

## 2. Trial fold in the specs gate

- [ ] 2.1 In `packages/agent/src/task/stages/specs-gate.ts`, when strict validation has no `ERROR`, add `trialFoldIssues` results after strict issues and before coverage and size issues
- [ ] 2.2 Test in `packages/agent/__tests__/task/stages/specs-gate.test.ts` "A MODIFIED requirement too long after folding", "A fold issue on a spec the change does not touch", "An invalid delta is not folded", "A clean fold adds no issue"
- [ ] 2.3 Test in `packages/agent/__tests__/task/stages/specs-gate.test.ts` "The fold cannot run" with a stubbed trial fold that throws on the temporary copy

## 3. Trial fold in the change loop

- [ ] 3.1 In `packages/agent/src/task/change-loop.ts`, after every change check exits `0`, run the fold through `trialFoldIssues`'s module, add its `CheckEvidence`, and end `converged` on pass or `blocked` to `principal` at level `"change"` on fail
- [ ] 3.2 In `packages/agent/src/task/change-loop.ts`, make `answerChangeEscalation` on a fold block start a new run straight at `check`, keeping entries and not re-checking approvals
- [ ] 3.3 Test in `packages/agent/__tests__/task/change-loop.test.ts` "An unclaimed scenario is reported", "A failing change check fails the change", "A passing fold converges the change", "Folded specs that fail block the build"
- [ ] 3.4 Test in `packages/agent/__tests__/task/change-loop.test.ts` "Answering a blocked group resumes the change", "Answering a fold block re-runs only the check"

## 4. One fold for both callers

- [ ] 4.1 Test in `packages/agent/__tests__/spec/trial-fold-issues.test.ts` "One fold serves both callers" by stubbing close's shared fold and scanning the source tree for other `openspec validate --specs --strict` callers
- [ ] 4.2 In `docs/ontology/loops/change-loop.md`, describe the trial fold evidence in `check` and the `blocked` escalation a failing fold raises
