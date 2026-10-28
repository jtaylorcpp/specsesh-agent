## 1. The core

- [x] 1.1 `packages/agent/src/interpreter/port.ts`: `toolCalls?` on `cut-short` and `failed` (`design.md` decision 1). `run.ts`: `normalise` keeps a failed outcome's `toolCalls`, and `settle` checks them on every kind and keeps them on derived failures (decisions 2 and 3). Tests in `__tests__/core/` (beside the existing tool-call tests), with a recording port: "Scenario: A failed step keeps the tools it called", "Scenario: A cut-short step keeps its calls and sets nothing", "Scenario: A failure derived from an answer keeps its calls", "Scenario: An unoffered call on a failed outcome is still refused", plus the existing "Scenario: An unoffered tool call fails the step" and "Scenario: A refused call is recorded as not ok"

## 2. The ports

- [x] 2.1 `src/pi/port.ts` `runToolLoop`: every exit after the first request carries `toolCalls` (decision 4). Tests in `__tests__/pi/tool-loop.test.ts`: "Scenario: A model that never stops calling tools is cut short", "Scenario: An error reply mid-loop fails the step"
- [x] 2.2 `src/claude-code/claude-code.ts` `runToolStep`: failed, cut-short and aborted outcomes after the bridge started carry the calls recorded so far (decision 5). Tests in `__tests__/pi/claude-code-tools.test.ts`: "Scenario: A tool step that fails keeps its calls"; in `__tests__/pi/claude-code-abort.test.ts`, an abort after one call keeps it

## 3. Durable and the consumers

- [x] 3.1 `src/durable/extension.ts`: both failed returns of the await phase report `actionCalls` when the step offered tools (decision 6), and `reportedCalls` counts every outcome's calls (decision 7). `src/task/iteration.ts` `hostRecords`: every outcome's records (decision 7). Tests: "Scenario: A step whose result is refused reports its calls" (in `__tests__/durable/`, beside the existing "Scenario: Two shell calls are reported"); and a `hostRecords` test in `__tests__/task/` showing a failed step's record is collected
- [ ] 3.2 Docs: `packages/agent/docs/llm/agent.md` and `docs/llm/durable.md` say `toolCalls` is on every outcome of a step that ran tools; the `StepOutcome` doc comments. Run `pnpm docs:check`, `pnpm check`, `pnpm test`

The change ends with `pnpm change close add-tool-calls-on-failures`.
