# Design: add-ci-test-picker

## Context

Specsesh Code is a Cloudflare Worker that runs commands in a Cloudflare Sandbox container. When a minor task closes, its CI fills `{!@ci.selected_tests}` and `{!@ci.test_pattern}`; on any failure it runs the full suite. The picker must therefore be cheap to fail: one model step, a hard timeout, and an answer instead of a throw.

## Decisions

- **One step, one string.** Agent Script variables are strings, numbers or booleans, so the script reads back one string, `pick`, holding the JSON. `pickTests` parses it (a single surrounding Markdown code fence is tolerated) and checks it with `check(TestPick, value)`. A step that fails, a run that does not complete, unparsable JSON and a schema miss are each `{ ok: false, reason }`.
- **Schemas in the ontology layer.** `src/task` may not import `typebox` (the layer rule), so `TestPick` and `TestReason` live in `src/openspec/pipeline.ts`, beside the other TypeBox schemas, with `testPattern`. The file says they move to `@specsesh/ontology/pipeline`, the package Specsesh shares them through, once it is published here. `./openspec` is runtime-neutral, so a Worker can import `testPattern` and `TestPick` directly.
- **`TestPick`** is `{ tests: string[], names: string[], reasons: { test, why }[] }`, every string non-empty. `testPattern(names)` escapes `\ ^ $ . * + ? ( ) [ ] { } |` and `/`, joins with `|`, and is `""` for no names.
- **Pre-filter before the model.** `siblingTests(changed, tests)` is pure. A test file is a sibling of a changed file when its subject stem equals the changed file's stem (the basename without its last extension) and it sits in the same directory or in `__tests__`, `tests` or `test` under it. Subject stems: `x.test.<ext>` and `x.spec.<ext>` → `x`; `x_test.<ext>` → `x`; `test_x.<ext>` → `x`. A changed file that is itself in `test_files` is picked. The siblings are passed to the script as `siblings` so the model knows they are already in, and are first in `tests`, each with a reason naming the changed file.
- **Never invent.** Paths are compared after trimming and stripping a leading `./`. A model path not in `test_files` is dropped. `tests`, `names` and `reasons` (by `test`) are deduped, first wins. A reason whose test was dropped is dropped.
- **Nothing to pick.** Empty `test_files` answers `ok: false` with no model call. A pick with no tests and no names also answers `ok: false`, so CI runs everything rather than nothing.
- **Provider.** `options.port` wins. Otherwise `provider`/`model` (default `anthropic`/`claude-haiku-4-5`): `claude-code` uses `createClaudeCodeReasoningPort`, any other provider a pi port over `options.models` or every built-in pi provider, whose credentials are pi's environment variables. `timeoutMs` defaults to 120000; on expiry the answer is `ok: false` and the step's late result is ignored. The diff is cut to `maxDiffChars` (default 20000).
- **CLI.** `agentscript-task pick-tests --input <file.json> [--provider] [--model] [--timeout <ms>]` reads the input JSON, resolves provider and model flag → `AGENTSCRIPT_PROVIDER`/`AGENTSCRIPT_MODEL` → the config's `task` → default, and prints `{ ok, pick, pattern }` or `{ ok, reason }` on stdout: exit 0, 1 or 2 (usage, unreadable input).

## Risks

- A small model may name tests that exist only as functions in other files; names are passed through unchecked, and a bad name makes the pattern match nothing. Specsesh decides whether an empty run falls back.
- `./task` is Node-only. A Worker calls the CLI inside its Sandbox, where the provider's key must be set in the command's environment (or `claude` logged in for `claude-code`).
