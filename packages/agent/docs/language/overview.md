# An Agent Script file is config, system, variables and subagents; a run walks the subagents in order.

Agent Script is Salesforce's agent language. `@specsesh/agent` runs a declared subset of it with
its own interpreter. Nothing is compiled. A script has four kinds of top-level block, by
convention in this order:

- `config` names the agent ([config](config.md)).
- `system` holds the standing instructions ([system](system.md)).
- `variables` declares the run's typed state ([variables](variables.md)).
- One or more `subagent` blocks, each one step of the run ([subagents](subagents.md)).

Indentation is four spaces and is significant.

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

## What a run does

1. **Check, before anything runs.** Error diagnostics, constructs outside the subset and undeclared
   variables are all refused before the first model call ([refused](refused.md)).
   `specsesh agent check <file>` runs the same checks with no model.
2. **Start.** Variables take their declared defaults, then any starting values the host passes.
3. **Walk the entry subagents.** By default only the first subagent in the file runs. The host
   names others, in order, with `entry` (`--entry` on `specsesh agent run`). There is no routing
   between subagents.
4. **Each subagent** runs its procedure top to bottom. [Logic lines](logic.md) run in code. The
   [prompt lines](prompts.md) that survive are joined into at most one model request, and its
   [structured result](outputs.md) sets variables. A subagent can also call
   [actions](actions.md) itself with [`run`](run.md), and then makes no model request.
5. **End** `completed`, `cut-short` or `failed`, with the final variables. A failed step leaves its
   subagent's variables as they were before it began.

Run the script above with `specsesh agent run greeter.agent --var name=Ada`.
