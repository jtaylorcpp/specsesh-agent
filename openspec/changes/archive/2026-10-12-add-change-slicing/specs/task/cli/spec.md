## MODIFIED Requirements

### Requirement: Text output for a spec loop ends with the next step
The text output SHALL start `# spec loop <id> — <status>`, then one line per draft: `## <stage> draft <n>: clean` or `: <k> issues`, each issue below it. A review SHALL end with the files' paths and the approve and revise commands for that loop. An approval SHALL end with the next stage's `spec` command or, when none remains, `pnpm task <change> --next-group`; an approved proposal with `slices.md` SHALL then list a `spec <id> --intent "<intent>"` command per later slice, in order.

#### Scenario: A review prints both commands
- **WHEN** loop `12` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `pnpm task answer 12 --by principal --decision approve` and `pnpm task answer 12 --by principal --decision "<what to change>"`

#### Scenario: The last approval points at execution
- **WHEN** the last stage in `SPEC_STAGES` of `add-plan-export` is approved
- **THEN** the output SHALL end with `pnpm task add-plan-export --next-group`

#### Scenario: Approving a sliced proposal lists the other slices
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** the proposal is approved
- **THEN** the output SHALL list `pnpm task spec add-plan-export-schema --intent "…"` then `pnpm task spec add-plan-export-ci --intent "…"`, each with its slice's intent
