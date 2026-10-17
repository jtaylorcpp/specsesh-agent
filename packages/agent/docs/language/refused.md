# What the interpreter refuses before the first model call, and how to rewrite it.

Every refusal happens before anything runs, so a run that reaches the model was checked whole.
`specsesh agent check <file>` makes the same checks with no model and prints `file:line:col
message` for each problem. The checks run in this order, and the first stage that finds a problem
ends the check:

1. **Error diagnostics** from the dialect: `UnparsedDocumentError`. The parser recovers from
   syntax errors instead of throwing, so running anyway would execute what the recovery invented.
   Warnings and hints never refuse.
2. **No readable document**: `UnreadableDocumentError`.
3. **Constructs outside the subset**: `UnsupportedConstructError`, with every finding, each saying
   the construct *is unsupported by this runtime*. It may well be valid Agent Script.
   `specsesh agent language subset` lists what is supported.
4. **Undeclared variables**: `UndeclaredVariableError`, checked on every branch.
5. **Bad options** from the host: `UndeclaredOverrideError`, `UnknownSubagentError`,
   `NoEntrySubagentError` (no subagent to run), `InvalidChoicesError`, and `NoActionHostError` for
   a `run` with no action host.

## Common refusals and their rewrites

The refused forms below are plain text; each rewrite is a checked script.

**`elif`, or an `if` inside an `if`.** The dialect reports both as errors.

```text
            if @variables.score > 8:
                set @variables.level = "high"
            elif @variables.score > 4:
                set @variables.level = "medium"
```

Join the conditions with `and`, `or` and `not` instead:

```agent
variables:
    score: mutable number = 0
    level: mutable string = "low"

subagent grade:
    description: "Grade the score, without the model"

    reasoning:
        instructions: ->
            if @variables.score > 8:
                set @variables.level = "high"
            if @variables.score > 4 and not @variables.score > 8:
                set @variables.level = "medium"
```

**Lower-case booleans.** `true` and `false` are errors: *"'true' is not a valid value in
AgentScript. Did you mean 'True' (capitalized)?"* Write `True` and `False`.

**`@output`.** Not a namespace the dialect knows. Write `@outputs.field`, and only as the whole
value of a `set`.

**A top-level `topic`**, or `start_agent`, `connection` and the like: refused as unsupported. Write
`subagent <name>:` with a `description`.

```text
topic t:
    description: "d"
```

**Another namespace.** Reading `@context`, `@user` or anything but `@variables` is refused, in a
condition and in an interpolation (`{!@context.user}`). Pass the value in as a variable:

```agent
variables:
    user: mutable string = ""
        description: "set by the host at start"

subagent hello:
    description: "Greet the user"

    reasoning:
        instructions: ->
            | Greet {!@variables.user}.
```

**A variable with no default**, or a default that isn't a literal: refused. Give every variable a
literal default.

```text
variables:
    ok: mutable string
```

**An action target other than `mcpTool://`** (`flow://`, `apex://`, …): refused. Bind the action to
a host tool by name.

```text
            target: "flow://Do"
```

**A subagent's own `system:` block**: refused. There is one document-level `system`.

Also refused:

- an action input or output typed other than `string`, `number` or `boolean`;
- a `with` for an input the action doesn't have, or a missing or repeated one;
- a `run` of an action the subagent doesn't declare;
- a prompt line or `reasoning.actions` beside a `run`;
- `reasoning.actions` with no prompt line, or an entry named `run`;
- a `set` to any namespace but `@variables`;
- a file with no subagent.
