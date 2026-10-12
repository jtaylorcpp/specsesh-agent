# Actions: letting an agent do work

A script's model steps can only talk. Actions are how a script reads files, edits them, runs commands and calls your own code. By the end of this guide you will be able to declare an action in a script, call it deterministically or hand it to the model, register the built-in actions (`read_file`, `edit_file`, `run_command`, `run_checks`, `delegate_claude_code`), write a host action of your own, and know exactly what happens to each kind of action when the process dies mid-call.

## Prerequisites

Actions run in a durable host on Node. Install the package and the durable peers:

```bash
npm install @specsesh/agent
npm install @earendil-works/pi-ai @earendil-works/pi-durable @earendil-works/chord
```

Node 22.19 or newer. You should already have opened a `Harness` and run a script; if not, read [Durable agents on Node](03-durable-agents.md) first. `delegate_claude_code` also needs the `claude` binary on your `PATH`. A Cloudflare host does not run actions yet (see [Agents on Cloudflare](05-cloudflare.md)).

## The pieces

An action has two halves that must agree:

- **The script declares it.** Inside a `subagent`, an `actions:` block names the action, types its inputs and outputs, and points at a host tool with `target: "mcpTool://<name>"`.
- **The host provides it.** A `HostAction` with that `<name>` carries the same inputs and outputs, a replay policy and an `execute` function.

When a run is created, every declared action is checked against the host's registry, all at once, before anything runs. A typo or a type mismatch is refused up front, not discovered halfway through.

## Declare an action in a script

```
config:
    agent_name: "weather"

system:
    instructions: |
        You are a terse weather desk.

variables:
    city: mutable string = "Oslo"
    temperature_c: mutable number = 0
    conditions: mutable string = ""

subagent lookup:
    description: "Look up the weather, without the model"

    actions:
        lookup_weather:
            description: "Current weather for a city"
            inputs:
                city: string
            outputs:
                temperature_c: number
                conditions: string
            target: "mcpTool://lookup_weather"

    reasoning:
        instructions: ->
            run @actions.lookup_weather
                with city = @variables.city
                set @variables.temperature_c = @outputs.temperature_c
                set @variables.conditions = @outputs.conditions
```

Save this as `weather.agent`. The later scripts in this guide are fragments: a full script also has `config` and `system` blocks, as above.

- `lookup_weather:` under `actions:` is the script's name for the action. You refer to it as `@actions.lookup_weather`. It does not have to equal the host name; the `target` does that job. In this guide they match.
- `inputs` and `outputs` map names to `string`, `number` or `boolean`. Nothing else.
- `target: "mcpTool://lookup_weather"` names the host action. The host must register exactly that name.

Two rules about `run`:

- Each `with <input> = <expression>` is evaluated when the run reaches it, so it sees every earlier `set`. A value of the wrong type stops the run as a failed action, before the host is called.
- Every `set @variables.x = @outputs.field` takes its field from the host's result. They are staged together and applied together. If a field is missing, or is not a string, number or boolean, the action fails and none of them is set.

A failed action ends the run `failed`, and the variables the subagent had changed are rolled back to their values from before it began.

## `run` or `reasoning.actions`

There are two ways to call an action, and they belong to two different kinds of subagent.

**`run` is deterministic.** The script decides, the model is not involved. The subagent above never makes a model request. The host is called once per `run`, and the call lands in `RunResult.actions`.

**`reasoning.actions` hands the action to the model as a tool.** The model decides whether to call it, and how often.

```
variables:
    bytes_written: mutable number = 0
        description: "bytes the last append wrote"

subagent note:
    description: "Append a note"

    actions:
        append_note:
            description: "Append a line to a notes file"
            inputs:
                path: string
                line: string
            outputs:
                bytes: number
            target: "mcpTool://append_note"

    reasoning:
        instructions: ->
            | Record that the build is green.
        actions:
            append: @actions.append_note
                with path = "NOTES.md"
                with line = ...
                set @variables.bytes_written = @outputs.bytes
```

- `append:` is the tool name the model sees. `@actions.append_note` is the action it runs.
- `with line = ...` leaves the input to the model. `with path = "NOTES.md"` binds it: the model cannot change it, and it does not appear in the tool's parameters.
- The `set` takes its field from the **last successful** call to that tool. A tool the model never called, or whose calls all failed, sets nothing, and that is not a failure.
- A call that fails (the host answers `ok: false`) goes back to the model as an error result it can read and react to. The step carries on.
- The calls are recorded on the step: `result.steps[i].outcome.toolCalls`, each with `name`, `inputs`, `ok`, `outputs` and, if the host attached one, a `record`.

