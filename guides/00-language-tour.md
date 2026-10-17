# A tour of Agent Script

This tour builds one script, `tour.agent`, a small bug-report triager, in six steps. Each step adds
one construct and shows **the whole file**, not a diff, so you can copy any step into `tour.agent`
and run it. Each step links to the reference topic in
[`packages/agent/docs/language/`](../packages/agent/docs/language/) that has the full rules.

The commands are `specsesh`'s. With the package installed (`npm install specsesh`) run them as
shown; otherwise prefix each with `npx`.

- `specsesh agent check tour.agent` runs every check a run makes, with no model, and exits 0 when
  the script would start.
- `specsesh agent run tour.agent` runs it on a model. The default is pi's
  `anthropic/claude-haiku-4-5`, which needs `ANTHROPIC_API_KEY`. Add `--provider claude-code` to run
  each step through your own `claude` binary on your Claude subscription instead.

## Step 1: a prompt

```agent
config:
    agent_name: "tour"

system:
    instructions: |
        You triage bug reports for a small developer tool. Be brief and concrete.

subagent triage:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Triage this bug report: the CLI crashes with ENOENT when run outside a git repo.
```

`config` names the agent ([config](../packages/agent/docs/language/config.md)). `system.instructions`
is the agent's standing character, sent as the system prompt
([system](../packages/agent/docs/language/system.md)). The one `subagent` is one step: its
`description` says what it is for, and the lines starting with `|` under `reasoning.instructions`
are the prompt the model is asked to act on
([subagents](../packages/agent/docs/language/subagents.md),
[prompts](../packages/agent/docs/language/prompts.md)). Running it is one model request.

Try it:

```bash
specsesh agent check tour.agent
specsesh agent run tour.agent
```

## Step 2: variables

```agent
config:
    agent_name: "tour"

system:
    instructions: |
        You triage bug reports for a small developer tool. Be brief and concrete.

variables:
    report: mutable string = "The CLI crashes with ENOENT when run outside a git repo."
        description: "the bug report to triage"

subagent triage:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Triage this bug report: {!@variables.report}
```

`variables` declares the run's state: each variable is typed, has a literal starting value, and
carries a `description` ([variables](../packages/agent/docs/language/variables.md)).
`{!@variables.report}` puts the current value into the prompt text. Keep the `!`: without it the
model sees the braces literally ([interpolation](../packages/agent/docs/language/interpolation.md)).

The run can override a declared variable with `--var name=value`, but it cannot add one.

Try it:

```bash
specsesh agent check tour.agent
specsesh agent run tour.agent --var "report=Saving a file with a space in its name deletes it."
```

## Step 3: structured output

```agent
config:
    agent_name: "tour"

system:
    instructions: |
        You triage bug reports for a small developer tool. Be brief and concrete.

variables:
    report: mutable string = "The CLI crashes with ENOENT when run outside a git repo."
        description: "the bug report to triage"
    severity: mutable string = ""
        description: "low | medium | high"
    summary: mutable string = ""
        description: "one-sentence summary of the problem"

subagent triage:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Triage this bug report: {!@variables.report}
            | Pick a severity of low, medium or high, and write a one-sentence summary.
            set @variables.severity = @outputs.severity
            set @variables.summary = @outputs.summary
```

`set @variables.x = @outputs.field` is how the model writes state. You write no schema: the
interpreter derives one from the `set` lines and the variables' types, asks the model for exactly
those fields, and applies the reply whole or not at all
([outputs](../packages/agent/docs/language/outputs.md)). The run's output lists `severity` and
`summary` under `## variables`.

Try it:

```bash
specsesh agent check tour.agent
specsesh agent run tour.agent --var "report=Saving a file with a space in its name deletes it."
```

## Step 4: logic

