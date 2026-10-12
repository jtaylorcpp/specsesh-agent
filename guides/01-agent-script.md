# Writing Agent Script

After this guide you can write an Agent Script file that `@specsesh/agent` will run: declare typed
variables, write steps that talk to a model, write steps that never do, take structured results
from the model into variables, and declare actions. You will know what the runtime refuses and why,
and you will be able to parse, lint and edit scripts from code with the authoring API.

Agent Script is Salesforce's agent language. `@specsesh/agent` uses it as an authoring format and
runs **an enumerated subset** of it with its own interpreter. Nothing is compiled. A script that is
valid Agent Script but outside the subset is refused before the run starts, by name and position.

## Prerequisites

```bash
npm install @specsesh/agent
```

The authoring API needs no peers and no credentials. Running a script needs a model; that is the
next guide, [Running a script](02-running-scripts.md). Node 22.19 or newer.

Every Agent Script block below is checked: it parses with no error diagnostics and passes the
runtime's subset scan.

## The shape of a script

A script is four kinds of top-level block, in this order by convention: `config`, `system`,
`variables`, and one or more `subagent` blocks. Anything else at the top level (`topic`, `start_agent`,
`connection` and so on) is outside the subset.

```
config:
    agent_name: "greeter"

system:
    instructions: |
        You are a greeter. Answer in one short line.

variables:
    name: mutable string = "World"
        description: "who to greet"

subagent greet:
    description: "Write the greeting"

    reasoning:
        instructions: ->
            | Write a one-line greeting for {!@variables.name}.
```

Indentation is four spaces and is significant. This script has one step. Running it sends one
request to the model and finishes.

A **subagent** is one step (or one deterministic program). A run walks the subagents you name, in
the order you name them. By default it runs only the first subagent in the file. There is no
routing between subagents in the subset: the host picks the order, with the `entry` option.

## config

`config` names the agent. The dialect requires `agent_name` or `developer_name`. `agent_type` and
`description` are also accepted.

```
config:
    agent_name: "spec-author"
    description: "Drafts specs"
```

Nothing in the runtime reads `config`. It is identity for the author and for whatever else handles
the file.

## system.instructions

`system.instructions` is the agent's standing character. It travels to the model as its own
channel (the system prompt), never mixed into a step's prompt. Use a multiline block with `|`.

```
system:
    instructions: |
        You help the author write specs.
        Be brief. Never invent requirements.
```

System instructions are fixed text. They are not composed against run state, so
`{!@variables.x}` in them is passed through as written, not filled in. Put anything that depends on
state in a step's prompt lines.

A subagent cannot carry its own `system:` block. It is refused.

## variables

Variables are the run's state. Each has a type, a literal default and, usually, a description.

```
variables:
    stage: mutable string = "proposal"
        description: "which stage is live"
    attempts: mutable number = 0
        description: "how many tries so far"
    approved: mutable boolean = False
        description: "set once the author signs off"
    change_id: string = "OS-1"
```

- **Types** are `string`, `number` and `boolean`.
- **Defaults** are literals only: a quoted string, a number, `True` or `False`. A default that
  reads another variable is refused. So is a variable with no default.
- **Booleans are `True` and `False`**, capitalised. `true` is a lint error: *"'true' is not a valid
  value in AgentScript. Did you mean 'True' (capitalized)?"*
- **`description`** is optional, goes on the line below, and is the only property a variable may
  carry.
- **`mutable`** marks a variable your script sets. The bare form (`change_id: string = "OS-1"`) is
  also accepted.

The default is the run's starting value. The host can override any declared variable when it starts
the run (see [Running a script](02-running-scripts.md)); it cannot create a new one.

## subagent and description

```
subagent draft:
    description: "Fill the proposal"
```

`description` is required: the dialect reports a subagent without it as an error. A subagent may
carry `description`, `reasoning` and `actions`. Nothing else.

## reasoning.instructions and prompt lines

`reasoning.instructions: ->` opens a procedure: a list of lines that run top to bottom. A line that
starts with `|` is a **prompt line**: text the model is asked to act on.

```
subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the change description.
            | Write a short proposal for it.
```

Prompt lines are joined with newlines, in source order, into one prompt. One subagent makes at most
one model request. A subagent with no prompt line that survives its conditions makes no request.

## Interpolation

`{!@variables.name}` inside a prompt line is replaced by the variable's current value when the step
is composed.

```
variables:
    stage: mutable string = "proposal"
    change_id: string = "OS-1"

subagent draft:
    description: "Fill the current stage"

    reasoning:
        instructions: ->
            | Draft the {!@variables.stage} for change {!@variables.change_id}.
```

