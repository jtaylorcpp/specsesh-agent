## 1. Find and check openspec

- [ ] 1.1 Create `packages/agent/src/task/openspec-bin.ts` exporting OPENSPEC_MIN_VERSION, memoised resolveOpenspec, resetOpenspecCache, checkOpenspec, runOpenspec and describeOpenspec as the design describes
- [ ] 1.2 Add tests to `packages/agent/__tests__/task/openspec-bin.test.ts` for "The project copy wins over PATH", "Without a project copy PATH is used", "A version without x.y.z is null", "--version runs once per process"
- [ ] 1.3 Add tests to `packages/agent/__tests__/task/openspec-bin.test.ts` for "1.14.0 is below the minimum", "A suffix is ignored", "A missing openspec is not refused"

## 2. Gates run the resolved openspec and name it

- [ ] 2.1 In `packages/agent/src/task/stages/openspec-cli.ts`, run openspec via resolveOpenspec and runOpenspec, and end each run/parse ERROR with (describeOpenspec(bin)) or (openspec not found)
- [ ] 2.2 In `packages/agent/src/task/stages/specs-gate.ts`, end the ERROR for show JSON lacking requirement names with (describeOpenspec(bin)), enforcing no minimum version
- [ ] 2.3 Update `packages/agent/__tests__/task/stages/specs-gate.test.ts` for the new suffixed text and test "An OpenSpec error reaches the next draft", "openspec is missing", "Unreadable show output names the openspec run"

## 3. The change CLI uses and checks the resolved openspec

- [ ] 3.1 In `packages/agent/src/task/cmd-close.ts`, run the validate refusal check and trial fold through runOpenspec with the workspace-resolved bin, also in the temporary copy
- [ ] 3.2 In `packages/agent/src/task/cmd-build.ts`, run --amend's validation and trial fold through runOpenspec with the workspace-resolved bin
- [ ] 3.3 In `packages/agent/src/bin/agentscript-change.ts`, call checkOpenspec before draft, approve, close and build --amend, printing its message to stderr and exiting 2 on ok: false

## 4. CLI tests

- [ ] 4.1 Add tests to `packages/agent/__tests__/change/cli-openspec.test.ts` for "draft refuses an old openspec", "approve refuses an unreadable version", "close refuses an old openspec", "--amend refuses an old openspec"
- [ ] 4.2 Add a test to `packages/agent/__tests__/change/cli-answer.test.ts` for "A text answer to build is not checked"
- [ ] 4.3 Add a test to `packages/agent/__tests__/change/cli-close.test.ts` for "The trial fold uses the repository's openspec"
