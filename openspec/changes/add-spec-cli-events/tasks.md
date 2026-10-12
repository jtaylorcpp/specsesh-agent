## 1. Events

- [ ] 1.1 `packages/agent/src/task/events.ts`: the five spec event builders, from a spec loop's drafts and outcome
- [ ] 1.2 `packages/agent/src/task/spec-cli.ts`: stream the spec events on stderr after the resume hint
- [ ] 1.3 `packages/agent/__tests__/task/events-spec.test.ts`: "A proposal's stream", "An approval's stream" and "A question is its own event" (3), faux provider

## 2. Live

- [ ] 2.1 `packages/agent/__tests__/live/task.live.test.ts`: "The live proposal reaches review clean", skipping as the task live run does

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 3.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive add-spec-cli-events`
