# Guides

How to build with `@specsesh/agent`: from a single Agent Script file to agents that run crash-safe
on Node or Cloudflare, do real work through actions, and carry an OpenSpec change from tasks to
passing checks.

New here? Read the [package README](../packages/agent/README.md) for the five-minute tour, then
follow the path that matches what you want.

## Pick a path

| You want to… | Read |
|---|---|
| Write an agent as a file and run it on any model | [01](01-agent-script.md) → [02](02-running-scripts.md) |
| Run agents that survive crashes and restarts | [01](01-agent-script.md) → [03](03-durable-agents.md) |
| Let an agent read and edit files, run commands and checks | [03](03-durable-agents.md) → [04](04-actions.md) |
| Host agents on Cloudflare | [03](03-durable-agents.md) → [05](05-cloudflare.md) |
| Use the OpenSpec types in your own tooling | [06](06-openspec.md) |
| Have an agent execute your OpenSpec changes until the tests pass | [06](06-openspec.md) → [07](07-task-loop.md) |
| Have an agent draft an OpenSpec change from one sentence of intent, stage by stage | [07](07-task-loop.md) → [09](09-spec-agent.md) |

## All guides

0. **[The language tour](00-language-tour.md)**: start here. Builds one script step by step: a prompt, variables, structured output, logic, a `run` action, model-callable actions.
1. **[Writing Agent Script](01-agent-script.md)**: how the pieces of a script fit together, linked to the reference topics, and the authoring API.
2. **[Running a script](02-running-scripts.md)**: the interpreter, reasoning ports (pi-ai, your Claude subscription, your own), and the step machine for custom hosts.
3. **[Durable agents on Node](03-durable-agents.md)**: pi-durable harnesses, resume after a crash, the `agentscript-durable` CLI.
4. **[Actions](04-actions.md)**: declaring actions, the built-ins, writing your own host action, binding checks and replay.
5. **[Agents on Cloudflare](05-cloudflare.md)**: `AgentScriptHost` in a Durable Object, its HTTP API, Workers AI, local development.
6. **[The OpenSpec ontology](06-openspec.md)**: typed schemas for changes, steps, loops and evidence.
7. **[Executing changes with the task loop](07-task-loop.md)**: `agentscript-task`, configuration, writing tasks an agent can finish, groups, escalations, tuning.
8. **[Troubleshooting](08-troubleshooting.md)**: every refusal and failure you're likely to meet, and what to do.
9. **[Drafting changes with the spec agent](09-spec-agent.md)**: from `pnpm task spec <id> --intent "…"` to `pnpm task <id> --next-group`: the four stages (proposal, design, specs, tasks), approving and revising, slicing, and what each gate checks.

The language reference is one topic per file in [`packages/agent/docs/language/`](../packages/agent/docs/language/) (also `specsesh agent language <topic>`), with runnable scripts in [`examples/agents/`](../examples/agents/).

## Examples

- [`examples/hello-world`](../examples/hello-world): one script, run durably on Node.
- [`examples/cloudflare-worker`](../examples/cloudflare-worker): `AgentScriptHost` in a Worker, with a faux model for local runs.

## Elsewhere

- [`docs/`](../docs/README.md): the taxonomy and ontology for executing OpenSpec changes, one concept per page.
- [`openspec/`](../openspec): the specs this code is held to, and the [roadmap](../packages/agent/README.md#roadmap) of changes in flight.