On the Claude Code provider a step can offer at most one tool, and a structured step already offers `submit_result`, so a step that offers actions needs an API provider ([Choosing a model](03-durable-agents.md#choosing-a-model)). `run` makes no model request and works anywhere.

A subagent is one or the other. A `run` beside a prompt line is refused before the run starts, as unsupported by this runtime. To act and then reason, use two subagents and list both in `entry`. The first fills variables, the second's prompt reads them.

## The host side

A host action is an object:

| Field | Meaning |
|---|---|
| `name` | The `<name>` of `mcpTool://<name>`. |
| `kind` | `"read"`, `"edit"`, `"command"` or `"delegate"`. `"read"` changes nothing. |
| `inputs`, `outputs` | Name to `"string"`, `"number"` or `"boolean"`. Must equal what the script declares. |
| `replay` | `"safe"` or `"unsafe"`: what recovery does with an interrupted call. See [Replay after a crash](#replay-after-a-crash). |
| `execute(inputs, { workspace, signal })` | Does the work. Returns an `ActionResult`. |

An `ActionResult` is one of:

- `{ ok: true, outputs, record? }`: `outputs` is an object holding every field the script's `set` lines read.
- `{ ok: false, message, record? }`: the action failed, with a message. For a `run`, the run ends failed. For a model-called tool, the model sees the message.

If `execute` throws, the throw becomes `{ ok: false, message: error.message }`.

You collect actions in a registry and install the extensions built from it. This is the whole wiring, with the built-ins:

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { agentScriptExtensions, builtinActions, createActionRegistry, runScript } from "@specsesh/agent/durable";

const workspace = "/path/to/repo";
const actions = createActionRegistry(
  builtinActions({ workspace, allow: ["pnpm", "node"], checks: ["pnpm test"] }),
);

const models = createModels();
models.setProvider(claudeCodeProvider());

const registry = createRegistry();
const { run, step } = agentScriptExtensions({ actions, workspace });
registry.install(run);    // instead of AgentScript
registry.install(step);   // instead of AgentScriptStepExtension

const harness = await Harness.open(await openNodeSqliteStorage("runs.sqlite"), { models, registry }, context);
const result = await runScript(
  harness,
  readFileSync("fix.agent", "utf8"),
  { model: { provider: "claude-code", modelId: "claude-haiku-4-5" }, entry: ["fix", "check"] },
  context,
);
console.log(result.kind, result.actions.map((a) => `${a.call.action}: ${a.result.ok}`));
await harness.close(context);
```

Three things to know:

- `createActionRegistry` throws if two actions share a name.
- The plain `AgentScript` and `AgentScriptStepExtension` register no actions. A script that declares one is refused by them, with the action reported as not registered. So is every script run through `agentscript-durable`, which installs the plain pair. Run action scripts from code like the above, or through the task loop ([Executing changes with the task loop](07-task-loop.md)).
- A process that resumes a run must install the same actions. Build the registry in one function and call it from both the starting and the resuming code.

## The built-ins

`builtinActions(options)` returns five host actions bound to one workspace.

| Action | Inputs → outputs | `kind` | `replay` |
|---|---|---|---|
| `read_file` | `path` → `content` | read | safe |
| `edit_file` | `path`, `content` → `ok` | edit | safe |
| `run_command` | `command` → `exit_code`, `output` | command | unsafe |
| `run_checks` | `task_id` → `passed`, `output` | command | unsafe |
| `delegate_claude_code` | `instructions` → `ok`, `summary` | delegate | unsafe |

The options:

| Option | Meaning |
|---|---|
| `workspace` | Required. The directory every built-in is confined to and runs in. |
| `allow` | First words `run_command` may run (and the shell commands the delegate may use). Empty or absent: nothing runs. |
| `checks` | Commands `run_checks` runs, in order. Empty or absent: `run_checks` refuses. |
| `timeoutMs` | Per command, and per delegate run, before it is killed. Default 600000 (ten minutes). |
| `claudeBinary` | The Claude Code binary. Default `claude` on your `PATH`. |
| `delegateModel` | `--model` for the delegate. Unset: Claude Code's own default. |
| `delegateContext` | Files appended to the delegate's system prompt, in order, resolved against the workspace. A missing file fails the action without starting Claude Code. |

How each behaves:

- **`read_file`** answers the file's text, or `ok: false` naming the missing file.
- **`edit_file`** replaces the whole file, creating parent directories inside the workspace. To change one line, read the file, change the text, write it all back.
- **`run_command`** splits the command on whitespace into an argument list. There is no shell and no quoting. `pnpm test; rm -rf src` starts `pnpm` with four arguments and nothing else. The first word must be in `allow`, or the answer is `ok: false` and nothing starts. A command that exits non-zero is **not** a refusal: you get `ok: true` with its `exit_code` and `output`, so the script can read the failure.
- **`run_checks`** runs every command in `checks`, in order, even after one fails, and answers `passed: true` only if all exited 0 and none timed out. `output` holds each command, its output and its exit code. With no `checks` configured it answers `ok: false` ("no checks configured") instead of passing vacuously. `task_id` is only recorded in the action's summary.
- **`delegate_claude_code`** writes `instructions` to the stdin of `claude -p --safe-mode`, with file tools and a `Bash` allowed only for the first words in `allow`, and `--permission-mode dontAsk` so it never waits for a prompt. It runs in the workspace. `ANTHROPIC_API_KEY` and `CLAUDECODE` are removed from its environment, so it signs in as you, on your subscription; it never uses `--bare` and never reads Claude Code's OAuth token. The answer is `ok: true` with `ok` (did Claude Code succeed) and `summary` (its result text), so a failed delegate is something the script reads, not a crash.

A script that calls `run_checks` declares it as [the package README](../packages/agent/README.md#actions-let-a-script-do-work) shows: `task_id: string` in, `passed: boolean` and `output: string` out. Declare every input and output the host action has, with the same types, or the binding check refuses the script (below).

### Records

An action that changes or runs something attaches a `record` to its result: an ontology `Action` and the `Evidence` for it, both from `@specsesh/agent/openspec`. `edit_file` records the edit and a diff:

```json
{
  "action": { "kind": "edit", "summary": "create src/greet.ts", "refs": ["src/greet.ts"] },
  "evidence": [{ "kind": "diff", "files": [{ "path": "src/greet.ts", "change": "added" }] }]
}
```

`run_command` and `run_checks` record a `command` action with one `check` evidence per command (its exit code and output). The delegate records a `delegate` action. `read_file` records nothing. The record rides along in `RunResult.actions[n].result.record` for a `run`, and in `toolCalls[n].record` for a model call. The interpreter keeps it as given and never reads it.

## Write your own action

Two examples, simplest first. Both go beside the built-ins in the same registry.

### A read-only lookup

A `lookup_weather` that the script above calls. It reads nothing from the workspace, changes nothing, and gives the same answer if run twice, so it is `kind: "read"` and `replay: "safe"`.

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { agentScriptExtensions, createActionRegistry, runScript, type HostAction } from "@specsesh/agent/durable";

const temperatures: Record<string, number> = { Lisbon: 21, Oslo: 4 };

const lookupWeather: HostAction = {
  name: "lookup_weather",
  kind: "read",
  inputs: { city: "string" },
  outputs: { temperature_c: "number", conditions: "string" },
  replay: "safe",
  async execute(inputs) {
    const city = String(inputs["city"]);
    const temperature = temperatures[city];
    if (temperature === undefined) return { ok: false, message: `no weather for ${city}` };
    return { ok: true, outputs: { temperature_c: temperature, conditions: temperature > 15 ? "mild" : "cold" } };
  },
};

const models = createModels();
models.setProvider(claudeCodeProvider());
const registry = createRegistry();
const { run, step } = agentScriptExtensions({ actions: createActionRegistry([lookupWeather]), workspace: "." });
registry.install(run);
registry.install(step);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
const result = await runScript(
  harness,
  readFileSync("weather.agent", "utf8"),
  { model: { provider: "claude-code", modelId: "claude-haiku-4-5" }, entry: ["lookup"], variables: { city: "Lisbon" } },
  context,
);
console.log(result.kind, result.variables);   // completed { city: "Lisbon", temperature_c: 21, conditions: "mild" }
await harness.close(context);
```

`inputs` arrive as `Readonly<Record<string, VariableValue>>`, so read them with `String(...)` or `Number(...)`. The binding check has already guaranteed the names and declared types, so the cast is a formality.

### A write with a record, confinement and `unsafe` replay

`append_note` appends a line to a file in the workspace, the action the `reasoning.actions` script above calls. Appending twice writes the line twice, so it is `unsafe`. It uses `confine` (exported from `@specsesh/agent/durable`) so the model cannot write outside the workspace, and attaches a record so the change is traceable.

```ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { confine, type ActionRecord, type HostAction } from "@specsesh/agent/durable";

export const appendNote: HostAction = {
  name: "append_note",
  kind: "edit",
  inputs: { path: "string", line: "string" },
  outputs: { bytes: "number" },
  replay: "unsafe",
  async execute(inputs, { workspace }) {
    const target = confine(workspace, String(inputs["path"]));
    if (typeof target !== "string") return target;          // the refusal, already an ActionResult
    const text = `${String(inputs["line"])}\n`;
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, text);
    const path = relative(workspace, target);
    const record: ActionRecord = {
      action: { kind: "edit", summary: `append to ${path}`, refs: [path] },
      evidence: [{ kind: "diff", files: [{ path, change: "modified" }] }],
    };
    return { ok: true, outputs: { bytes: Buffer.byteLength(text) }, record };
  },
};
```

The record is optional. The built-ins check theirs against the ontology schemas before returning; if you want the same guarantee, import `Action`, `Evidence` and `check` from `@specsesh/agent/openspec` and call `check(Action, record.action)`. A host action whose kind is `"read"` has no matching ontology `Action` (only `edit`, `command` and `delegate` exist), so reads attach none.

## The binding check

When a run is created, `checkBindings` compares each declared action with the registry:

- the `mcpTool://<name>` must be registered;
- the declared input names must be exactly the host action's input names, and so for outputs;
- each declared type must equal the registered type.

Any mismatch refuses the run with an `ActionBindingError` that names the subagent, the action and **every** mismatch found. `startScript` and `runScript` reject before a task exists, so no step and no action has run. The message for a missing tool:

```text
the script's actions do not match what this host provides, so the run was not started:
  - subagent "lookup", action lookup_weather: mcpTool://lookup_weather is not registered on this host
```

Other mismatches read `input city is declared number, registered string`, `input city is not one the host action has` and `output conditions of the host action is not declared`. The last one is the easy one to hit: a script may not leave out an output the host action produces.

To handle it in code, catch the error and read `problems`:

```ts
import type { Context } from "@earendil-works/chord";
import type { Harness } from "@earendil-works/pi-durable";
import { ActionBindingError, startScript } from "@specsesh/agent/durable";

export async function startChecked(harness: Harness, source: string, context: Context) {
  try {
    return await startScript(harness, source, { entry: ["fix"] }, context);
  } catch (error) {
    if (!(error instanceof ActionBindingError)) throw error;
    for (const problem of error.problems) {
      console.error(`${problem.subagent}.${problem.action}: ${problem.mismatches.join("; ")}`);
    }
    throw error;
  }
}
```

## Replay after a crash

A `run` is executed in the run task's `act` phase, which commits in this order:

1. The call is reached. The checkpoint becomes `act` with `intent: null`.
2. Before anything runs, the checkpoint is committed again with the intent: `{ replay: "safe" }` or `{ replay: "unsafe" }`, taken from the action.
3. The action runs once.
4. Its result is committed together with the move on to the next phase.

If the process dies, the stored checkpoint tells the next process how far this got:

| The process died | On resume |
|---|---|
| Before step 2 | The intent is still `null`; the action has not started, so it runs. |
| After step 2, before step 4, action `safe` | The action runs **again** with the same inputs. |
| After step 2, before step 4, action `unsafe` | The action does **not** run. The call is applied as `{ ok: false, message: "<action> was interrupted and not re-run" }`, using the script's name for the action. The run ends `failed`, and the report is in `result.actions`. |
| After step 4 | The result is committed; nothing is repeated. |

An unsafe interrupted action is a decision for a person: the work may have happened, may be half done, or may not have started, and the framework cannot know. A model-called tool follows the same rule through pi-durable's tool replay: an interrupted `safe` call runs again, an interrupted `unsafe` one is reported and never silently repeated.

Pick the policy by one question: if this call runs twice with the same inputs, is the world the same as if it ran once?

- Reading a file, looking something up, replacing a file's whole content: yes, `safe`. (`read_file` and `edit_file` are safe for this reason.)
- Appending, sending a message, creating a ticket, running a command, calling a delegate: no, `unsafe`. When in doubt, choose `unsafe`.

`execute` also receives an `AbortSignal` as `signal`. It fires when the run is aborted; pass it to `fetch` and to child processes, as the built-ins do.

## Workspace confinement

Every `execute` receives `workspace`, the directory you passed to `agentScriptExtensions`. What that does and does not promise:

- `read_file` and `edit_file` refuse an absolute path, a `..` that escapes, and a path that leaves the workspace through a symlink, however deep. The answer is `ok: false` with "`<path>` is outside the workspace; nothing was read or written". Your own actions get the same check from `confine(workspace, path)`, which returns the resolved path, or an `ActionResult` refusal to return as is.
- `run_command` and `run_checks` use the workspace as the working directory. That is **not** a sandbox. Whatever program you allow can do whatever that program does: `pnpm` can run any script in the package. Allow only first words you would run yourself, and prefer `run_checks` with a fixed list over a general `run_command`.
- `delegate_claude_code` runs Claude Code in the workspace with `Bash` limited to your `allow` list. What its file tools may touch is Claude Code's own permission model; this package does not add to it.

## Next

- [Durable agents on Node](03-durable-agents.md): the harness, the run task and resuming.
- [Agents on Cloudflare](05-cloudflare.md): what a Cloudflare host runs today (no actions yet).
- [The OpenSpec ontology](06-openspec.md): `Action`, `Evidence` and the other types a record uses.
- [Executing changes with the task loop](07-task-loop.md): a loop built from `run_checks`, the delegate and these same actions.
- [Writing Agent Script](01-agent-script.md) and [Running a script](02-running-scripts.md): the language and the interpreter underneath.
