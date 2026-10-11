---
id: task
name: Task
kind: type
area: taxonomy
spec:
  - "openspec/model: A task has an id, text, a done flag, files and links"
related: [task-id, task-link, task-group, task-loop, task-outcome]
status: implemented
---

# Task

One checkbox in the task list: its id, its text, whether it is done, the files it names, and its inferred links.

## Definition

```
Task { id: TaskId, text: string, done: boolean, files: string[], links: TaskLink[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `id` | [`TaskId`](task-id.md) | `<group>.<n>`. |
| `text` | `string` | The task's text. |
| `done` | `boolean` | `true` exactly when the checkbox is `[x]`. |
| `files` | `string[]` | The backticked paths the text names, in order. |
| `links` | [`TaskLink`](task-link.md)`[]` | The requirements and scenarios the task serves, inferred from its prose. |

## Invariants

- `done` is `true` exactly when the checkbox is `[x]`.
- `files` keeps the order in which the text names them.

## Relations

- Part of a [TaskGroup](task-group.md).
- Driven by a [task loop](../ontology/loops/task-loop.md), whose result is a [TaskOutcome](../ontology/loops/task-outcome.md).

## Example

The line

```
- [x] 2.4 `packages/agentscript-durable/__tests__/cli.test.ts`: no command, …
```

is the task with `id` `"2.4"`, `done` `true` and `files` `["packages/agentscript-durable/__tests__/cli.test.ts"]`.

## Spec

- `openspec/model`: A task has an id, text, a done flag, files and links
