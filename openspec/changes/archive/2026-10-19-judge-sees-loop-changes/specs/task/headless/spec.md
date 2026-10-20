## ADDED Requirements

### Requirement: The CLI leaves its database out of changed
`run` SHALL start every task, group and change loop with `excludeChanged` set to the database's own files that lie inside the repository: the database file and its `-wal`, `-shm` and `.lock` files. A script's seeded `changed` so never lists them.

#### Scenario: A database in the repository is not seeded as changed
- **GIVEN** a clean git workspace, `--db runs.sqlite` at its root (not ignored), and a script declaring `changed` whose iteration 1 writes `src/a.ts` and ends unmet
- **WHEN** iteration 2 starts
- **THEN** its run SHALL be seeded with `changed` `"src/a.ts"`

## MODIFIED Requirements

### Requirement: loop-ended lists the files the loop changed
`loop-ended.changed` SHALL list, sorted, the paths whose `git status --porcelain` entry or content in the workspace differs between the loop's `task/agent` baseline and its end, except the change's `tasks.md` (its tick is `ticked`) and the database's own files. The same holds after `resume`, for a run started by `answer`, and for each task of a group. Outside a git repository it SHALL be `[]`.

#### Scenario: Only the edited file is listed
- **GIVEN** a clean git workspace
- **WHEN** a loop edits `src/a.ts`, converges and ticks its task in the workspace's `tasks.md`
- **THEN** `loop-ended.changed` SHALL be `["src/a.ts"]`

#### Scenario: A resumed loop lists edits made before the crash
- **GIVEN** a loop whose iteration 1 wrote `src/a.ts`, and whose process was killed during iteration 2
- **WHEN** `resume <loop-id>` finishes the loop, and iteration 2 writes `src/b.ts`
- **THEN** `loop-ended.changed` SHALL be `["src/a.ts", "src/b.ts"]`

#### Scenario: An answered run lists the blocked run's edits
- **GIVEN** a loop blocked after iteration 1, which wrote `src/a.ts`
- **WHEN** `answer <loop-id> --by principal --decision "…"` runs the new run, and that run writes `src/b.ts` and converges
- **THEN** the new run's `loop-ended.changed` SHALL be `["src/a.ts", "src/b.ts"]`

#### Scenario: A group's task lists only its own files
- **GIVEN** a group whose task `1.1` writes `src/a.ts` and converges, then task `1.2` writes `src/b.ts` and converges
- **WHEN** task `1.2`'s `loop-ended` is emitted
- **THEN** its `changed` SHALL be `["src/b.ts"]`
