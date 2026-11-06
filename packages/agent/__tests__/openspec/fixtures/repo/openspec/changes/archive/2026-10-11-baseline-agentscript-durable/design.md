## Context

Baseline of existing behaviour. This records how the pieces fit, so the specs can stay at the level of public behaviour.

## Layers

```
core (./authoring, ./interpreter)    no model client, no I/O, runs on Node and Workers
  authoring    analyze / parse / Document over the Agentforce dialect (no compiler in the tree)
  subset       one declaration of what executes; the scan refuses the rest up front
  composition  prompt lines → text; logic lines → evaluated here, never by a model
  step machine start → next → apply over a JSON RunState; run() is their loop
  port         ReasoningPort: one stateless reason(request) → StepOutcome

agentscript-durable                  pi-durable extension + Node host
  agentscript.run task   checkpoint = { phase, RunState }; phases next → dispatch → await
  step conversation      one per step, task-owned: system block, prompt, submit_result only
  host / CLI             startScript, waitForScript; run/resume on node:sqlite

agentscript-cloudflare               the same extension inside a Durable Object (PiHarness + Lifecycle)
```

## Decisions

- **The interpreter holds the state; the port holds none.** Every request carries its system instructions and full prompt. A durable host persists only `RunState`.
- **`next` is pure and `apply` is the only writer.** A host that crashes between them calls `next` again and gets the same request; the durable task's `requestId` (`agentscript:<task>:<step>`) makes the re-submit return the same submission.
- **A failed step rolls back its own logic lines only** (`awaiting.before`); logic-only subagents that finished before it are kept.
- **State changes come only from a structured result.** In the durable host that is the `submit_result` tool writing the step doc; text is never parsed.
- **Refuse before dispatch.** Lint errors, unsupported constructs, undeclared names and bad entries all throw at `start`, so in the durable host they throw at task creation.
- **The source fingerprint guards resumes.** `RunState.sourceHash` (FNV-1a) ties a state to the exact script; the script itself travels in the task input.

## Risks

- The spec pins upstream node kinds and dialect messages (`@sf-agentscript/*` exact-pinned); an upstream bump is a spec change.
- Cloudflare idle wake-up by alarm is unverified (see `openspec/parked.md`).
