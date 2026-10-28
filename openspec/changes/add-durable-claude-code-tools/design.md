## Context

- **The provider today.** `claudeCodeProvider` (`src/claude-code/claude-code-provider.ts`) turns each pi request into one `claude -p --safe-mode`. A single offered tool becomes `--json-schema`, and its structured output comes back as a call to that tool. More than one tool is refused.
- **A durable step.** pi-durable runs it as a child conversation whose tools are `submit_result` (`RESULT_TOOL`, only when the step writes variables) plus one tool per offered action. On `toolUse`, pi-durable runs each call as a host action, appends one `toolResult` per call (with the call's `toolCallId`), and requests the model again.
- **From `add-claude-code-tools`:** `ToolBridgeFactory`, `mcpBridge()`, `claudeArgs`'s `tools` (the isolation flags in place of `--safe-mode`) and `DEFAULT_MAX_ROUNDS`. `promptOf` already renders tool calls and results as text.

## Goals / Non-Goals

**Goals:**
- Claude Code calls a durable step's tools natively, while pi-durable runs each one: checkpointed, under its replay rule, recorded, and seen by `watchScript`.
- A crash loses at most the held process, never a call's result.
- Requests that offer no tools other than `submit_result` are unchanged.

**Non-Goals:** Workers; streaming; surviving a crash with the process.

## Decisions

1. **A bridged request.** With `bridge` set, a request that offers any tool not named `submit_result` is *bridged*. Every other request takes today's path, unchanged, including the one-tool `--json-schema` mapping. Without `bridge`, the refusal reads `the claude-code provider runs at most one pi tool per request without a bridge; this one offered <n> (<names>)`.
2. **Sessions.** A bridged request with no matching live session starts one:
   - the bridge, serving the request's non-`submit_result` tools (`name`, `description`, `parameters` as `inputSchema`);
   - then one runner call with `claudeArgs({ system: systemPromptOf, model: model.id, schema: submit_result's parameters when offered, maxTurns: 16, tools: bridge })` and `promptOf(messages)` on stdin.
   - **Tool names.** Every non-`submit_result` name must match `^[A-Za-z0-9_-]{1,48}$`, as in the port; otherwise the request ends as an error message and nothing starts.
   - **Holding a call.** The bridge handler queues `{ name, args }` with a resolver and waits.
   - **The next event.** The session's next event is whichever comes first: a queued call that hasn't been handed out, or the process ending.
   - **Handing out calls.** Every queued call not yet handed out goes, in queue order, into one assistant message with `stopReason` `toolUse`. Each call gets the id `claude-code-<randomUUID()>`, mapped to its session and its resolver. Waiting one event-loop turn first lets calls Claude Code made together arrive together.
   - **The process ending.** It maps exactly as today's provider maps a result: a text answer, a `submit_result` call when `structured_output` is present and `submit_result` was offered, or an error message with diagnostics. The bridge closes, and the session and its ids are dropped.
   - **Usage.** A `toolUse` message carries zero usage. The final message carries what Claude Code reports.
3. **Continuing a session.** For a bridged request, the provider reads the `toolResult` messages after the last assistant message.
   - If any `toolCallId` maps to a live session's held call, it resolves each such call with `{ ok: !isError, text }` (the result's text content), then waits for that session's next event.
   - A result whose id is unknown is ignored. If no result maps to a live session, the request starts a new session (decision 2). That is the crash path: the transcript, prior calls and results included, goes to the fresh process through `promptOf`.
4. **Signals and lifetime.**
   - Each session owns an `AbortController`, and its runner is `runnerFor(controller.signal)`.
   - When a request's own `StreamOptions.signal` aborts while it waits on a session, the provider aborts the controller, so the process gets `SIGTERM` (`spawnRunner`'s abort). It also closes the bridge and drops the session, and the request ends `stopReason` `aborted`.
   - `timeoutMs` (default 300000) bounds the whole process, tool time included. The provider passes `--max-turns 16` on a session, so reaching it ends as the existing turn-limit error. The provider spec's "never passes `--max-turns`" holds only for non-bridged requests.
5. **The bins.** `cliModels()` registers `claudeCodeProvider({ bridge: mcpBridge() })`. `mcpBridge` loads the SDK only on a bridged request, so nothing changes for runs without tools. `durable`, `task` and `change` all get it. Only `durable` takes `--tools`/`--mcp` today, so the task and spec loops are unaffected unless a script offers reasoning actions. The `durable` usage line `tools: under --provider claude-code, a step that offers tools fails invalid_request` is removed.

## Testing

- **Provider, unit tests.** A fake `ToolBridgeFactory` captures the handler. A scripted runner calls the handler, awaits the reply, and resolves its `ProcessResult` only after its script finishes. pi requests go through `Models` with `claudeCodeProvider({ runner, bridge })`. Each test asserts the messages, ids, the replies the handler got, argv, `close`, and the runner's signal.
- **Durable, end to end.** A fake `claude` on `PATH` (as in `__tests__/pi/cli.test.ts`) reads `--mcp-config`, calls the first allowed tool over MCP, and answers with its text. `durable run <tools script> --db … --provider claude-code --tools <module>` completes, and the call appears in the step-actions record.

## Risks

- **Held processes.** A host that stops calling back (a hung harness) leaves `claude` waiting until `timeoutMs`. That bound is the backstop.
- **A crash re-renders the transcript.** The fresh process sees prior calls as text, not as native tool turns, so it may re-plan. Each call's result is still from the original run. Nothing is executed twice by the provider, and pi-durable's replay rules govern interrupted calls.
- **Parallel calls reach pi-durable as one message**, and pi-durable runs them in its own order.