The `!` is part of the syntax. `{@variables.stage}` is not an error in the runtime's eyes: the
dialect reports it only as an information-level diagnostic, the run proceeds, and the model sees
the braces and the text literally. Lint your scripts and read the diagnostics.

Only `@variables` can be interpolated. `{!@context.user}` and other namespaces are refused.

## Logic lines

Lines that do not start with `|` are **logic lines**. The program evaluates them on every run, in
code. They never reach the model and cost no model turn.

```
variables:
    attempts: mutable number = 0
    approved: mutable boolean = False
    stage: mutable string = "proposal"
    note: mutable string = ""

subagent route:
    description: "Pick the next stage, without the model"

    reasoning:
        instructions: ->
            if not @variables.approved and @variables.attempts >= 2:
                set @variables.stage = "review"
            else:
                set @variables.stage = "proposal"
            if @variables.stage == "review" or @variables.attempts > 5:
                set @variables.note = "escalate"
```

What is supported:

| Construct | Notes |
|---|---|
| `if <condition>:` / `else:` | An `else` branch is optional. |
| `set @variables.x = <value>` | The target must be a declared variable. |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | Equality is strict: `1 == "1"` is false. Nothing is coerced. |
| `and`, `or`, `not` | Both sides of `and` are always evaluated. |
| literals | `"text"`, `42`, `True`, `False`. |
| `@variables.x` | The only namespace an expression can read. |

A bare string, number or variable works as a condition. Strings are true when non-empty, numbers
when non-zero.

Not supported: `elif`, and an `if` nested inside another `if` (the dialect reports that as an
error). Combine conditions with `and` and `or`, or put the second decision in the next subagent.

A logic line can sit between prompt lines. Because `set` runs in order, a later line sees what an
earlier one wrote:

```
variables:
    name: mutable string = "World"
    excited: mutable boolean = False

subagent sign_off:
    description: "Close the program"

    reasoning:
        instructions: ->
            if @variables.name == "World":
                set @variables.excited = True
            if @variables.excited:
                | Write an enthusiastic one-line sign-off.
            else:
                | Write a calm one-line sign-off.
```

A subagent made only of logic lines does its whole job inside the interpreter. The run moves on to
the next one without a model call.

## Structured output

A prompt line plus `set @variables.x = @outputs.field` makes the step answer with a structured
result. The model's reply is a JSON object, and the named fields are copied into variables.

```
variables:
    severity: mutable string = ""
        description: "low, medium or high"
    urgent: mutable boolean = False
        description: "whether someone should be paged"
    score: mutable number = 0

subagent triage:
    description: "Judge the report"

    reasoning:
        instructions: ->
            | Judge this bug report: it crashes on save.
            set @variables.severity = @outputs.severity
            set @variables.urgent = @outputs.urgent
            set @variables.score = @outputs.score
```

You do not write the result schema. It is derived from the `set` lines: each field takes the
declared type of the variable it feeds, every field is required, and no other fields are allowed.
The script above makes the step ask for this:

```json
{
  "type": "object",
  "properties": {
    "severity": { "type": "string" },
    "urgent": { "type": "boolean" },
    "score": { "type": "number" }
  },
  "required": ["severity", "urgent", "score"],
  "additionalProperties": false
}
```

The rules:

- The structured result is the **only** way the model writes a variable. The text of its reply is
  never parsed for a value.
- `@outputs` is plural. `@output` is a lint error.
- `@outputs.field` is allowed in exactly one position: the whole value of a `set`. You cannot test
  it in an `if`, because the field does not exist until the step has run.
- If the result is missing, or a field is missing or not a string, number or boolean, the step
  fails and **no** variable is set. Values are applied together, never half.
- A step that asks for a structured result needs a prompt. If every prompt line sits behind a
  condition that did not hold, the run stops with `EmptyPromptError` rather than ask the model
  nothing and pay for the answer.

The host can limit a string variable to a set of values with the `choices` option of `run` and
`start`. It becomes an `enum` in the schema and is checked on the way back.

## subagent.actions

An action is something the **host** does for the script: read a file, run the tests. You declare
it with typed inputs and outputs and bind it to a host tool with an `mcpTool://` target.

```
subagent check:
    description: "Run the checks, without the model"

    actions:
        run_checks:
            description: "Run the configured checks"
            inputs:
                task_id: string
            outputs:
                passed: boolean
                output: string
            target: "mcpTool://run_checks"
```

- Inputs and outputs are `<name>: <type>` and nothing else. Types are `string`, `number` and
  `boolean`. No defaults, no descriptions.
