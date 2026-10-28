# specsesh agent: Agent Script files

The loops are Agent Script (`.agent`) files. These commands show the bundled ones, explain the language, and check or run a script. None of them except `run` calls a model.

## Discover

- `specsesh agent list [--json]` lists the bundled scripts: name, description, the command that runs each, and the variables it reads and writes.
- `specsesh agent show <name> [--json]` prints a bundled script exactly as shipped. `specsesh agent show task > my-task.agent` starts a custom task script.
- `specsesh agent language [topic] [--json]` prints the language reference. With no topic it lists them; `subset` lists what this interpreter supports.
- `specsesh agent actions [--json]` lists the built-in actions a script can call.

## Write and check

- `specsesh agent new <name> [--out <path>]` writes a commented starter script that passes `check`. It never overwrites (exit 1).
- `specsesh agent check <file.agent>… [--json]` parses each file and reports what a run would refuse, with no model, such as a construct this interpreter doesn't support or a variable that isn't declared. Exit 0 when every file would run, 1 when one wouldn't.

## Run

`specsesh agent run <file>` runs a script once and prints each step's outcome and the final variables.

- `--provider <id> --model <id>` picks the model; credentials come from the provider's environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). `--provider claude-code` uses the local `claude` login instead. `--provider ollama` runs on a local Ollama server, keyless, at `OLLAMA_HOST` (default `http://localhost:11434`); its models are the ones pulled, and `specsesh agent models ollama` lists them. An unreachable server prints `ollama: not reachable at <url>: <reason>` and exits 1.
- `--entry <subagent>` (repeatable) picks where it starts. `--var name=value` (repeatable) seeds a variable: `True` and `False` become booleans and numbers numbers.
- `--json` prints the result as JSON. `specsesh agent models [provider]` lists a provider's models.

## Streaming (library only)

None of the commands stream: `agentscript-pi`, `-durable`, `-task` and `-change` print what they always printed. From code, `streamRun(source, options)` from `@specsesh/agent/interpreter` yields a run's events for `for await`, with a `result` promise; `run(source, { ..., onEvent })` is the callback form.

- **Events** (`RunEvent`): `step_start`, `step_end` (with the outcome), `text_delta`, `thinking_delta`, `tool_call`, `tool_result`, `action_start`, `action_end` and `run_end` (with the result). Each but `run_end` names its `step` and `subagent`.
- **The pi port** streams text and thinking deltas and reports each tool-loop call and result. **The claude-code port** gives step and action events, and `tool_call`/`tool_result` on a tool step, but no deltas.
- Partial structured results (`toolcall_delta` fragments of `submit_result`) are not forwarded.

## Tools (`--tools`)

A script's actions (`run @actions.x`, and tools offered under `reasoning.actions`) call tools you write in a JavaScript module:

```bash
specsesh agent run tools.agent --entry echo_it --entry count_it --tools ./tools.mjs --provider ollama --model qwen3.5:latest
```

- `--tools <path>` (repeatable) loads a module, resolved from the working directory. It must be JavaScript: `.mjs` or `.js` (ESM), or `.cjs`. TypeScript is not loaded, so compile it first. Several modules form one set of tools, in flag order.
- `--workspace <dir>` (default the working directory) is the `workspace` given to each module function and to every `execute`.
- **The module shape.** The `default` export, else the `tools` export, is a `HostAction[]`, or a function of `{ workspace }` returning one, sync or async. Each entry is `{ name, kind, inputs, outputs, replay, execute }`: `kind` is `read`, `edit`, `command` or `delegate`; `inputs` and `outputs` map names to `"string"`, `"number"` or `"boolean"`; `replay` is `"safe"` or `"unsafe"`; `execute(inputs, { workspace, signal })` answers `{ ok: true, outputs }` or `{ ok: false, message }`. A script's action binds by its `target`: `mcpTool://<name>`.
- **Refusals, exit `2`, before any model call.** A module that fails to import, an entry that fails the shape check, a `durable` entry, a `delegate/` name or a duplicate name prints `--tools <path>: <problem>`. A script whose actions don't match the loaded tools (a missing name, different inputs or outputs) prints the binding error, such as `mcpTool://<name> is not registered on this host`.
- Without `--tools` nothing changes: a script with no actions runs as before, and one with actions fails as it always did.
- The workspace built-ins (`read_file`, `edit_file`, `run_command`) are not registered by the CLI. A module can add them itself: `import { builtinActions } from "@specsesh/agent/node"; export default ({ workspace }) => builtinActions({ workspace });`.
- From code, `registryHost(registry, { workspace, signal? })` from `@specsesh/agent/durable` turns a registry (`createActionRegistry(actions)`) into `{ actionHost, toolHost }`: pass `actionHost` to `run()` and `toolHost` as the pi port's `tools`.
- **`--provider claude-code` with `--tools` or `--mcp`** offers a step's tools (`reasoning.actions`) to Claude Code through a local MCP bridge, `mcpBridge()` from `@specsesh/agent/node`. Claude Code calls them itself, in its own loop, possibly in parallel (the pi loop runs one at a time). Each call is still checked against its offer's schema, bound inputs win, and it runs on this host; `toolCalls` are in arrival order. A tool step defaults `--max-turns` to 16; reaching it ends the step `cut-short`.
- From code, `createClaudeCodeReasoningPort({ model, tools, bridge: mcpBridge() })`; `tools` without `bridge` throws a `TypeError`. `@specsesh/agent/claude-code` exports the bridge types (`BridgeTool`, `BridgeReply`, `BridgeHandler`, `ToolBridge`, `ToolBridgeFactory`) and `BRIDGE_SERVER` (`"agentscript"`).
- **Durable runs too.** `specsesh durable run`/`resume --provider claude-code` with `--tools` or `--mcp` offer a step's tools the same way, with each call run and checkpointed by the harness: see [Durable tool steps](../providers/claude-code.md#durable-tool-steps).

