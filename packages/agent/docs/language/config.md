# The config block names the agent; nothing in the run reads it.

`config` carries the agent's identity. The dialect requires `agent_name` or `developer_name`, and a
config with neither is an error. `agent_type` and `description` are also accepted. Any other field
is refused as unsupported by this runtime.

```agent
config:
    agent_name: "spec-author"
    description: "Drafts specs"

subagent draft:
    description: "Draft the spec"

    reasoning:
        instructions: ->
            | Draft a one-paragraph spec.
```

At run time the interpreter reads none of these fields: they never reach the model and change
nothing about the run. They are there for the author and for anything else that handles the file.
The dialect limits `agent_type` to its own list of values. It means nothing here.
