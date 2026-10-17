## Why

The guides (`guides/01-agent-script.md`, `04-actions.md`) explain the language well, but:
- they live at the repo root and don't ship in the npm package
- they are long chapters, not a reference an agent can pull one topic from
- the only runnable examples are `examples/hello-world/hello.agent` and `packages/agent/examples/triage.agent`

The new `specsesh language` command (`add-agent-discovery-commands`) needs topic texts that ship with the package. People need a short tour and a set of examples that run.

## What Changes

- **Reference topics.** `packages/agent/docs/language/<topic>.md`, one file per topic: `overview`, `config`, `system`, `variables`, `subagents`, `prompts`, `interpolation`, `logic`, `outputs`, `actions`, `run`, `refused`. Each is short, starts with a one-line summary (used by `specsesh language`'s table of contents), and has at least one complete example block.
  - These are the single source. `guides/01-agent-script.md` links to them instead of repeating them, and keeps the narrative and the authoring API.
- **A language tour.** `guides/00-language-tour.md` builds one script up step by step: a prompt, then variables, structured output, logic, a `run` action, and a model-callable action. Each step names the `specsesh check` and `specsesh agent run` commands to try.
- **Examples that run.** `examples/agents/` holds one small script per idea, each with a README line:
  - `01-hello.agent`: a prompt and a variable
  - `02-structured-output.agent`: `@outputs` into typed variables
  - `03-branching.agent`: `if` and `else` logic with no model
  - `04-run-action.agent`: a deterministic `run` of a built-in action
  - `05-model-tools.agent`: `reasoning.actions` the model may call
  - `06-custom-task-agent.agent`: a trimmed copy of the bundled `task` agent, with notes on what each part does and how to point `agentscript.config.json` at it
- **Docs are checked.** A test runs `specsesh check` over every `examples/**/*.agent` file and every example block in `docs/language/*.md`. A second test fails if a topic file is missing or lacks its summary line.
- **The README** gets a short "Write your own agent" section pointing to `specsesh new agent`, `specsesh language`, the tour and the examples.

## Out of scope

- Language changes.
- Running the examples against a live model in CI. They are checked, not run. The tour says how to run them.

## Capabilities

**New:** `package/language-docs`

## Impact

- **New files:**
  - `packages/agent/docs/language/*.md`
  - `guides/00-language-tour.md`
  - `examples/agents/*.agent` and its `README.md`
  - tests
- **Changed files:**
  - `guides/01-agent-script.md` (links to the topics)
  - `guides/README.md`
  - `packages/agent/README.md`
- **Depends on:** `add-agent-discovery-commands`, for `specsesh check` and `specsesh language`. Build it first.
