## Context

`src/task/tasks-md.ts` already reads task lines for the task loop, and the ontology's `TaskList` checks group numbering and ids. `taskIssues` (`openspec/size`) checks one task. This stage composes them and adds the scenario claims.

## A passing tasks.md

The shape every task list in this change set already has:

```markdown
## 1. The stage

- [ ] 1.1 `packages/agent/src/task/stages/tasks-gate.ts` (new): the list, claim and size rules
- [ ] 1.2 `packages/agent/src/task/stages/tasks.ts` (new): `tasksStage` with its seed and gate

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/stages/tasks-gate.test.ts`: "A task naming two files is sent back", "An unclaimed scenario is sent back", "A ticked task is sent back" and "Thirteen tasks are sent back" (4)

## 3. Verify

- [ ] 3.1 `pnpm check` and `pnpm test` pass
```

## The gate

```ts
gate: async ({ changeId, run, files }) => {
	const list = readTaskList(files["tasks.md"] ?? "");          // groups and tasks, or ERRORs naming the line
	const scenarios = scenarioNames(await openspecDeltas(run, changeId));
	return [
		...list.issues,                                           // unparsable lines, ids outside their group, a ticked task
		...list.tasks.flatMap((task) => taskIssues(withClaims(task, scenarios))),
		...unclaimed(scenarios, list.tasks),                      // ERROR: no task names "<scenario>"
		...sizeIssues(asChange(list)).filter(onlyTasks),
	];
};
```

**A claim** is the scenario's exact name, in double quotes, anywhere in a task's text. `withClaims` turns each claim into a `scenario-named` link, which `taskIssues` counts against the four-scenario limit.

## Seeds

- `approved`: every file the approved stages own (`proposal.md`, `slices.md`, `design.md`, everything under `design/`, and every delta), as `=== ` sections, built by the spec loop as for every stage.
- `base`: `git ls-files` in the workspace, one path per line, cut at 3,000 lines with a closing line saying how many were cut. Outside git, empty.

## The guide

`guides/09-spec-agent.md` walks a user from `pnpm task spec <id> --intent "…"` to `pnpm task <id> --next-group`:
- the four stages and what each gate checks;
- approving and revising, and what `approvals.json` holds;
- slicing, and hand-editing a draft between runs;
- the size budget, with the measurements behind it.

It reuses the session in `add-spec-cli`'s design, and the walkthrough mock in `add-spec-loop`'s.

## Decisions

- **Claims by exact quoted name.** That's the ontology's strongest link basis (`scenario-named`, confidence 1), and the convention this repo's tasks already follow.
- **Unclaimed is an `ERROR`, not a `WARNING`.** A scenario no task names is behaviour the spec promises and nothing builds.

## Risks

- **Large repositories:** 3,000 paths is about 100 KB of seed text. A path filter by the proposal's Impact section is the obvious next step if it proves too much.
