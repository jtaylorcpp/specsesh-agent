## Why

This project now stands on its own, as a library used elsewhere. Its behaviour exists only as code and tests: nothing outside them says what a caller can rely on. Every later change (packaging first) needs a spec to change against, so this change writes down what Agent Script and durable execution do **today**, in enough detail that a reader who never opens the source knows every guarantee, every refusal and every boundary.

## What Changes

No code changes. Baseline specs only, ADDED, for behaviour that already exists and is tested:

- `core/authoring`: parsing, linting and editing a document, and the boundary that keeps the compiler out of the dependency tree.
- `core/subset`: the enumerated language subset, declared once, and the pre-execution scan that refuses everything outside it.
- `core/composition`: declared variables as the run's state, prompt lines vs logic lines, expression evaluation, the derived result schema, structured-only state updates, and opt-in persistence.
- `core/reasoning-port`: the one-method injected boundary, the three step outcomes, the failure-category vocabulary and how any port answer is normalised.
- `core/step-machine`: `start` / `next` / `apply` over a JSON `RunState`, the source fingerprint, rollback on a failed step, and `run()` as their loop.
- `durable/run-task`: the pi-durable extension, the `agentscript.run` task and its phases, one task-owned conversation per step, the `submit_result` tool and crash recovery.
- `durable/host`: starting and waiting for runs from a host holding a pi-durable `Harness`.
- `durable/cli`: `agentscript-durable run` and `resume` on Node SQLite.
- `durable/cloudflare`: the Worker and Durable Object host on Cloudflare's PiHarness.

## Out of scope

- The pi-ai reasoning port and the claude-code provider (`agentscript-pi`): a later baseline.
- Packaging (build output, package names, publishing): the next change, specced against this one.
- Any behaviour change. Scenarios with no test today are listed in `tasks.md` as tests to add, not as code to write.

## Impact

- New: `openspec/specs/{core,durable}/*/spec.md` once archived.
- OpenSpec 1.14.1 is pinned as a root dev dependency, with `spec:check` and a guarded `spec:archive` script (archive refuses unless `openspec validate --strict` passes, because 1.14.1's `archive --yes` still archives invalid changes).
