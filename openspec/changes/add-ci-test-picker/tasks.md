## 1. Shape and script

- [ ] 1.1 Add `packages/agent/src/openspec/pipeline.ts`: `TestReason`, `TestPick` TypeBox schemas and `testPattern(names)`, noting they move to `@specsesh/ontology/pipeline`
- [ ] 1.2 Export `pipeline.js` from `packages/agent/src/openspec/index.ts`
- [ ] 1.3 Add `packages/agent/src/task/scripts/ci-test-pick.agent`: one step over the task, scenarios, changed and test files, siblings and diff, setting `pick`

## 2. Runner and command

- [ ] 2.1 Add `packages/agent/src/task/test-pick.ts`: `siblingTests`, and `pickTests` with port or provider, timeout, `TestPick` check, path filter and dedupe
- [ ] 2.2 Export `pickTests`, `siblingTests`, `testPattern` and their types from `packages/agent/src/task/index.ts`
- [ ] 2.3 Add the `pick-tests --input <file.json>` command and its usage line to `packages/agent/src/bin/agentscript-task.ts`

## 3. Tests

- [ ] 3.1 Test in `packages/agent/__tests__/task/test-pick.test.ts` "The picker script shows the task and reads back one pick", "The diff is shown only when given", "A valid pick is returned", "An invented test path is dropped"
- [ ] 3.2 Test in `packages/agent/__tests__/task/test-pick.test.ts` "Duplicate tests and names are removed", "Sibling tests are added by the pre-filter", "A changed test file is picked", "No test files answers ok false without a model call"
- [ ] 3.3 Test in `packages/agent/__tests__/task/test-pick.test.ts` "Invalid JSON answers ok false", "A pick that fails the TestPick schema answers ok false", "A timeout answers ok false", "A provider failure answers ok false"
- [ ] 3.4 Test in `packages/agent/__tests__/task/test-pick.test.ts` "Names are escaped and joined", "No names give an empty pattern", "pick-tests prints the pick as JSON", "pick-tests without --input prints usage"
- [ ] 3.5 Add `TestPick` and `TestReason` fixtures and `pipeline.ts` to the source list in `packages/agent/__tests__/openspec/schema-agreement.test.ts`

## 4. Docs

- [ ] 4.1 In `CLAUDE.md`, describe `pickTests`, `pipeline.ts` and `agentscript-task pick-tests` under the task layer and Commands
