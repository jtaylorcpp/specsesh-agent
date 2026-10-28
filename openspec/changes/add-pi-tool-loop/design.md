## Context

The interpreter composes a step's `reasoning.actions` into `request.tools` (`ToolOffer[]`: `name`, `description`, `inputSchema`, `action` (the `mcpTool://` name), `bound`) and reads back `answered.toolCalls` to apply `set` clauses (`run.ts` `settle`). The core never runs a tool: by `core/reasoning-port`, the port owns the loop. Today only `src/durable` owns one, through pi-durable's conversation loop. `createPiReasoningPort` refuses tools (`src/pi/port.ts:46`).

pi-ai 1.1.0 is enough for a loop. `complete()` returns an `AssistantMessage` whose content may hold `toolCall` blocks (`{ id, name, arguments }`) with `stopReason: "toolUse"`, and the context accepts `{ role: "toolResult", toolCallId, toolName, content, isError, timestamp }` messages.

## Goals / Non-Goals

**Goals:** offered tools run in a one-shot `run()` with the pi port; the answer looks the same to the interpreter as under the durable host; nothing changes for a port created without `tools`.

**Non-Goals:** CLI loading and the registry adapter (`add-cli-tools`); MCP (`add-mcp-tools`); claude-code; crash safety, which stays the durable host's job.

## Decisions

1. **The tool host is a plain function in `src/pi`.** `PiToolHost = (call: PiToolCall) => Promise<ActionResult> | ActionResult`, where `PiToolCall` is `{ name, tool, inputs }`: `name` is the offer's name, `tool` is its `action`, and `inputs` are the merged inputs. `ActionResult` is the interpreter's type, so `src/pi` imports nothing new, and the layer test stays as it is. A durable `ActionRegistry` is adapted to this shape in `add-cli-tools` (in `src/durable`, which may import `src/pi`'s types but not the reverse).
2. **Opt-in, and the old path is unchanged.** With no `tools`, `reason` is byte-for-byte today's single request, refusal included. The existing pi/port scenarios keep passing unmodified, apart from the one-request requirement's text, which gains "without `tools`".
3. **The loop.**
   - **Request.** The first request carries the system prompt and the prompt, as today. Its `tools` are each offer as a pi `Tool` (`name`, `description`, `parameters: inputSchema`), plus `submit_result` when the step has an `outputSchema`. Nothing is forced on these rounds: forcing `submit_result` would skip the actions.
   - **Calls.** Each `toolCall` in the reply is handled in content order:
     - An offered name is validated and run. Its record is appended, and its result message is appended to the context.
     - `submit_result` is noted, and the step ends after the remaining calls in that message.
     - Any other name gets an error result, `no tool named "<name>" is offered on this step`, and is **not** recorded, because a recorded unoffered call fails the step in the interpreter. The model can recover.
   - **End.** A message with no tool call ends the loop. A structured step that never called `submit_result` then makes one settling request offering only `submit_result`, with `forceTool(model)`.
   - **Outcome.** `answered`, with `text` from the last message, `structured` from the `submit_result` call when there was one, and `toolCalls`, present (possibly empty) whenever the request offered tools.
4. **Validation before the host.** The offer's `inputSchema` is always `{ type: object, properties: {<scalar types>}, required, additionalProperties: false }` (`composeToolOffers`). The port checks each argument: required present, no extras, JSON type matching (`integer` accepts whole numbers, `number` any number). A failed check is answered to the model as `isError` naming each problem, recorded `ok: false` with `outputs: {}`, and the host is not called. Then `inputs = { ...arguments, ...offer.bound }`: bound wins, as in `src/durable/extension.ts`.
5. **Results to the model.** `ok: true` → text `JSON.stringify(outputs)`, `isError: false`. `ok: false` → the result's `message`, `isError: true`. A host that throws is `ok: false` with the error's message. The record's `record` is the host's, carried unchanged.
6. **Bounds and failures.** `maxRounds` (default 16, `DEFAULT_MAX_ROUNDS`) counts every `complete()` call in the step, the settling one included. Reaching it while the model still calls tools ends `{ kind: "cut-short", text, turns: maxRounds }`. Any reply whose `stopReason` is `length`, `aborted` or `error` ends the step with `toOutcome`'s failure, whatever ran before. `onMessage` sees every reply; `maxTokens`, `temperature` and `signal` apply to each request.
7. **The refusal text.** `TOOLS_NEED_DURABLE_HOST` keeps its name, and claude-code keeps using it. Its text adds `, or a pi reasoning port given a tool host (tools)`.

## Testing

pi's faux provider scripts the replies (tool calls, then text or `submit_result`) and records each context, so the tests can assert what the model saw: tool results, offers and forcing. One test runs a script with a `reasoning.actions` entry and a `set` through `run()`, end to end.

## Risks

- **Models that won't call `submit_result` after tools.** The settling round covers this. A model that ignores even a forced call fails the step by the existing rule.
- **Providers that reject an unforced tool list alongside forced options.** Forcing happens only on the settling round, which offers just one tool.
- **Duplicate-name collisions.** An offer named `submit_result` would shadow the result tool. The scan doesn't forbid that name today. Note it in `openspec/parked.md` rather than widening this change.
