# A subagent is one step of the run; the host picks which ones run, in order.

```agent
variables:
    topic: mutable string = "tides"
    summary: mutable string = ""

subagent research:
    description: "Summarise the topic"

    reasoning:
        instructions: ->
            | Summarise what causes {!@variables.topic} in two sentences.
            set @variables.summary = @outputs.summary

subagent explain:
    description: "Explain it to a child"

    reasoning:
        instructions: ->
            | Rewrite this for a ten-year-old: {!@variables.summary}
```

- `subagent <name>:` opens a subagent. Its name is how the host refers to it.
- `description` is required. The dialect reports a subagent without one as an error.
- A subagent may have `description`, `reasoning` and `actions`, and nothing else.
- `reasoning.instructions: ->` holds the procedure: [prompt lines](prompts.md),
  [logic lines](logic.md) and [`run` statements](run.md). `reasoning.actions` offers
  [actions](actions.md) to the model.

At run time:

- **Which subagents run.** By default, only the first one in the file. The host passes `entry`, a
  name or a list of names, to run others in that order: `specsesh agent run <file> --entry research
  --entry explain` runs both subagents above. An `entry` naming a subagent the file doesn't declare
  is refused with `UnknownSubagentError`. There is no routing or hand-off between subagents.
- **One request at most.** A subagent makes at most one model request. A subagent whose procedure
  is only logic lines makes none, and the run moves on.
- **State carries over.** Every subagent reads and writes the same variables, so a later one sees
  what an earlier one set, as `explain` reads `summary` above.
- **Failure.** If a subagent's step fails, the run ends `failed`, and that subagent's variables go
  back to their values from before it began. Subagents that finished before it stay committed.
- Every subagent is checked before the run starts, including ones it will never enter.
