## Context

- **`StepOutcome`** (`src/interpreter/port.ts`) has `toolCalls?` on `answered` only.
- **`run.ts`.** `normalise` rebuilds a `failed` outcome from `category` and `message`, which drops anything else. `settle` returns a non-answered outcome untouched and checks `toolCalls` only on an answer.
- **Producers:**
  - the pi tool loop (`runToolLoop`) attaches `toolCalls` only to `answered`;
  - the claude-code port's `runToolStep` does the same;
  - the durable await phase (`extension.ts`) reads `actionCalls` only when the step settled answered.
- **Consumers:**
  - `reportedCalls`, which counts a host action's calls for delegate `maxCalls`;
  - `hostRecords` in `src/task/iteration.ts`, which collects action and evidence records.

  Both skip any step that isn't answered.

## Decisions

1. **The type.** `toolCalls?: readonly ToolCallRecord[]` on the `cut-short` and `failed` members, documented as on `answered`: present when the step offered tools and its tool path ran, every call made, in call order. A port that refuses a tool request before running anything carries no `toolCalls`. Examples are `TOOLS_NEED_DURABLE_HOST`, an unservable name, an already-aborted signal, and a bridge that won't start. So existing refusals stay exactly as they are.
2. **`normalise`.** A `failed` outcome keeps a reported `toolCalls` field as it is: it is copied onto the rebuilt object and checked in `settle`. `cut-short` already passes through whole.
3. **`settle`.**
   - **The check runs on every kind.** If `toolCalls` is present on any outcome, it must be a list whose names were all offered. A bad list fails the step with today's messages, and that failure carries no `toolCalls`, because the list can't be trusted.
   - **A non-answered outcome** then returns with its calls.
   - **A failure that `settle` derives from an answer** carries the answer's validated `toolCalls`. Examples are a missing or unusable structured result and a value outside `choices`.
   - **Outputs** are applied only from an answered step that settles.
4. **The pi loop.** Every exit after the first request carries `toolCalls`:
   - the `length`/`aborted`/`error` reply mid-loop;
   - the `maxRounds` cut-short, both while calling and before settling;
   - the settling request's failure or cut-short.

   It is the same array, so calls are in call order.
5. **The claude-code port.** In `runToolStep`, once the bridge has started, a `failed` or `cut-short` outcome carries the calls recorded so far. The abort outcome from `add-claude-code-abort` is one of these. It is the abort path that resolves without waiting for the process, so the calls are copied at that moment. Refusals before the bridge (decision 1) carry none.
6. **Durable.** In the await phase, when `request.tools` is set, both failed returns read `actionCalls` from the step conversation and step-actions doc, as the answered path does. Those returns are "the step was not answered" and "the step's result was refused 3 times". `actionCalls` already marks an interrupted or errored call `ok: false` with `outputs: {}`.
7. **Consumers.**
   - **`reportedCalls`** counts the `toolCalls` of every step outcome, not only answered ones. So calls in a failed step count toward a delegate's `maxCalls`. That closes the gap of a failing step that kept calling a delegate.
   - **`hostRecords`** takes `record`s from every outcome's `toolCalls`, so the task loop's evidence includes what a failed iteration did.
8. **Events and results.** `step_end` and `RunResult.steps` carry the outcome as they are, with nothing new needed. `RunState` is plain JSON, so a resumed run keeps the calls.

## Testing

- **Core:** a recording port answers `failed`, then `cut-short`, each with `toolCalls`. The run's steps keep them, a variable set by an action's output stays unset, and a bad name still fails the step. An answer with calls and no structured result becomes a failure that keeps the calls.
- **pi:** the faux provider. A tool call followed by an error reply fails, with one call recorded. `maxRounds: 2` with a model that always calls gives `cut-short` with two calls recorded.
- **claude-code:** the fake bridge with a runner that calls the handler once, then reports an error result: the step fails with one call recorded. An abort after one call gives the aborted failure with that call.
- **Durable:** in the durable tests' helpers, a step whose model calls a tool and then has `submit_result` refused three times fails with the call reported. A delegate grant with `maxCalls: 1` called inside a step that then fails, followed by a second step calling it, gets the limit answer.
