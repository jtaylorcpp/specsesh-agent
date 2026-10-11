## 1. Core: tests for scenarios with none today

- [x] 1.1 `packages/agentscript/__tests__/authoring-parse.test.ts`: diagnostic dedupe (same code+message+range once; different range kept), synthetic diagnostics on a parser or lint exception (`vi.mock`), the guarded lint input's two messages, default construction is empty, undo/redo with nothing to move are no-ops
- [x] 1.2 `packages/agentscript/__tests__/dependency-pin.test.ts`: a caret range is rejected; a declaration that is no longer a plain literal fails
- [x] 1.3 `packages/agentscript/__tests__/subset-single-source.test.ts`: exact contents of the ten constructs (ids, order, summaries, kinds), the kind lists, `SUPPORTED_NODE_KINDS` as the deduplicated union, the block-field table, the literal table, `renderSubsetMarkdown` / `renderSubsetInline` output
- [x] 1.4 `packages/agentscript/__tests__/subset-refusal.test.ts`: subagent-level `system:`, unknown field in a supported block, variable with no default, bare name, non-procedure `instructions`, unknown statement kind, `{!@context.x}`, `@outputs` in a condition, non-member set target, unknown operator, supported operators pass, lower-case `true`, wrapper and root agree, no root means no findings, the aggregated error header
- [x] 1.5 New `packages/agentscript/__tests__/logic-eval.test.ts`: variable-to-variable set, and/or/not, `or` either side, strict equality does not coerce, computed boolean set, truthiness per type, `"False"` string is truthy
- [x] 1.6 `packages/agentscript/__tests__/prompt-lines.test.ts`: else branch supplies the line, nested conditions, a set feeds a later condition and a later prompt line, numbers and booleans render in JavaScript spelling
- [x] 1.7 `packages/agentscript/__tests__/port-dispatch.test.ts`: no system block, every step carries the same instructions, a system-block interpolation renders as source, no port refused before the document is read
- [x] 1.8 `packages/agentscript/__tests__/state-update.test.ts`: exact schema for string and boolean fields, `integer` → number (check the dialect accepts `integer` first), one field feeding two variables is required once, text-only request has no `outputSchema` key, a pending set on an untaken branch asks for nothing, a partial result writes nothing, a wrong-shape value is refused
- [x] 1.9 `packages/agentscript/__tests__/run-state.test.ts`: literal kinds seed as JS values, both declaration forms, description changes nothing, undeclared references (untaken branch, unentered subagent, set target, right of `or`, per-reference position), unchanged persistence returns identical text, only the value span changes
- [x] 1.10 `packages/agentscript/__tests__/step-machine.test.ts`: every error's `name`, `UnparsedDocumentError` positions and warnings excluded, error diagnostic wins over an unsupported construct, `UndeclaredOverrideError`, entry resolution (string, array order, default first only), `before` vs `variables` after a logic-only subagent, trailing logic-only effects reach the result, `next`/`apply` do not mutate their input, `hashSource` known values (`0-811c9dc5`, `1-e40c292c`, `12c-970138f5`)
- [x] 1.11 `packages/agentscript/__tests__/step-outcome.test.ts` and `failure-category.test.ts`: a failed step ends the run (later entry not dispatched), a foreign category through `run`, a port answering a string, `KNOWN_FAILURE_CATEGORIES` exact order, `isFailureCategory` membership

## 2. Durable: tests for scenarios with none today

- [x] 2.1 New `packages/agentscript-durable/__tests__/phases.test.ts`: exact checkpoint sequence and step numbers 0/1, task created at phase `next`, no `updatedSource`, both "reached with no step awaiting" errors, no orphan conversation after a crash in dispatch, a re-run await makes no second model turn, missing step conversation → failed step, step doc schema at dispatch and `null` for text-only, no model configured when none given, provider-error message prefix `the step was not answered:`
- [x] 2.2 `packages/agentscript-durable/__tests__/edges.test.ts`: `checkResult` accepts an extra field; a null value is reported as `got object`
- [x] 2.3 `packages/agentscript-durable/__tests__/run.test.ts`: run owned by an explicit conversation, no `model` key stored without a model, `startScript` makes no model request, a failed run resolves `waitForScript`, a string task ID gets the "Task IDs are numbers" error
- [x] 2.4 `packages/agentscript-durable/__tests__/cli.test.ts`: no command, `resume` with no ID, harness closed after a refusal, claude-code selectable, env and default provider/model resolution, non-integer task ID, aborted run exits 1, failed step prints `<category>: <message>`, `parseVar` edge inputs
- [x] 2.5 `packages/agentscript-cloudflare`: a vitest/miniflare suite (or `test/*.sh`) for every 404/400/422 route, `?wait=1`, `POST /faux` and `queued`, GET terminal and unknown task, model selection and the Workers AI default, invalid `AGENTSCRIPT_FAUX_TPS` ignored, two host names → two objects

## 3. Close

- [x] 3.1 `pnpm test` and `pnpm check` pass; each new test is named after the scenario it pins
- [x] 3.2 `pnpm spec:archive baseline-agentscript-durable`
