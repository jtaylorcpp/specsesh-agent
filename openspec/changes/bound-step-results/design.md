## Context

The evidence is the live run's SQLite database, conversation 23: the judge called `submit_result` with `{ met: "true", unmet: "", next_action: "proceed", question: "Task 1.1 is complete…" }` over and over. Each call came back as `"met" must be a boolean, got string. Call again.`, roughly every 5 seconds, for the rest of the run.

## Decisions

- **A step-specific result tool.** Dispatch configures the step conversation with a `submit_result` whose `parameters` are the request's `outputSchema`, using the same live-tool mechanism the actions change uses for offers. The tool's name, description, replay policy and executor stay the same. A text-only step still offers no result tool.
- **The bound lives on the step doc.** `agentscript.step` gains `refusals: number`, starting at `0`. Each refused call increments it in the same commit as its error result. The third refusal ends the step: the tool returns the error with `control: { terminate: true }`, and the await phase turns a step with a non-null `refusals >= 3` and no `result` into `{ kind: "failed", category: "unknown", message: "the step's result was refused 3 times; last: <problem>" }`.
- **Why 3:** the first refusal is information, the second a correction attempt, and a third identical refusal means the model isn't converging. It's a fixed constant now, and configurable later if a script needs more.
- **The regression test reproduces the live run:** a scripted provider that always answers `met: "true"`. It asserts the step fails after exactly 3 calls, and that the provider was asked 3 times, not more.
