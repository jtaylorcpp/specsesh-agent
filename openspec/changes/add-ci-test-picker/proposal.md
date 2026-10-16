## Why

Specsesh CI runs a check when a minor task of a Specsesh change closes. Running the whole suite for every small task is slow, and Specsesh's CI templates already have two slots for a narrower run: `{!@ci.selected_tests}` (test files) and `{!@ci.test_pattern}` (a name filter). Nothing fills them. An agent that reads the task, its linked scenarios and the changed files can pick the tests that cover the task, as long as it never invents a path and any failure falls back to the full suite.

## What Changes

- A bundled Agent Script, `src/task/scripts/ci-test-pick.agent`, seeded with `task_id`, `task_text`, `scenarios`, `changed_files`, `test_files`, `diff` and `siblings`, that sets one string variable, `pick`: JSON `{ tests, names, reasons }`.
- `pickTests(input, options)`, exported from `./task`: a deterministic pre-filter adds every test in `test_files` that sits beside a changed file (`src/a.ts` → `src/a.test.ts`, `foo.go` → `foo_test.go`, `mod.py` → `test_mod.py`), then the script runs once on the configured provider (or an injected `ReasoningPort`), its output is checked against the TypeBox schema `TestPick`, test paths not in `test_files` are dropped and everything is deduped. It answers `{ ok: true, pick }` or `{ ok: false, reason }`, and never throws.
- `TestPick`, `TestReason` and `testPattern(names)` in `./openspec` (`src/openspec/pipeline.ts`): the shape Specsesh shares, and the names regex-escaped and joined with `|`. They move to `@specsesh/ontology/pipeline` once that is published.
- `agentscript-task pick-tests --input <file.json>`: runs `pickTests` and prints the result, with the pattern, as JSON.

## Out of scope

- Running the picked tests, or the CI templates themselves: Specsesh fills `{!@ci.selected_tests}` and `{!@ci.test_pattern}`.
- Finding test files or linked scenarios: the caller hands them in.
- A Worker-native entry: `./task` is Node-only, so a Worker runs the CLI in its Sandbox container.
- Following imports to find tests: the pre-filter only matches siblings by name; the agent may pick importers.

## Capabilities

- **New:** `task/test-pick`.

## Impact

- New: `packages/agent/src/task/scripts/ci-test-pick.agent`, `src/task/test-pick.ts`, `src/openspec/pipeline.ts`, `__tests__/task/test-pick.test.ts`.
- Changed: `src/openspec/index.ts`, `src/task/index.ts` and `src/bin/agentscript-task.ts` (a `pick-tests` command and usage line); `__tests__/openspec/schema-agreement.test.ts` gains fixtures for the two schemas; `CLAUDE.md`.
- No new dependency. No model is called in `pnpm test`.
