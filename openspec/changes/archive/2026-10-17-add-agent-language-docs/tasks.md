## 1. Reference

- [x] 1.1 `packages/agent/docs/language/*.md`: the twelve topic files, written from `guides/01-agent-script.md`, `guides/04-actions.md` and `interpreter/subset.ts`, each with a summary line and `agent` example blocks; test "Every topic is present". Use the spelling in `packages/agent/README.md` "The dialect's spelling" (`True`/`False`, `{!@variables.x}`, `@outputs`, `subagent`, a `description` on every subagent, no `elif` or nested `if`), and say what each construct does at run time as `src/interpreter/` does it, not as Salesforce's runtime would. `docs/language/README.md` stays and is not a topic
- [x] 1.2 `guides/01-agent-script.md`: link to the topics instead of repeating them; `guides/README.md` lists the tour

## 2. Tour and examples

- [x] 2.1 `guides/00-language-tour.md`: six or more steps, each showing the whole script and its commands. Steps without actions name `specsesh agent check <file>` and `specsesh agent run <file>`. `specsesh agent run` has no action host (a `run` statement is refused for want of an `actionHost`, and the pi port fails a step that offers tools), so the `run` and `reasoning.actions` steps say so and show how a host runs them: `builtinActions` and `runScript`, as `guides/04-actions.md` does
- [x] 2.2 `examples/agents/01-hello.agent` to `06-custom-task-agent.agent`, plus `examples/agents/README.md`. `04` and `05` call built-in actions by the names, inputs and outputs `specsesh agent actions` lists, with `target: "mcpTool://<name>"`. `06` still meets the task-script contract (`task/contract.ts`, `checkContract`), so `"script": "examples/agents/06-custom-task-agent.agent"` in `agentscript.config.json` or `specsesh task <change> <task-id> --script <path>` is accepted; a test calls `checkContract` on it

## 3. Checks and README

- [x] 3.1 Docs test: `specsesh agent check` over the examples, the topic blocks and each tour step; tests "Examples check clean", "A broken doc example fails the build" and "Each tour step checks". Also test "Examples run on a stub model": each `examples/agents/*.agent` file and each tour step runs through the interpreter's `run` with every subagent as `entry`, a stub `ReasoningPort` that answers each structured schema and each offered tool, and a stub `actionHost`, and ends `completed`
- [x] 3.2 `packages/agent/README.md`: a "Write your own agent" section
