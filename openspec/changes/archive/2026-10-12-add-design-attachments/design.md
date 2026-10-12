## Context

`Design` is `closed({ sections })` in `src/openspec/model.ts`. Being closed, an unknown field is refused today, so `attachments` has to be added to the schema, not tolerated.

## The type

```ts
export const DesignAttachment = closed({
	path: Type.String({ pattern: "^design/(?!.*(^|/)\\.\\.(/|$))[^\\s]+$" }),
	kind: literals("mock", "example", "diagram", "other"),
});

export const Design = closed({
	sections: Type.Array(closed({ heading: Type.String(), body: Type.String() }), { minItems: 1 }),
	attachments: Type.Optional(Type.Array(DesignAttachment)),
});
```

A change directory then looks like:

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

## Decisions

- **Optional, not an empty array.** The model's rule is "absent, not empty" (`design` and `tasks` on `Change`). A design without files has no `attachments`.
- **Under `design/` only.** One place to look, and OpenSpec ignores it (it reads only `proposal.md`, `design.md`, `tasks.md` and `specs/`). Checked with `openspec validate --strict` on a change holding a `design/` directory before writing this.
- **A `kind` field, not inference from the extension.** A `.ts` file may be an example or a diagram source; the author says which.

## Risks

- None beyond a regex: the scenarios pin `..`, absolute paths and paths outside `design/`.
