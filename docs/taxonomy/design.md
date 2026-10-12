---
id: design
name: Design
kind: type
area: taxonomy
spec:
  - "openspec/model: A design is free-form sections"
related: [change, design-step]
status: implemented
---

# Design

The change's free-form design document: headed sections in source order, plus optional attachments, files under the change's `design/` directory (mocks, example code, diagrams) that the design refers to.

## Definition

```
Design { sections: { heading: string, body: string }[], attachments?: DesignAttachment[] }
DesignAttachment { path: string, kind: "mock" | "example" | "diagram" | "other" }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `sections` | `{ heading, body }[]` | Each section's heading and body, at least one, in source order. |
| `attachments` | `DesignAttachment[]`, optional | The files the design refers to. Absent when there are none. |

`DesignAttachment`:

| Field | Type | Meaning |
|---|---|---|
| `path` | `string` | The file, relative to the change directory, starting with `design/`. |
| `kind` | `"mock" \| "example" \| "diagram" \| "other"` | What the file is, as the author states it. Not inferred from the extension: a `.ts` file may be an example or a diagram source. |

## Invariants

- No particular headings are required. Context, decisions and risks are conventions, not fields.
- A design with no files has **absent** `attachments`, not an empty value, the same rule as `design` and `tasks` on a [Change](change.md).
- An attachment `path` starts with `design/`, is not absolute and has no `..` segment, or the check fails. `proposal.md`, `/tmp/mock.html` and `design/../tasks.md` are all refused. Everything sits in one place, and OpenSpec ignores `design/`: it reads only `proposal.md`, `design.md`, `tasks.md` and `specs/`.

## Relations

- Optional part of a [Change](change.md); absent until written.
- Produced by the [design step](../ontology/process/steps/design-step.md), a different concept with the same name. Checking that a mock renders or that example code compiles is that step's job; the ontology neither reads attachments from disk nor parses `design.md`.

## Example

A design whose headings are `Context`, `Two halves` and `Risks and gaps` is a valid `Design`.

A change directory with a mock and an example:

```
openspec/changes/add-spec-loop/
  proposal.md
  design.md            ← sections
  design/
    walkthrough.html   ← kind "mock"
    examples/cli.sh    ← kind "example"
  specs/…
  tasks.md
```

Its `Design`, which passes the check:

```json
{
  "sections": [
    { "heading": "Context", "body": "…" },
    { "heading": "Decisions", "body": "…" }
  ],
  "attachments": [
    { "path": "design/walkthrough.html", "kind": "mock" },
    { "path": "design/examples/cli.sh", "kind": "example" }
  ]
}
```

A `Design` with an attachment path `proposal.md`, `/tmp/mock.html` or `design/../tasks.md` fails the check.

## Spec

- `openspec/model`: A design is free-form sections