```agent
config:
    agent_name: "tour"

system:
    instructions: |
        You triage bug reports for a small developer tool. Be brief and concrete.

variables:
    report: mutable string = "The CLI crashes with ENOENT when run outside a git repo."
        description: "the bug report to triage"
    severity: mutable string = ""
        description: "low | medium | high"
    summary: mutable string = ""
        description: "one-sentence summary of the problem"
    urgent: mutable boolean = False
        description: "set by logic when the severity is high"

subagent triage:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Triage this bug report: {!@variables.report}
            | Pick a severity of low, medium or high, and write a one-sentence summary.
            set @variables.severity = @outputs.severity
            set @variables.summary = @outputs.summary

subagent route:
    description: "Flag urgent reports, without the model"

    reasoning:
        instructions: ->
            if @variables.severity == "high":
                set @variables.urgent = True
            else:
                set @variables.urgent = False
```

Lines that don't start with `|` are logic lines: `if`, `else` and `set`, evaluated by the
interpreter in code, at no model cost. `route` holds only logic lines, so it does its whole job
without a model. Booleans are spelled `True` and `False`, and there is no `elif` or nested `if`
([logic](../packages/agent/docs/language/logic.md)).

The logic lives in a second subagent because `triage`'s `@outputs` arrive only after its model turn,
when its own logic lines have already run. A run starts with the first subagent only, so name both,
in order, with `--entry`. Variables carry from one to the next.

Try it:

```bash
specsesh agent check tour.agent
specsesh agent run tour.agent --entry triage --entry route --var "report=Saving a file with a space in its name deletes it."
```

## Step 5: a `run` action

```agent
config:
    agent_name: "tour"

system:
    instructions: |
        You triage bug reports for a small developer tool. Be brief and concrete.

variables:
    path: mutable string = "REPORT.md"
        description: "the file holding the bug report"
    report: mutable string = ""
        description: "the bug report to triage, read from path"
    severity: mutable string = ""
        description: "low | medium | high"
    summary: mutable string = ""
        description: "one-sentence summary of the problem"
    urgent: mutable boolean = False
        description: "set by logic when the severity is high"

subagent load:
    description: "Read the report from a file, without the model"

    actions:
        read_file:
            description: "Read one file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            run @actions.read_file
                with path = @variables.path
                set @variables.report = @outputs.content

subagent triage:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Triage this bug report: {!@variables.report}
            | Pick a severity of low, medium or high, and write a one-sentence summary.
            set @variables.severity = @outputs.severity
            set @variables.summary = @outputs.summary

subagent route:
    description: "Flag urgent reports, without the model"

    reasoning:
        instructions: ->
            if @variables.severity == "high":
                set @variables.urgent = True
            else:
                set @variables.urgent = False
```

An action is something the **host** does for the script. The script declares it under `actions:`,
with typed inputs and outputs and an `mcpTool://` target naming the host action, here the built-in
`read_file` (`path` in, `content` out; `specsesh agent actions` lists the built-ins).
`run @actions.read_file` calls it from the program: deterministically, with no model, binding each
input with `with` and taking outputs with `set` ([run](../packages/agent/docs/language/run.md)). A
subagent that holds a `run` is a program with no prompt lines, so the read gets its own subagent,
`load`, ahead of `triage`.

Try it:

```bash
specsesh agent check tour.agent
```

> **`specsesh agent run` cannot run this step.** It has no action host: it runs the script with a
> model and nothing else, so a run whose entry holds a `run` statement is refused before anything
> is dispatched, because there is no `actionHost` to carry out the call. Run it from a host that
> provides the actions.

A host registers the built-ins and runs the script through the durable host, as
[Host actions](04-actions.md) shows. With `REPORT.md` in the current directory:

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { agentScriptExtensions, createActionRegistry, runScript } from "@specsesh/agent/durable";
import { builtinActions } from "@specsesh/agent/node";

const workspace = ".";
const actions = createActionRegistry(builtinActions({ workspace }));

const models = createModels();
models.setProvider(claudeCodeProvider());

const registry = createRegistry();
const { run, step } = agentScriptExtensions({ actions, workspace });
registry.install(run);
registry.install(step);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
const result = await runScript(
  harness,
  readFileSync("tour.agent", "utf8"),
  { model: { provider: "claude-code", modelId: "claude-haiku-4-5" }, entry: ["load", "triage", "route"] },
  context,
);
console.log(result.kind, result.variables);
await harness.close(context);
```

## Step 6: actions the model can call

```agent
config:
    agent_name: "tour"

