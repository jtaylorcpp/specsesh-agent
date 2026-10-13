## Context

The design stage is the second `SpecStage`. Its `after: ["proposal"]` means `startSpecLoop` refuses it until the proposal is approved and unchanged (`add-spec-review`). The files it writes are the attachments `add-design-attachments` defined: everything under `design/`.

## What a passing design looks like

```
openspec/changes/add-plan-export/
  design.md                 ## Context · ## The command · ## Decisions · ## Risks
  design/
    mock.html               <!doctype html> … a rendered `specplan export --json` session … </html>
    examples/export.sh      specplan export --json > plan.json
    examples/read-plan.ts   const plan: PlanExport = JSON.parse(readFileSync("plan.json", "utf8"));
```

`design.md` names `design/mock.html`, `design/examples/export.sh` and `design/examples/read-plan.ts`, as links or in backticks, and all three exist.

## The gate

```ts
gate: ({ files }) => [
	...sectionCount(files["design.md"], 2),             // ERROR: design.md needs at least two ## sections
	...mockIssues(htmlUnder(files, "design/")),           // ERROR: no mock / not a complete document / loads from the network
	...exampleIssues(under(files, "design/examples/")),   // ERROR: no example under design/examples/
	...referenceIssues(files["design.md"], files),        // ERROR: design.md names design/x.ts, which does not exist
];
```

**A complete document:**
- its first non-blank text is `<!doctype html>`, in any case;
- it contains `</html>`;
- no `src` or `href` attribute value starts with `http:`, `https:` or `//`.

A mock that inlines its CSS and script opens from the file system with no network, as the principal's mocks always have.

## Seeds

- `approved`: `=== proposal.md`, then its text, in the same bundle format the stage writes. The same format is used by every later stage for every earlier stage's files.
- `base`: for each modified capability, `=== openspec/specs/<area>/<name>/spec.md`, then its text. A new capability has no base.

## The script

[`design/examples/spec-design.agent`](design/examples/spec-design.agent) is the draft. Its instructions:
- **sections:** Context, then how it is used, with the example code inline, then Decisions and Risks;
- **the mock:**
  - for a UI, every state the proposal names (empty, loading, populated, error), with fake data labelled as fake;
  - for a CLI or library, a rendered session or flow;
- **examples:** the calls a user would write, under `design/examples/`, each named in design.md.

## Decisions

- **The gate requires a mock for every change.** Even an ontology change benefits from a page showing before and after. If that proves wasteful, the requirement is one rule to relax.
- **No network in the mock.** The principal opens it from disk, and it must look the same in a year.

## Risks

- **Bundle size.** A mock with inline CSS and an example or two runs to tens of kilobytes in one JSON string. The parked live run covers it.