- `target` must be `mcpTool://<name>`. That scheme is the only one the runtime executes. `flow://`,
  `apex://` and the rest are refused.
- The action's key (`run_checks`) is how the script refers to it: `@actions.run_checks`. It only
  declares; calling it is the next two sections.

The script never runs an action itself. The host maps each tool name to code, and checks every
binding before anything runs. [Host actions](04-actions.md) covers that side.

## run: a deterministic call

`run @actions.x` calls an action **from the program**. The model has no part in it. `with` binds an
input from an expression, and `set … = @outputs.field` copies an output into a variable.

```
variables:
    task_id: mutable string = "2.4"
    checks_passed: mutable boolean = False
    report: mutable string = ""

subagent check:
    description: "Run the checks, without the model"

    actions:
        run_checks:
            description: "Run the configured checks"
            inputs:
                task_id: string
            outputs:
                passed: boolean
                output: string
            target: "mcpTool://run_checks"

    reasoning:
        instructions: ->
            run @actions.run_checks
                with task_id = @variables.task_id
                set @variables.checks_passed = @outputs.passed
                set @variables.report = @outputs.output
```

Rules for `run`:

- Give every declared input exactly one `with`. A missing, repeated or unknown input is refused.
- A `set` under a `run` takes `@outputs.<field>` and the field must be a declared output.
- Inputs are type-checked when the call is made, with no coercion. A string given to a `number`
  input fails the run and the call is never sent to the host.
- A subagent that holds a `run` is a **program**: only logic lines and `run` statements. No prompt
  line, no `set` from `@outputs` outside a `run`, no `reasoning.actions`. Split model work and
  action work into separate subagents.
- You may `run` only actions the same subagent defines.

If the call fails, or the host's reply lacks an output a `set` needs, the run ends `failed` and the
subagent's variables roll back to what they were before it began.

## reasoning.actions: model-callable tools

`reasoning.actions` offers an action to the model as a tool. The model decides whether and when to
call it, and fills the inputs you mark with `...`.

```
variables:
    edited: mutable boolean = False

subagent fix:
    description: "Edit the file"

    actions:
        edit_file:
            description: "Replace a file's content"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"

    reasoning:
        instructions: ->
            | Make src/greet.ts export greet(name) returning "Hello, <name>!".
        actions:
            edit: @actions.edit_file
                with path = ...
                with content = ...
                set @variables.edited = @outputs.ok
```

- The entry's key (`edit`) is the tool name the model sees. It cannot be `run`, which is a keyword.
- `with p = ...` leaves the input to the model. `with p = @variables.x` (or any expression) binds
  it; the model does not see bound inputs.
- A `set` under an entry takes the output of the **last successful call** to that tool. If the
  model never called it, nothing is set, and that is not a failure.
- The step needs at least one prompt line. Tools offered with nothing to do are refused.

A tool loop needs a host that runs the calls. The plain ports in
[Running a script](02-running-scripts.md) make one request and refuse a step that offers tools. The
durable host runs them: see [Host actions](04-actions.md) and
[Durable agents](03-durable-agents.md).

## What is refused, and how

Everything that can refuse does so **before the first model call**. A run that reaches the model
has already been checked whole. The checks run in this order:

1. **Error diagnostics.** Any error-severity diagnostic from the dialect throws
   `UnparsedDocumentError`. It carries `diagnostics` and a message with one line per error and a
   1-based position. The parser recovers from syntax errors instead of throwing, so running anyway
   would execute whatever the recovery invented. Warnings and hints never refuse.
2. **No readable root.** `UnreadableDocumentError`.
3. **Unsupported constructs.** `UnsupportedConstructError`, carrying every finding, not just the
   first. Each has `construct`, `range`, `where` and a `message`.
4. **Undeclared variables.** A reference to an undeclared `@variables.x` is normally an error
   diagnostic from the dialect (*"'nope' is not defined in variables"*), so it arrives as step 1.
   `UndeclaredVariableError` is the backstop. Nothing resolves an undeclared name to an empty
   value. It is checked on every branch, including ones a run would never take.
5. **Bad options.** `UndeclaredOverrideError` for a starting value on a name the script never
   declared, `UnknownSubagentError` and `NoEntrySubagentError` for a bad `entry`,
   `InvalidChoicesError` for bad `choices`.

Every unsupported-construct message says the construct is *unsupported by this runtime* and that it
may well be valid Agent Script. It is a statement about what the runtime implements, not about your
file. Typical refusals:

```text
topic t:
    description: "d"
```

