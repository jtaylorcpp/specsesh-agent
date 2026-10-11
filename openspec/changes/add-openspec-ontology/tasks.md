> Executed: these tasks implement the modelled types as the `@specsesh/agent/openspec` entry (types and schemas, plus pure rule functions; see design.md, Implementation). No parser reads real files into them, and nothing runs a loop.

## 1. The `@specsesh/agent/openspec` entry

- [x] 1.1 Add MODIFIED (and two RENAMED) deltas to `package/distribution` here: the exports map gains a seventh entry, `./openspec`, with `types` and `import` conditions into `dist/openspec/`; `typebox` becomes an allowed exact-pinned dependency; `src/openspec/` joins the layer rule; the readme and examples say seven entries; `./openspec` imports with no peer installed
- [x] 1.2 Create `packages/agent/src/openspec/index.ts` and add `./openspec` to `packages/agent/package.json` `exports`
- [x] 1.3 Choose the schema library (TypeBox is already in the tree through pi-ai) and declare it as a dependency of the package; record the choice in this change's `design.md`

## 2. Model types and schemas

- [x] 2.1 `packages/agent/src/openspec/model.ts`: `Root`, `Capability`, `CapabilityPath`, `Requirement`, `Scenario`, `Clause`, each declared once as a schema with its static type derived from it
- [x] 2.2 `packages/agent/src/openspec/model.ts`: `Change`, `Proposal`, `Delta` (`Added`, `Modified`, `Removed`, `Renamed`), `Design`
- [x] 2.3 `packages/agent/src/openspec/model.ts`: `TaskList`, `TaskGroup`, `Task`, `TaskId`, `TaskLink`, `RequirementRef`, `ScenarioRef`, `LinkBasis`, plus the cross-field checks (task id within its group, confidence 1 exactly for exact-name bases, no path both new and modified)
- [x] 2.4 `packages/agent/src/openspec/model.ts`: a pure `unclaimedScenarios(change)` over typed values (no file reading)
- [x] 2.5 `packages/agent/src/openspec/model.ts`: pure `formatRef` / `parseRef` for `CapabilityPath`, `RequirementRef` and `ScenarioRef` (` › ` separator), round-tripping

## 3. Evidence types and schemas

- [x] 3.1 `packages/agent/src/openspec/evidence.ts`: the five `Evidence` kinds and `Finding`
- [x] 3.2 `packages/agent/src/openspec/evidence.ts`: pure `satisfies(target, evidence)` implementing the scenario, requirement, check and skip rules

## 4. Process types and schemas

- [x] 4.1 `packages/agent/src/openspec/process.ts`: `Step`, `StepResult`, `StepFailure`, `Intent`, `CapabilityIndex`, `ValidationReport`, `Approval`, `ArchiveResult`, and the eight steps' input/output declarations
- [x] 4.2 `packages/agent/src/openspec/process.ts`: `ChangeState` and a pure `transition(state, event)` that refuses every transition the spec does not allow

## 5. Loop types and schemas

- [x] 5.1 `packages/agent/src/openspec/loops.ts`: `LoopInput`, `Budget`, `Iteration`, `Action`, `ContextRef`, `Verdict`, `Target`, `Feedback`, `Escalation`, `EscalationAnswer`, `LoopOutcome`
- [x] 5.2 `packages/agent/src/openspec/loops.ts`: `TaskOutcome`, `GroupOutcome`, `ChangeOutcome`, and a pure `outcomeStatus(iterations, budget)` implementing the four status causes

## 6. Tests

- [x] 6.1 `packages/agent/__tests__/openspec/schema-agreement.test.ts`: every exported type has a schema of the same name and vice versa; each schema accepts a valid fixture and rejects an invalid one
- [x] 6.2 `packages/agent/__tests__/openspec/model.test.ts`: one test per `openspec/model` scenario, named `Scenario: <exact name>`
- [x] 6.3 `packages/agent/__tests__/openspec/evidence.test.ts`: one test per `openspec/evidence` scenario
- [x] 6.4 `packages/agent/__tests__/openspec/process.test.ts`: one test per `openspec/process` scenario
- [x] 6.5 `packages/agent/__tests__/openspec/loops.test.ts`: one test per `openspec/loops` scenario
- [x] 6.6 `packages/agent/__tests__/openspec/import-boundary.test.ts`: `src/openspec` imports only the schema library and its own files; no model client, no `node:` I/O, no peer dependency

## 7. Docs

- [x] 7.1 `packages/agent/README.md`: an `@specsesh/agent/openspec` section listing the taxonomy, the steps and the three loops

## 8. Close

- [x] 8.1 `pnpm check` and `pnpm test` pass; every new test is named after the scenario it pins
- [ ] 8.2 `pnpm spec:archive add-openspec-ontology`, then `pnpm spec:check`