## MCP servers (`--mcp`)

A script's actions can also call the tools of MCP servers, with no module:

```bash
specsesh agent run issue.agent --mcp .mcp.json --provider ollama --model qwen3.5:latest
```

- `--mcp <file>` (repeatable) works beside or instead of `--tools`. The file is JSON with a top-level `mcpServers` object, the shape of Claude Code's `.mcp.json`, so an existing one works unchanged. The servers of every file are merged.
- **A server** is `{ command, args?, env?, cwd? }` (stdio) or `{ url, headers? }` (Streamable HTTP). An optional `type` of `stdio` or `http` is checked against the shape; `sse` is refused.
- **`${VAR}` and `${VAR:-default}`** in any string expand from the environment, so keys stay out of the file (`"Authorization": "Bearer ${GITHUB_TOKEN}"`). An unset variable with no default is an error naming the server and the variable. A stdio server gets the SDK's default environment plus its own `env`, not the whole parent environment.
- **Naming.** Each tool becomes the action `<server>/<tool>`, targeted as `mcpTool://github/create_issue`. Server names must match `^[A-Za-z0-9_-]+$` and must not be `delegate`. A tool name that doesn't match `^[A-Za-z0-9_.-]+$` is skipped.
- **Inputs** are the tool's required scalar parameters only: `string`, `number`, `integer` (as `number`) and `boolean`. A required parameter of any other type skips the tool. Optional parameters are never sent.
- **Outputs** are the scalar fields of the tool's `outputSchema`, read from `structuredContent`, when it declares them all scalar. Otherwise a single `text` output: the result's text items joined with `\n`.
- **Errors.** An `isError` result or a transport error answers `ok: false` with the server's text.
- **Kind and replay** come from the annotations: `readOnlyHint` gives `read`, replaying `safe` only when `idempotentHint` is also set. Anything else is `command`, replaying `unsafe`.
- **Before any model call** every server is connected and listed. A server that fails to start, hand-shake or list within 30 s exits `2`, naming it. A bad file, or a server name repeated across files, exits `2` with `--mcp <file>: <problem>`. Each skipped tool prints on stderr as `mcp: skipped <server>/<tool>: <reason>`.
- Every connection is closed when the command ends, on every path.
- From code, `mcpTools(servers, options?)` from `@specsesh/agent/node` connects the same `mcpServers` object and returns `{ actions, skipped, close }`: pass `actions` to `createActionRegistry`, and call `close()` when done.

## Task scripts

A script used by `specsesh task` must keep the task contract:

- **Seeded:** `task_id`, `task_text`, `proposal`, `design`, `deltas`, `carried` (strings) and `iteration` (number). `delete_granted` (boolean) and `changed` (files changed since the loop started) are seeded only if declared.
- **Read back:** `met` (boolean), `unmet`, `next_action` (`retry`, `amend-spec` or `ask`), `question`, `amend_path` and `amend_text` (strings).

A script that breaks the contract is refused at start, naming each variable. `specsesh agent show task` is the reference implementation.
