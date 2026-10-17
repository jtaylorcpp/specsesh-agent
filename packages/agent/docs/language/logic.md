# Logic lines (`if`, `else`, `set`) run in code on every run and never reach the model.

A line in a procedure that doesn't start with `|` is a logic line. The interpreter evaluates it
itself, so it costs no model turn.

```agent
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

| Construct | Notes |
|---|---|
| `if <condition>:` / `else:` | `else` is optional. |
| `set @variables.x = <value>` | The target must be a declared variable. |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | Strict: `1 == "1"` is false. Nothing is coerced. |
| `and`, `or`, `not` | Both sides of `and` are always evaluated; `or` stops at a true left side. |
| literals | `"text"`, `42`, `True`, `False`. |
| `@variables.x` | The only namespace an expression reads. |

At run time:

- Lines run in source order, so a later line sees what an earlier `set` wrote.
- A bare string, number or variable works as a condition: a string is true when it's not empty, a
  number when it's not zero.
- An `if` branch can hold prompt lines. Only the branch that holds is kept, so logic picks which
  text the model sees:

```agent
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

- A subagent with only logic lines does its whole job in the interpreter, with no model request.
- If a later step of the same subagent fails, its `set`s are rolled back with it.

`elif` is not supported, and neither is an `if` inside another `if` (the dialect reports that as an
error). Join conditions with `and` and `or`, or make the second decision in the next subagent.
