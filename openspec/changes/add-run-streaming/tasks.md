## 1. Events in the core

- [x] 1.1 `packages/agent/src/interpreter/events.ts`: `RunEvent` and `StreamDelta` (`design.md` decision 1). `port.ts`: `reason`'s optional second argument. `run.ts`: `onEvent`, the step and action events, `run_end`, the late-delta drop and the listener isolation (decisions 2–3), keeping one `.reason(` call site. Export the types from `src/interpreter/index.ts`. Tests in `__tests__/core/run-events.test.ts` with a recording port: "Scenario: A two-step run reports its steps in order", "Scenario: Deltas sit between their step's boundaries", "Scenario: A run statement reports its action", "Scenario: A throwing listener changes nothing", "Scenario: An unlistened run passes one argument", "Scenario: A late delta is dropped". The existing core tests and `import-boundary` still pass
- [x] 1.2 `streamRun` in `run.ts`, exported (decision 4). Tests in `__tests__/core/run-events.test.ts`: "Scenario: for await sees every event, then the result", "Scenario: A refused start rejects the iterator and the result", "Scenario: A stream iterates once", "Scenario: A port that ignores the stream still runs". Add `streamRun` to the step-machine export test if it lists exports

## 2. The pi port

- [ ] 2.1 `packages/agent/src/pi/port.ts`: the streamed path and delta forwarding, plus tool-loop events (decision 5). `claude-code.ts`: signature only. Tests in `__tests__/pi/streaming.test.ts` on the faux provider: "Scenario: Deltas concatenate to the step's text", "Scenario: Streamed and unstreamed runs agree", "Scenario: An unstreamed step never calls stream", "Scenario: A tool call is reported around its execution". Existing `__tests__/pi/` tests (both `pi/port` scenarios under the modified requirement included) still pass

## 3. Docs

- [ ] 3.1 `packages/agent/README.md`: a `streamRun` example printing text deltas, next to `## Run it once`'s library example. `docs/llm/agent.md`: streaming is library-only, and the CLIs don't stream. `openspec/parked.md`: claude-code `stream-json` deltas. `CLAUDE.md`'s `./interpreter` bullet names `streamRun`. Run `pnpm docs:check`, `pnpm check`, `pnpm test`, and stream the triage example once live on Ollama (`qwen3.5:latest`) from a scratch script, recording the result in `design.md` under "Verified live"

The change ends with `pnpm change close add-run-streaming`.
