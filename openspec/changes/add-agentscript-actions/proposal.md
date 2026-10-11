## Why

An Agent Script agent here can only think. Steps are reasoning only: the port carries no tools, a durable step offers only `submit_result`, and the claude-code path runs with `--tools ""`. An agent that implements a task has to read files, edit them and run tests. Agent Script already has the construct for that, **actions**, and the pinned Agentforce dialect parses and lints it cleanly. This runtime refuses it as outside the subset. This change brings actions into the subset, binds them to capabilities the host provides, and runs them durably.

## What Changes

- **Action definitions in the subset.** A subagent's `actions:` block declares each action: `description`, scalar `inputs` and `outputs`, and a `target`. The only target scheme this runtime executes is **`mcpTool://<name>`**, which names a tool the host provides. Every other scheme the dialect accepts (`flow://`, `apex://`, …) is refused by name, as unsupported by this runtime.
- **Two ways to call an action**, both already valid Agent Script:
  - **Deterministic:** `run @actions.<name>` in a procedure, with `with <input> = <expression>` and `set @variables.<v> = @outputs.<f>`. The program calls it, never the model. A subagent that runs actions holds only logic lines and `run` statements.
  - **Model-callable:** a `reasoning.actions:` entry, `<tool>: @actions.<name>`, with `with <input> = ...` for inputs the model fills, or an expression to bind them. The step offers these to the model as tools. `set … = @outputs.<f>` under an entry applies the outputs of that tool's last call.
- **The step machine yields actions.** For a deterministic `run`, `next` returns an action call instead of a request; `applyAction` folds its result in. Like a request, a pending call is part of the JSON `RunState`, so a host can checkpoint it.
- **Requests can offer tools.** `ReasoningRequest` gains an optional `tools` list of declarations (name, description, input schema), and `StepOutcome.answered` gains the tool calls made. The core still holds no executor and runs no loop; a port that cannot run tools refuses a request that offers them.
- **A host action registry** (`@specsesh/agent/durable`): host actions by name, each with a kind matching the ontology's Action (`read`, `edit`, `command`, `delegate`), schemas and an executor.
  - **Built-ins, confined to a workspace directory:** `read_file`, `edit_file`, `run_command` (allowlisted), `run_checks` (configured commands; passed means every exit code was 0), and `delegate_claude_code` (headless Claude Code with tools, in the workspace, keeping this project's hard lines).
  - **Checked up front:** a script's declared inputs and outputs are checked against the registry when a run starts, before anything executes.
- **Durable execution of actions.** Deterministic calls run in their own task phase; model-callable tools run as pi-durable tools in the step's conversation. Every execution records an ontology `Action` and its `Evidence` (`CheckEvidence` for commands, `DiffEvidence` for edits).

## Out of scope

- The task agent itself: `add-task-agent`, which depends on this change.
- Real MCP servers. `mcpTool://` names resolve in the host's registry only; connecting MCP servers is a later change.
- Nested or list-valued action inputs and outputs. They stay scalar, like variables.
- Exactly-once side effects. An interrupted action that is not safe to repeat is reported, never silently re-run (pi-durable's replay rule); making it exactly-once is out of scope.

## Capabilities

- **New:** `actions/registry` (host actions, built-ins, binding checks, evidence).
- **Modified:**
  - `core/subset` (actions, `run`, model-callable actions, the `mcpTool://` target);
  - `core/composition` (calls, inputs, outputs into variables);
  - `core/step-machine` (action calls in `next` and `RunState`, `applyAction`);
  - `core/reasoning-port` (tool offers, recorded tool calls, refusal by ports without tools);
  - `durable/run-task` (an action phase, tools in step conversations);
  - `package/distribution` (the durable layer may import `src/openspec`, so host actions build their records with the ontology's `Action` and `Evidence`).

## Impact

- Depends on `package-specsesh-agent` (entry points) and `add-openspec-ontology` (`Action`, `Evidence` types).
- `pi/claude-code` keeps refusing multi-tool requests. On a subscription, a script acts through the `delegate_claude_code` action instead of model-callable tools.
