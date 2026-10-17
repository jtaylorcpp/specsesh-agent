# Actions are host tools a subagent declares; `reasoning.actions` offers them to the model.

An action is something the host does for the script: read a file, run the tests. The script only
declares it, with typed inputs and outputs and an `mcpTool://` target naming the host's tool.

```agent
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

Declaring, under `actions:`:

- The key (`edit_file`) is the script's name for the action: `@actions.edit_file`.
- `inputs` and `outputs` are `<name>: <type>`, with types `string`, `number` and `boolean`. No
  defaults, no descriptions.
- `target` must be `mcpTool://<name>`. It's the only scheme this runtime runs. `flow://`, `apex://`
  and the rest are refused.

Offering, under `reasoning.actions:`:

- The entry's key (`edit`) is the tool name the model sees. It can't be `run`, which is a keyword.
- `with p = ...` leaves the input to the model. `with p = <expression>` binds it, and the model
  doesn't see it.
- A `set` under the entry takes the output of the last successful call to that tool. If the model
  never called it, nothing is set, and that isn't a failure.
- The step needs at least one prompt line. Only the same subagent's own actions can be offered.

At run time, the model decides whether to call the tool and how often. A call that fails goes back
to the model as an error result it can react to, and the step carries on.

**A host provides the actions.** `specsesh agent run` has no action host: its pi port makes one
request per step and fails a step that offers tools. A durable host runs the tool loop. It
registers host actions under the target names, such as `builtinActions` from
`@specsesh/agent/node`, and runs the script with `runScript` from `@specsesh/agent/durable`. It
checks every declared action against its registry (names, inputs, outputs, types) before
anything runs. `specsesh agent actions` lists the built-in actions with their inputs and outputs.
To call an action from the program instead of the model, see [run](run.md).
