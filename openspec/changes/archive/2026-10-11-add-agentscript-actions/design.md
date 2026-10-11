## Context

Probed against the pinned dialect (`@sf-agentscript/agentforce-dialect` 2.53.0) on 2026-10-11:
- A subagent `actions:` block, a procedural `run @actions.x … with … set …`, and a `reasoning.actions:` entry with `with x = ...` all lint with **zero diagnostics**.
- `target` is required, and must use one of the dialect's schemes. `host://`, `tool://` and bare names are lint **errors**. The accepted schemes include `mcpTool`, which this runtime adopts.
- `run` is a keyword: a reasoning-action entry named `run` is a syntax error.
- Today's scan refuses exactly `actions` (both positions) and `RunStatement`.

## The two call forms

```
subagent check:
    actions:
        run_checks:
            description: "Run the checks configured for this task"
            inputs:
                task_id: string
            outputs:
                passed: boolean
                output: string
            target: "mcpTool://run_checks"
    reasoning:
        instructions: ->
            run @actions.run_checks                      # deterministic: the program calls it
                with task_id = @variables.task_id
                set @variables.checks_passed = @outputs.passed

subagent act:
    actions: { read_file, edit_file, run_command }       # definitions, as above
    reasoning:
        instructions: ->
            | Carry out this plan: {!@variables.plan}
        actions:                                         # model-callable: offered as tools
            edit: @actions.edit_file
                with path = ...                          # ... = the model fills it
                with content = ...
```

**A deterministic subagent** holds logic lines and `run` statements only. A `run` in a subagent that also has prompt lines, or `@outputs` sets that come from the step, is refused by the scan. That keeps the boundary between "the program acts" and "the model answers" at a subagent, so a subagent is never half a model step and half a program.

## Step machine

```
NextStep = { type: "request", request, state }
         | { type: "action", call: ActionCall, state }       // new
         | { type: "done", result }
ActionCall   { subagent, action, tool, inputs: Record<string, VariableValue>, index }   // tool = the mcpTool:// name
ActionResult { ok: true, outputs: Record<string, VariableValue> } | { ok: false, message }
applyAction(source, state, result): RunState
```

`next` walks a deterministic subagent's statements in order. At each `run` it stops and returns the call, with its inputs evaluated now. The resume point (`index`) travels in `RunState.awaiting`. `applyAction` then:
1. applies the outputs to variables, staged and applied together, like a structured result;
2. continues the walk on the next `next`.

A failed action (`ok: false`) stops the run. It is recorded as an `ActionReport { subagent, call, result }` in `RunState.actions` / `RunResult.actions` (not in `steps`, and with no failure category: it never reached a model). A pending call is an `AwaitingAction { subagent, call, variables, before }`, told apart from `AwaitingStep` by `call` in place of `request`. It rolls back that subagent's own logic effects only, the same rule as `awaiting.before`. `next` stays pure: the same state returns the same call.

## Port

```
ReasoningRequest.tools?: ToolOffer[]
ToolOffer  { name, description, inputSchema, action, bound: Record<string, VariableValue> }   // inputSchema: the ... inputs only
StepOutcome.answered.toolCalls?: { name, inputs, outputs }[]
```

- **The core never executes a tool.** It offers declarations and reads back what was called. Model-callable `set … = @outputs.f` applies the outputs of the **last** call to that tool; a tool never called sets nothing.
- **Ports that can't run tools refuse.** The pi port is single-shot and the claude-code provider allows at most one tool. Either answers a request with `tools` as failed, category `invalid_request`, with a message saying tools need the durable host.
- **No round bound in the core, still.** The bound lives in the durable host, which owns the loop.

## Host registry

```
HostAction { name, kind: "read" | "edit" | "command" | "delegate",
             inputs: Record<string, "string"|"number"|"boolean">, outputs: …, execute(inputs, ctx) }
ActionRegistry = Map<name, HostAction>
```

- **Binding is checked whole, at start:** every `mcpTool://<name>` must be registered, and the script's declared input and output names and types must match the registered ones exactly. A mismatch refuses the run before anything executes, naming the action.
- **Built-ins:**

  | Name | Kind | Contract |
  |---|---|---|
  | `read_file` | read | `{ path } → { content }`; the path resolves inside the workspace (no `..` escape, no symlink out) |
  | `edit_file` | edit | `{ path, content } → { ok }`; same confinement; records `DiffEvidence` |
  | `run_command` | command | `{ command } → { exit_code, output }`; split into an argv and run **without a shell**, so `pnpm test; rm -rf src` can't slip a second command past the allowlist; the first word must be on the allowlist; cwd is the workspace; timeout → `{ ok: false }` with `timed out`; records `CheckEvidence` |
  | `run_checks` | command | `{ task_id } → { passed, output }`; runs the configured check commands; `passed` iff all exit 0; no checks configured → `{ ok: false }`, never a vacuous pass |
  | `delegate_claude_code` | delegate | `{ instructions } → { ok, summary }`; `claude -p --safe-mode` in the workspace with its edit and bash tools; never `--bare`; `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped; never touches the OAuth token |

- **Every execution that changes or runs something emits an ontology `Action`** (`kind`, `summary`, `refs`) and its evidence, carried opaquely by the core in `ActionResult.record` / `toolCalls[].record`. `read_file` changes nothing and records no `Action` (the ontology's `Action.kind` has no `read`).
- **Hosts install with `agentScriptExtensions({ actions, workspace })`.** The plain extension exports behave as an empty registry, so a script with actions run through them is refused by the binding check.

## Durability

pi-durable's tool rule, used for both call forms: each tool declares `replay: "safe" | "unsafe"` (default `unsafe`), its intent is recorded before it executes, and on recovery an interrupted `safe` call runs again while an interrupted `unsafe` one does not.

- **Each host action declares its replay policy:**
  - `safe`: `read_file`, and `edit_file` (it writes the same content again);
  - `unsafe`: `run_command`, `run_checks` and `delegate_claude_code`.
- **Model-callable tools** are pi-durable tools in the step conversation, alongside `submit_result`, registered with their action's replay policy and bounded by pi-durable's turn loop. An interrupted `unsafe` call settles as an error result the model sees, and can choose to call again.
- **Deterministic calls** run in a new `agentscript.run` phase, `act`, which records the call before executing it. On resume an interrupted `safe` call runs again. An interrupted `unsafe` call settles as a failed action whose message says it was interrupted and not re-run, so the run stops there and is never silently repeated.
- **Nothing runs twice without the script seeing it.** Repeating is explicit: the model calls again, or the task loop's next iteration does.

## Risks

- **A model with an allowlisted shell is powerful.** The allowlist, the workspace confinement and the absence of network-specific tools are the guard. `delegate_claude_code` inherits Claude Code's own permission model.
- **The dialect could reject `mcpTool://` in a later upstream release.** Exact pins and the conformance check catch that at the bump.