A top-level `topic` (or `start_agent`, `connection`, and so on) is refused: *"topic at 7:1, in the
document, is unsupported by this runtime."*

```text
            | hi {!@context.user}
```

Reading any namespace but `@variables`, here `@context`, is refused.

```text
            target: "flow://Do"
```

Any action target scheme but `mcpTool` is refused: *"target flow:// at 16:21, in subagent "a", …"*

```text
variables:
    ok: mutable string
```

A variable with no default is refused: *"ok (a variable with no declared value) …"*

Also refused: a non-literal variable default, an action input typed other than string, number or
boolean, a `with` for an input the action does not have, a `run` of an action the subagent does not
define, a prompt line beside a `run`, `reasoning.actions` with no prompt line, `@outputs` anywhere
but the whole value of a `set`, and a `set` to any namespace but `@variables`.

## The dialect's spelling

The interpreter follows the dialect. A script it runs is one your editor can save without errors.
Where the two could disagree, the dialect wins.

| Write this | Not this |
|---|---|
| `True`, `False` | `true`, `false` (error) |
| `{!@variables.x}` | `{@variables.x}` (text goes to the model unsubstituted) |
| `@outputs.field` | `@output.field` (error: not a recognized namespace) |
| `subagent name:` | `topic name:` (deprecated by the dialect, refused by the runtime) |
| `if … : … else: …` | `elif`, or an `if` inside an `if` (error) |
| `description: "…"` on every subagent | no description (error) |

`SUPPORTED_CONSTRUCTS` is the one list of what the runtime runs, exported from
`@specsesh/agent/authoring` and `@specsesh/agent/interpreter`. Each entry has an `id`, a `summary`
and a `probe` script. The refusal messages, the README and the conformance check all read it.

## The authoring API

`@specsesh/agent/authoring` parses and lints. It accepts the whole language, not just the subset,
and it never compiles. It is error-tolerant: a half-typed script gives diagnostics and a
recovered tree, never an exception.

- `analyze(source)` returns `{ source, parsed, diagnostics }`.
- `parse(source)` returns `{ document, diagnostics }`, where `document` is a `Document`.
- `new Document(source)` holds text with an undo history. The **text is the document**; the
  analysis is derived from it and recomputed on every change.
- `Document` has `source`, `analysis`, `edit(next)`, `undo()`, `redo()`, `canUndo` and `canRedo`.
  `edit`, `undo` and `redo` return the document, so they chain. An edit that changes nothing adds
  no history entry.

Diagnostics follow LSP severity: `1` is an error, `2` a warning, `3` information, `4` a hint. Only
errors stop a run.

```ts
import { Document, parse } from "@specsesh/agent/authoring";

const source = `config:
    agent_name: "greeter"

system:
    instructions: "Be brief."

variables:
    name: mutable string = "World"
        description: "who to greet"

subagent greet:
    description: "Write the greeting"

    reasoning:
        instructions: ->
            | Greet {!@variables.name}.
`;

const { document, diagnostics } = parse(source);
console.log(diagnostics.length, "diagnostics");

// Break it: a lower-case boolean is an error in this dialect.
document.edit(source.replace('"World"', "true"));
for (const d of document.analysis.diagnostics) {
	if (d.severity === 1) console.log(`error at line ${d.range.start.line + 1}: ${d.message}`);
}

// Take it back.
document.undo();
console.log(document.source === source, document.canRedo); // true true
```

To ask "would this run?" from code, call `scanDocument` from `@specsesh/agent/interpreter` on
`analyze(source).parsed`. It returns the list of unsupported constructs, empty when there are none.
Or call `start(source)` and let it throw the refusal.

```ts
import { analyze } from "@specsesh/agent/authoring";
import { scanDocument, start } from "@specsesh/agent/interpreter";

declare const source: string; // …your script text

const unsupported = scanDocument(analyze(source).parsed);
for (const u of unsupported) console.log(u.where, "-", u.construct);

try {
	start(source);
} catch (error) {
	if (error instanceof Error) console.log(error.name); // e.g. "UnsupportedConstructError"
}
```

`scanDocument` answers only "is every construct one the runtime implements". It does not say the
document is well formed. That is what the diagnostics are for, and `start` checks both.

## Next

- [Running a script](02-running-scripts.md): run what you wrote, on a model or on a stub.
- [Durable agents](03-durable-agents.md): runs that survive a crash.
- [Host actions](04-actions.md): the host side of `mcpTool://` targets.
- [Cloudflare](05-cloudflare.md): run scripts in a Durable Object.
- [The OpenSpec ontology](06-openspec.md) and [the task loop](07-task-loop.md): scripts that drive
  spec work.
