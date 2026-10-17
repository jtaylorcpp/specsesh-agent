# `set @variables.x = @outputs.field` makes the step answer with a structured result that sets typed variables.

```agent
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

You don't write the result schema. The interpreter derives it from the `set` lines: one field per
line, typed as the variable it feeds, every field required, no others allowed. The step above asks
for:

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

At run time:

- The structured result is the only way the model writes a variable. The text of its reply is
  never parsed for a value.
- If the result is missing, or a field is missing or of the wrong type, the step fails and no
  variable is set. The values are applied together, never some of them.
- A `choices` option from the host turns a string field into an `enum`, and checks the answer
  against it.
- A step that needs a structured result needs a prompt. If every prompt line sits behind a
  condition that doesn't hold, the run stops with `EmptyPromptError`.

`@outputs` is plural; `@output` is an error. `@outputs.field` is allowed only as the whole value of
a `set`. It can't be tested in an `if`, because the field doesn't exist until the step has run.
Under a [`run`](run.md) or a [reasoning action](actions.md), the same `set` form reads the
action's outputs instead.