system:
    instructions: |
        You triage bug reports for a small developer tool. Be brief and concrete.

variables:
    path: mutable string = "REPORT.md"
        description: "the file holding the bug report"
    report: mutable string = ""
        description: "the bug report to triage, read from path"
    related: mutable string = ""
        description: "the last file the model read while researching"
    severity: mutable string = ""
        description: "low | medium | high"
    summary: mutable string = ""
        description: "one-sentence summary of the problem"
    urgent: mutable boolean = False
        description: "set by logic when the severity is high"

subagent load:
    description: "Read the report from a file, without the model"

    actions:
        read_file:
            description: "Read one file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            run @actions.read_file
                with path = @variables.path
                set @variables.report = @outputs.content

subagent research:
    description: "Let the model read the code the report is about"

    actions:
        read_file:
            description: "Read one file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            | This bug report came in: {!@variables.report}
            | Read the one source file most likely to hold the bug, and say which it is.
        actions:
            read: @actions.read_file
                with path = ...
                set @variables.related = @outputs.content

subagent triage:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Triage this bug report: {!@variables.report}
            | The code it most likely concerns: {!@variables.related}
            | Pick a severity of low, medium or high, and write a one-sentence summary.
            set @variables.severity = @outputs.severity
            set @variables.summary = @outputs.summary

subagent route:
    description: "Flag urgent reports, without the model"

    reasoning:
        instructions: ->
            if @variables.severity == "high":
                set @variables.urgent = True
            else:
                set @variables.urgent = False
```

`reasoning.actions` hands a declared action to the model as a tool. `read:` is the tool name the
model sees, and the model decides whether and how often to call it. `with path = ...` leaves the
input to the model; a literal would bind it so the model could not change it. The `set` takes its
field from the last successful call, and sets nothing if the model never called the tool
([actions](../packages/agent/docs/language/actions.md)). `research` asks for no structured output,
so its step offers `read` alone.

Try it:

```bash
specsesh agent check tour.agent
```

> **`specsesh agent run` cannot run this step either.** Beyond `load`'s `run` statement, which it
> refuses for want of an `actionHost`, its ports make one model request per step with no tool loop,
> so they fail a step that offers tools, `research` here. Tools need the durable host, which runs
> each call and owns the loop.

The host is the one from step 5, with every subagent in `entry`. The Claude Code provider offers at
most one tool per request, so a run whose steps offer actions is best on an API provider
([Choosing a model](03-durable-agents.md#choosing-a-model)); this one reads `ANTHROPIC_API_KEY`. See
[Host actions](04-actions.md) for what each built-in does and how a run recovers from a crash.

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { agentScriptExtensions, createActionRegistry, runScript } from "@specsesh/agent/durable";
import { builtinActions } from "@specsesh/agent/node";

const workspace = ".";
const actions = createActionRegistry(builtinActions({ workspace }));

const models = createModels();
models.setProvider(anthropicProvider());

const registry = createRegistry();
const { run, step } = agentScriptExtensions({ actions, workspace });
registry.install(run);
registry.install(step);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
const result = await runScript(
  harness,
  readFileSync("tour.agent", "utf8"),
  { model: { provider: "anthropic", modelId: "claude-haiku-4-5" }, entry: ["load", "research", "triage", "route"] },
  context,
);
console.log(result.kind, result.variables);
await harness.close(context);
```

## What you built

`tour.agent` now reads a report from a file without the model (`run`), lets the model read the code
it concerns (`reasoning.actions`), takes a typed severity and summary from it (`@outputs`), and flags
urgent reports in code (`if`/`else`), four subagents run in the order the host names. The checks
that refuse a construct this runtime doesn't implement, and their rewrites, are in
[refused](../packages/agent/docs/language/refused.md).

- More complete scripts are in [`examples/agents/`](../examples/agents/).
- `specsesh agent language` lists the reference topics, and `specsesh agent language <topic>`
  prints one, the same files this tour links to.
- [Writing Agent Script](01-agent-script.md) explains why each piece exists;
  [Running a script](02-running-scripts.md) and [Host actions](04-actions.md) cover running it.
