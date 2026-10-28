## Why

Feedback on 0.4.0: `toolCalls` appears only on an `answered` outcome. A step that ran tools and then failed or was cut short loses its record of what it did. Examples: a 429 mid-loop, `maxRounds` reached, a refused `submit_result`, an aborted claude-code step. Those calls still happened: files were edited and commands run. A host auditing the run, or showing it to someone, can't see them.

There is a second effect. Every consumer that counts calls reads only answered steps:
- a delegate's `maxCalls` budget (`reportedCalls` in `src/durable/extension.ts`), so calls made inside a failed step don't count against it;
- the task loop's action and evidence records (`hostRecords` in `src/task/iteration.ts`).

## What Changes

- **`StepOutcome`.** `cut-short` and `failed` gain `toolCalls?`, with the same shape and rule as on `answered`: present when the step offered tools and the port ran its tool path, one entry per call, in call order.
- **The ports report them on every outcome.**
  - **The pi tool loop:** at its `maxRounds` cut-short, on an error, length or aborted reply, and when the settling request fails.
  - **The claude-code port's tool steps:** every failure and cut-short after the bridge started, the abort from `add-claude-code-abort` included.
  - **The durable await phase:** a step that is not answered, or whose `submit_result` was refused three times, reports the calls in its step conversation.
- **`run()` keeps them.**
  - It validates `toolCalls` on every kind, not only on answers. A call naming an unoffered tool fails the step, as before.
  - A failure it derives from an answer, such as a missing structured result, keeps the answer's calls.
  - Outputs are still applied only from an answered step: a failed step sets nothing.
- **Consumers count every outcome's calls:** `maxCalls` (`reportedCalls`) and the task loop's records (`hostRecords`).

## Out of scope

- Applying a failed step's tool outputs to variables. A failed step still sets nothing.
- New events. `step_end` already carries the outcome, so it carries the calls too.

## Capabilities

- **Modified:**
  - `core/reasoning-port`;
  - `pi/port`;
  - `pi/claude-code`;
  - `durable/run-task`;
  - `actions/delegation`.

## Impact

- `packages/agent/src/interpreter/port.ts` (types) and `run.ts` (`normalise`, `settle`).
- `packages/agent/src/pi/port.ts` (`runToolLoop`), `src/claude-code/claude-code.ts` (`runToolStep`), and `src/durable/extension.ts` (the await phase and `reportedCalls`).
- `src/task/iteration.ts` (`hostRecords`).
- Docs: `docs/llm/agent.md` and `docs/llm/durable.md`.
- Five capabilities, three over the proposal gate's warning. Each delta is one modified requirement saying that one producer or consumer now covers failed and cut-short outcomes. Splitting them would ship a type that some producers fill and others don't.
