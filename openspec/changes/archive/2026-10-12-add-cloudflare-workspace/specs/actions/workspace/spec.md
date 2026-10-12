## ADDED Requirements

### Requirement: A workspace may publish
`Workspace` SHALL allow an optional `publish(message)`, resolving `{ commit: string, changed: boolean }` after recording the workspace's changes in its history of record. `localWorkspace` SHALL NOT implement it, because the local runner never commits.

#### Scenario: A local workspace cannot publish
- **WHEN** `localWorkspace(dir)` is read
- **THEN** it SHALL have no `publish`

### Requirement: memoryWorkspace holds files in memory
`@specsesh/agent/durable` SHALL export `memoryWorkspace(files?)`: a `Workspace` whose `root` is `memory:`, whose `read` and `write` use an in-memory map seeded from `files` (refusing absolute paths and `..` escapes with `outside the workspace`), with `list` and `search` over the map, and with no `exec`, `snapshot` or `publish`.

#### Scenario: An in-memory edit round-trips
- **WHEN** `memoryWorkspace({ "a.txt": "1" })` writes `"2"` to `a.txt` and reads it
- **THEN** the read SHALL resolve `"2"`, and the workspace SHALL have no `exec`
