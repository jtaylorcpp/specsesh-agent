# Variables are the run's typed state, each declared with a literal default.

```agent
variables:
    stage: mutable string = "proposal"
        description: "which stage is live"
    attempts: mutable number = 0
        description: "how many tries so far"
    approved: mutable boolean = False
        description: "set once the author signs off"
    change_id: string = "OS-1"

subagent draft:
    description: "Draft the current stage"

    reasoning:
        instructions: ->
            | Draft the {!@variables.stage} for change {!@variables.change_id}.
```

- **Types** are `string`, `number` and `boolean`.
- **Defaults** are literals only: a quoted string, a number, `True` or `False`. A variable with no
  default is refused, and so is a default that reads another variable.
- **Booleans** are `True` and `False`, capitalised. `true` is an error in the dialect.
- **`description`**, on the line below, is optional and is the only property a variable may have.
- **`mutable`** marks a variable the script sets. The bare form (`change_id: string = "OS-1"`) is
  also accepted, and the interpreter treats both the same.

At run time:

- A run starts from the defaults. The host may override any declared variable at start
  (`--var name=value` on `specsesh agent run`). An override for a name the script never declared
  is refused with `UndeclaredOverrideError`. A run cannot create a variable.
- Every reference to `@variables.x` must name a declared variable, on every branch, even one the
  run would never take. Nothing resolves an undeclared name to an empty value.
- Variables change only through `set` lines: from a [logic line](logic.md), a step's
  [structured result](outputs.md) or an action's outputs ([run](run.md), [actions](actions.md)).
- The run reports the final values. The script text is not rewritten unless the host asks for it
  (`persistVariables`).
- A host can limit a string variable to a set of values with the `choices` option. A
  structured result must then pick one of them.
