# Writing Agent Script

After this guide you can write an Agent Script file that `@specsesh/agent` will run: declare typed
variables, write steps that talk to a model, write steps that never do, take structured results
from the model into variables, and declare actions. You will know what the runtime refuses and why,
and you will be able to parse, lint and edit scripts from code with the authoring API.

Agent Script is Salesforce's agent language. `@specsesh/agent` uses it as an authoring format and
runs **an enumerated subset** of it with its own interpreter. Nothing is compiled. A script that is
valid Agent Script but outside the subset is refused before the run starts, by name and position.

> **The rules live in the reference topics.** This guide explains why each piece exists and how
> the pieces fit together. The syntax, the rules and the full examples are in
> [`packages/agent/docs/language/`](../packages/agent/docs/language/), one file per topic. Those
> files are the single source: they ship with the package, their examples are checked, and
> `specsesh agent language <topic>` prints them (`specsesh agent language` lists the topics).
> New to the language? The [language tour](00-language-tour.md) builds one script step by step.

## Prerequisites

```bash
npm install @specsesh/agent
```

The authoring API needs no peers and no credentials. Running a script needs a model; that is the
next guide, [Running a script](02-running-scripts.md). Node 22.19 or newer.

## The shape of a script

A script is four kinds of top-level block: `config` names the agent, `system` sets its standing
character, `variables` declares the state the run carries, and one or more `subagent` blocks do the
work. Each `subagent` is one step, or one deterministic program. A run walks the subagents the host
names, in order, and there is no routing between them: the host picks the order.

```agent
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

This script has one step. Running it sends one request to the model and finishes. What a run does,
from the checks to the end state, is in [overview](../packages/agent/docs/language/overview.md).

## config

`config` is identity for the author and for whatever else handles the file. Nothing in the run
reads it. The fields it takes are in [config](../packages/agent/docs/language/config.md).

## system.instructions

`system.instructions` is the agent's standing character. It travels in its own channel, the system
prompt, so a step's prompt never has to repeat it. Because it is fixed text, anything that depends on
run state belongs in a step's prompt lines instead. See
[system](../packages/agent/docs/language/system.md).

## variables

Variables are the run's state: typed, each with a literal starting value, and the only thing a step
can write. The host can override a declared variable when it starts the run (see
[Running a script](02-running-scripts.md)), but it cannot invent new ones, so the file states the
whole shape of the state up front. Types, defaults and spelling are in
[variables](../packages/agent/docs/language/variables.md).

## subagent

A subagent is the unit the host schedules. Its `description` says what the step is for, its
`reasoning` holds the procedure, and its `actions` declare what the host may do for it. Which
subagents run, and how state carries between them, is in
[subagents](../packages/agent/docs/language/subagents.md).

## Prompt lines

A procedure mixes two kinds of line. Lines starting with `|` are **prompt lines**, the text the
model is asked to act on. The ones that survive are joined into a single request, so one subagent
costs at most one model turn. See [prompts](../packages/agent/docs/language/prompts.md).

## Interpolation

`{!@variables.name}` in a prompt line puts a variable's current value into the text, which is how
state reaches the model. The `!` matters: without it the dialect raises only an information-level
diagnostic, the run proceeds, and the model sees the braces literally, so read your diagnostics.
See [interpolation](../packages/agent/docs/language/interpolation.md).

## Logic lines

Every other line is a **logic line**: `if`, `else` and `set`, evaluated by the interpreter in code.
Logic lines cost no model turn. They decide which prompt text the model sees, and a subagent made only
of logic lines does its whole job without a model. The supported constructs, and why there is no
`elif`, are in [logic](../packages/agent/docs/language/logic.md).

## Structured output

`set @variables.x = @outputs.field` is how the model writes state. You don't write a schema. The
interpreter derives one from the `set` lines and the variables' types, and the reply is applied
whole or not at all. Prose is never parsed for a value. See
[outputs](../packages/agent/docs/language/outputs.md).

## Actions

An action is something the **host** does for the script: read a file, run the tests. The script
only declares it, with typed inputs and outputs and an `mcpTool://` target. The host maps each
target to code and checks every binding before anything runs; [Host actions](04-actions.md) covers
that side. A declared action can be used in two ways:

- **From the program**, with `run @actions.x`. The call is deterministic, the model has no part in
  it, and the subagent holding it is a program with no prompt. See
  [run](../packages/agent/docs/language/run.md).
- **By the model**, offered as a tool under `reasoning.actions`. The model decides whether and when
  to call it, and fills the inputs you leave open. See
  [actions](../packages/agent/docs/language/actions.md).

Both need a host that runs the calls. The plain ports in [Running a script](02-running-scripts.md)
make one request per step and have no action host. The durable host has one: see
[Host actions](04-actions.md) and [Durable agents](03-durable-agents.md).

## What is refused, and how

Everything that can refuse does so **before the first model call**, so a run that reaches the model
has already been checked whole, every branch included. A refusal of a construct is a statement
about what this runtime implements, not about your file: it may well be valid Agent Script. The
interpreter follows the dialect's spelling, so a script it runs is one your editor can save without
errors. A top-level `topic`, for one, is deprecated by the dialect and refused here: write
`subagent` instead. The order of the checks, the common refusals and their rewrites are in
[refused](../packages/agent/docs/language/refused.md). `specsesh agent check <file>` runs the same
checks with no model.

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

What the refusals carry:

- `UnparsedDocumentError` has `diagnostics`, and a message with one line per error and a 1-based
  position.
- `UnsupportedConstructError` carries every finding, not just the first. Each has `construct`,
  `range`, `where` and a `message`, such as *"topic at 7:1, in the document, is unsupported by this
  runtime."*
- A reference to an undeclared `@variables.x` normally arrives as an error diagnostic from the
  dialect (*"'nope' is not defined in variables"*), so as `UnparsedDocumentError`.
  `UndeclaredVariableError` is the backstop.

`SUPPORTED_CONSTRUCTS` is the one list of what the runtime runs, exported from
`@specsesh/agent/authoring` and `@specsesh/agent/interpreter`. Each entry has an `id`, a `summary`
and a `probe` script. The refusal messages, the README and the conformance check all read it, and
`specsesh agent language subset` prints it.

## Next

- [Running a script](02-running-scripts.md): run what you wrote, on a model or on a stub.
- [Durable agents](03-durable-agents.md): runs that survive a crash.
- [Host actions](04-actions.md): the host side of `mcpTool://` targets.
- [Cloudflare](05-cloudflare.md): run scripts in a Durable Object.
- [The OpenSpec ontology](06-openspec.md) and [the task loop](07-task-loop.md): scripts that drive
  spec work.
