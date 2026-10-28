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
- `--provider claude-code` runs `run @actions.x` statements, but a step that offers tools (`reasoning.actions`) still fails `invalid_request` on it. Use a pi provider for those steps.

## Task scripts

A script used by `specsesh task` must keep the task contract:

- **Seeded:** `task_id`, `task_text`, `proposal`, `design`, `deltas`, `carried` (strings) and `iteration` (number). `delete_granted` (boolean) and `changed` (files changed since the loop started) are seeded only if declared.
- **Read back:** `met` (boolean), `unmet`, `next_action` (`retry`, `amend-spec` or `ask`), `question`, `amend_path` and `amend_text` (strings).

A script that breaks the contract is refused at start, naming each variable. `specsesh agent show task` is the reference implementation.
