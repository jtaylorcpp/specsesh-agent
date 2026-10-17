## 1. Reference

- [ ] 1.1 `packages/agent/docs/language/*.md`: the twelve topic files, written from `guides/01-agent-script.md`, `guides/04-actions.md` and `interpreter/subset.ts`, each with a summary line and `agent` example blocks; test "Every topic is present"
- [ ] 1.2 `guides/01-agent-script.md`: link to the topics instead of repeating them; `guides/README.md` lists the tour

## 2. Tour and examples

- [ ] 2.1 `guides/00-language-tour.md`: six or more steps, each showing the whole script and its commands
- [ ] 2.2 `examples/agents/01-hello.agent` to `06-custom-task-agent.agent`, plus `examples/agents/README.md`

## 3. Checks and README

- [ ] 3.1 Docs test: `specsesh agent check` over the examples, the topic blocks and each tour step; tests "Examples check clean", "A broken doc example fails the build" and "Each tour step checks"
- [ ] 3.2 `packages/agent/README.md`: a "Write your own agent" section
