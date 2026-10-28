## Why

Once the pi port can run tools (`add-pi-tool-loop`), a script's actions still have nothing to call from the command line:
- `specsesh agent run` passes no `actionHost`, so a script with a `run @actions.x` statement throws `NoActionHostError`;
- `specsesh durable run` installs the plain extensions, whose registry is empty, so any script that defines an action is refused at creation (`openspec/parked.md`).

The library has the tool shape, `HostAction`, but a CLI user has no way to hand one in. The simplest source is a JavaScript module the user writes, holding exactly the actions a library host would register.

## What Changes

- `--tools <module>` (repeatable) on `agent run`, `durable run` and `durable resume`. Each module's default export, or its `tools` export, is a `HostAction[]` or a function of `{ workspace }` returning one, sync or async. Modules resolve from the working directory.
- Each loaded action is shape-checked: name, kind, scalar inputs and outputs, replay and `execute`. A bad module, a duplicate name or a `durable` action exits `2`, naming the module and the problem, before any model call.
- `--workspace <dir>` (default the working directory) is the `workspace` passed to each module function and to every `execute`.
- `agent run` checks the script's actions against the loaded tools with `checkBindings`, exiting `2` with the `ActionBindingError` text on a mismatch. It then passes a run host (`run` statements) and a tool host (offered tools) built from the same registry.
- `durable run` installs `agentScriptExtensions({ actions, workspace })` with the loaded tools, so bindings are checked at creation as in any library host. `resume` must be given the same `--tools`. It re-checks the stored script against them before resuming and exits `2` naming what is missing.
- A new `registryHost(registry, { workspace, signal? })` in `./durable` turns an `ActionRegistry` into `{ actionHost, toolHost }` for a one-shot `run()`, so library consumers get the same adapter.
- The provider option `--provider claude-code` with a step that offers tools still fails `invalid_request`, and the usage and docs say so.

## Out of scope

- MCP servers as a tool source: `add-mcp-tools`, stacked on this change.
- Tools in the task loop's `agentscript.config.json`. The task CLI builds its registry from its own config, and that is a separate change.
- Registering the workspace built-ins (`read_file`, `edit_file`, `run_command`) from the durable CLI (parked). A module can register them itself with `builtinActions(workspace)`.
- `durable` (child-task) actions from a module.
- Sandboxing a module. It runs in the CLI's process with the user's permissions, like any script they run.

## Capabilities

- **Modified:**
  - `pi/cli`;
  - `durable/cli`;
  - `actions/registry`.

## Impact

- `packages/agent/src/bin/tools.ts` (new): `loadTools(paths, { workspace })`, shared by both bins.
- `packages/agent/src/bin/agentscript-pi.ts` and `agentscript-durable.ts`: the flags, the usage text and the wiring.
- `packages/agent/src/durable/tool-host.ts` (new): `registryHost`, exported from `./durable`, runtime-neutral, importing `PiToolHost` from `src/pi` (allowed by the layer test).
- Tests in `__tests__/pi/cli.test.ts`, `__tests__/durable/cli.test.ts` and `__tests__/durable/tool-host.test.ts`, with fixture modules under `__tests__/fixtures/tools/`.
- `docs/llm/agent.md` and `docs/llm/durable.md`, a `packages/agent/examples/tools/` example (a module and a script), and README `## Run it once`.
