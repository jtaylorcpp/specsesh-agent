## 1. Find and check openspec

- [x] 1.1 Create `packages/agent/src/task/openspec-bin.ts` exporting OPENSPEC_MIN_VERSION, memoised resolveOpenspec, resetOpenspecCache, checkOpenspec, runOpenspec and describeOpenspec as the design describes
- [x] 1.2 Add tests to `packages/agent/__tests__/task/openspec-bin.test.ts` for "The project copy wins over PATH", "PATH is used when the project has no copy, and resolved once", "The version is the first x.y.z"

## 2. Gates run the resolved openspec and name it

- [x] 2.1 In `packages/agent/src/task/stages/openspec-cli.ts`, run openspec via resolveOpenspec and runOpenspec, and end each run/parse ERROR with (describeOpenspec(bin)) or (openspec not found)
- [x] 2.2 In `packages/agent/src/task/stages/trial-fold-issues.ts`, take an optional resolved bin and end the fold ERROR with (describeOpenspec(bin)) or (openspec not found)
- [x] 2.3 In `packages/agent/src/task/stages/specs-gate.ts`, suffix the ERROR for show JSON lacking requirement names with (describeOpenspec(bin)), pass the bin to trialFoldIssues, and enforce no minimum version
- [x] 2.4 Update `packages/agent/__tests__/task/stages/specs-gate.test.ts` for "An OpenSpec error reaches the next draft", "openspec is missing", "show prints no parseable JSON", "An old openspec is named, not refused, by the gate"
- [x] 2.5 Update `packages/agent/__tests__/task/stages/trial-fold-issues.test.ts` to the suffixed text and test "The fold prints no parseable JSON", "openspec is missing at the fold"

## 3. The change CLI uses and checks the resolved openspec

- [x] 3.1 In `packages/agent/src/task/cmd-close.ts`, run the validate refusal check and trial fold through runOpenspec with the workspace-resolved bin, also in the temporary copy
- [x] 3.2 In `packages/agent/src/task/cmd-build.ts`, run --amend's validation and trial fold through runOpenspec with the workspace-resolved bin
- [x] 3.3 In `packages/agent/src/bin/agentscript-change.ts`, call checkOpenspec before draft, approve, close and build --amend, printing its message to stderr and exiting 2 on ok: false

## 4. CLI tests

- [x] 4.1 Add tests to `packages/agent/__tests__/change/cli-openspec.test.ts` for "An old PATH openspec refuses draft", "1.14.0 refuses close", "An old openspec refuses --amend", "An unreadable version refuses approve"
- [x] 4.2 Add tests to `packages/agent/__tests__/change/cli-openspec.test.ts` for "A text answer to build is not checked", "The trial fold uses the repository's openspec", "A missing openspec is not a version refusal"
