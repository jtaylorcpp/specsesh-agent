## ADDED Requirements

### Requirement: Each loop records its owner, and a dead owner makes it interrupted
A process starting or resuming a loop SHALL write `(loop_id, pid, boot_at)` to table `loop_owner` (key `loop_id`), `boot_at` being the boot time in ms, rounded to the second. Nested loops get the same owner. Without taking the lock, a loop with no outcome and not blocked SHALL be `interrupted` unless `<db>.lock` names its owner's live pid and `boot_at` is within 2 s of the current boot time. A loop without an owner row is `interrupted` only when no live process holds the lock.

#### Scenario: run records the owner
- **WHEN** `run` starts loop `5`
- **THEN** `loop_owner` SHALL hold a row for loop `5` with the process's pid and a `boot_at` within 1 s of `Date.now() - os.uptime() * 1000`, rounded to the second, and `status` SHALL show loop `5` as `running`

#### Scenario: A live lock on another loop does not hide a dead one
- **GIVEN** live pid `200` holding `<db>.lock` and running loop `15`, loop `11` running with owner pid `100`, and loop `3` running with no owner row
- **WHEN** `status` runs
- **THEN** loop `11` SHALL be `interrupted`, and loops `15` and `3` SHALL be `running`

#### Scenario: A reboot is caught despite a reused pid
- **GIVEN** loop `11` running with owner pid `4242` and a `boot_at` 60 s before the current boot time, and `<db>.lock` naming live pid `4242`
- **WHEN** `status` runs
- **THEN** loop `11` SHALL be `interrupted`

## MODIFIED Requirements

### Requirement: status lists the loops in the database
`agentscript-task status` SHALL print one line per loop in the database, task and group loops alike, newest first: its id, change, task (or `group <n>`), status and iteration count. The status is `running`, `interrupted` (by the owner rule), `converged`, `blocked`, `exhausted` or `failed`. A loop that is `blocked` or has ended is never shown as `interrupted`. With no loops, `status` SHALL print `no loops in <db>` and exit `0`.

#### Scenario: Two loops are listed newest first
- **GIVEN** loop `1` converged and loop `2` blocked
- **WHEN** `status` runs
- **THEN** the first line SHALL describe loop `2` as `blocked` and the second loop `1` as `converged`

#### Scenario: An empty database
- **WHEN** `status` runs on a database with no loops
- **THEN** stdout SHALL be `no loops in <db>` and the exit code SHALL be `0`

#### Scenario: A group loop and its task loops are listed
- **GIVEN** a group loop for group `1` that ran task loops for `1.1` and `1.2`
- **WHEN** `status` runs
- **THEN** it SHALL list the group loop as `group 1` and each task loop with its task id

#### Scenario: An interrupted loop is marked and a blocked one is not
- **GIVEN** task loop `10` with no outcome whose owner's process is dead and no `<db>.lock`, and loop `12` blocked on an escalation
- **WHEN** `status` runs
- **THEN** loop `10`'s line SHALL show `interrupted` and loop `12`'s line SHALL show `blocked`
