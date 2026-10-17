# `run @actions.x` calls an action from the program, with no model involved.

```agent
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

- `with <input> = <expression>` binds each input. Give every declared input exactly one `with`. A
  missing, repeated or unknown input is refused.
- `set @variables.x = @outputs.<field>` copies an output. The field must be a declared output.
- You can `run` only actions the same subagent declares ([actions](actions.md)).
- A subagent holding a `run` is a program: only logic lines and `run` statements. No prompt line, no
  `set` from `@outputs` outside a `run`, no `reasoning.actions`. To act and then reason, use two
  subagents and list both in `entry`.

At run time:

- The walk reaches the `run` and evaluates its `with` expressions there, so they see every earlier
  `set`. Inputs are type-checked with no coercion. A value of the wrong type fails the run before
  the host is called.
- The host is called once per `run`, and the call is recorded in the run's `actions`.
- The `set`s are staged and applied together. If the call fails, or the host's answer lacks an output
  a `set` reads, the run ends `failed` and the subagent's variables roll back to their values from
  before it began.
- The subagent makes no model request.

**A host provides the actions.** `specsesh agent run` has no action host, so a script whose entry
subagents hold a `run` is refused before it starts (`NoActionHostError`: no `actionHost`). Run it
from code: give the interpreter's `run()` an `actionHost`, or use a durable host with
`builtinActions` from `@specsesh/agent/node` and `runScript` from `@specsesh/agent/durable`.
`run_checks` above is one of the built-ins; `specsesh agent actions` lists them all.
