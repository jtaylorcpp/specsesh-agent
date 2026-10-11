## Why

OpenSpec models the artifacts of a change (proposal → specs → design → tasks) but treats executing one as a flat checklist: `openspec instructions apply` returns tasks as an undifferentiated list and one sentence, "work through pending tasks, mark complete as you go". Nothing says what a step takes in, what it must hand back, what counts as evidence, or what happens when the evidence says no. Without that, an agent (or a durable runtime) can't execute a change as anything more than a to-do list.

This change writes down the model: a taxonomy of everything a change is made of, and an ontology of executing it, where **every step has a typed input and a typed output** and execution is three nested feedback loops:

- **A task is a loop** that iterates until its requirements are met (act → check → judge → feedback).
- **A task group (a top-level number in `tasks.md`) is a loop** that runs its task loops and iterates until the feature set it covers holds together.
- **The task list is a loop** that runs the group loops and iterates until the spec is real: every delta scenario evidenced, the change valid, ready to archive.

## What Changes

This change adds the specs and design, and implements the types they describe as a new entry, `@specsesh/agent/openspec`: each type is one TypeBox schema with its static type derived from it, plus pure functions for the rules (references, unclaimed scenarios, evidence, state transitions, loop status). It adds no parser and no loop runner.

- **New capability `openspec/model`:** the taxonomy, meaning the typed nouns. These are a planning root, capabilities, requirements, scenarios and their clauses, changes, proposals, deltas (added, modified, removed, renamed), designs, task lists, task groups and tasks. It also types the links from a task to the requirements and scenarios it serves, inferred from the task's prose, each carrying how it was inferred.
- **New capability `openspec/process`:** the lifecycle as steps: propose, specify, design, plan, validate, approve, execute, archive. Each step has a named input type and output type, and the change moves through a state machine.
- **New capability `openspec/loops`:** one loop shape (goal, budget, iterations, verdict, outcome), instantiated three times: the task loop, the group loop and the change loop. It covers how feedback flows inside a loop and up to the loop above, including feedback that concludes the **spec** is wrong rather than the code.
- **New capability `openspec/evidence`:** what a verdict may rest on. That is test results tied to scenarios, validation reports, command checks, diffs and reviews, plus the findings a failed check produces.
- **Representation:** every type is specified to have a JSON Schema as well as a static type, so a step's input and output can be checked at a boundary (a model's tool call, a durable checkpoint) and not only at compile time.

## Out of scope

- Parsers that read a real change into these types, or anything that runs a loop. Each of those is a later change.
- Changing OpenSpec itself or its file formats. The model reads `tasks.md` as it is written today (links are inferred, not declared).
- Extending Agent Script so a step can return the rich outputs modelled here. Today a step returns flat scalar fields only; that gap is recorded in the design, not closed.

## Capabilities

- **New:** `openspec/model`, `openspec/process`, `openspec/loops`, `openspec/evidence`.
- **Modified:** `package/distribution`: the exports map gains a seventh entry, `./openspec`; TypeBox (`typebox`, exact-pinned) becomes an allowed required dependency; `src/openspec/` joins the layer rule, importing only `typebox` and itself.

## Impact

- New specs under `openspec/specs/openspec/` once archived, and a new entry `@specsesh/agent/openspec` (`packages/agent/src/openspec/`). No existing entry changes behaviour.
- One new required dependency, `typebox` `1.3.27` (exact, the version pi-ai already pins). The entry stays free of model clients, Node I/O and peers: it imports only `typebox` and its own files.
