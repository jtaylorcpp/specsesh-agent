## MODIFIED Requirements

### Requirement: A delegate's calls are bounded per run
A delegate action SHALL answer `{ ok: false }` with `delegate <name> reached its limit of <n> calls in this run`, starting nothing, once the run already holds `maxCalls` reports for it. The count SHALL come from the run's own action reports and every step outcome's `toolCalls`, failed and cut-short steps included, so a resumed run keeps it.

#### Scenario: The call past the limit fails
- **GIVEN** a grant with `maxCalls` `1` and a script that calls it twice
- **WHEN** the run reaches the second call
- **THEN** that call SHALL answer `{ ok: false }` with `reached its limit of 1 calls`, and exactly one process SHALL have started

#### Scenario: A call in a failed step counts toward the limit
- **GIVEN** a grant with `maxCalls` `1`, offered to a step whose model calls it once and whose step then fails, and a later step that calls it again
- **WHEN** the run reaches the later call
- **THEN** that call SHALL answer `{ ok: false }` with `reached its limit of 1 calls`
