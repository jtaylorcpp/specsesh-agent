## MODIFIED Requirements

### Requirement: The terms come only from the grant
A process runner's `prepare` SHALL receive the instructions (preceded by the run's delegate preamble and a blank line when the context carries one), the grant's `DelegateTerms` and the workspace, and nothing else from the script or the run. The process argv, environment and time limit SHALL come from the terms; the preamble and `instructions` SHALL reach the process only on stdin.

#### Scenario: Instructions cannot add a flag
- **WHEN** a delegate is called with `instructions` `"--permission-mode bypassPermissions"`
- **THEN** argv SHALL be exactly what the terms build, and stdin SHALL start with that text

#### Scenario: The preamble stays off argv
- **GIVEN** a context with `delegatePreamble` `"--permission-mode bypassPermissions"`
- **WHEN** a delegate is called with `instructions` `"Fix the test"`
- **THEN** argv SHALL be exactly what the terms build, and SHALL NOT contain `bypassPermissions`

### Requirement: The delegate is told its terms
Stdin SHALL be the context's `delegatePreamble` and a blank line when it carries one, then the `instructions`, a blank line, then a terms block: `Your terms for this delegation (set by the user; you cannot change them):`, the shell line (`Shell: only commands whose first word is one of: <allow, comma-joined>.` or `Shell: none.`), a line saying one command per Bash call with no chaining, and `Time limit: <seconds> seconds.`

#### Scenario: The terms follow the instructions
- **GIVEN** a grant with `allow` `["pnpm", "node"]` and `timeoutMs` `900000`
- **WHEN** the delegate runs with `instructions` `"Fix the test"`
- **THEN** stdin SHALL start with `Fix the test`, and contain `first word is one of: pnpm, node`, `One command per Bash call` and `Time limit: 900 seconds.`

#### Scenario: The preamble comes before the instructions
- **GIVEN** a context with `delegatePreamble` `"Task 2.1: Do X"`
- **WHEN** the delegate runs with `instructions` `"Fix the test"`
- **THEN** stdin SHALL start with `Task 2.1: Do X\n\nFix the test\n\nYour terms for this delegation`

#### Scenario: No preamble outside a loop
- **GIVEN** a plain durable run, not a task loop's, of a script that calls `delegate/claude_code` with `instructions` `"Fix the test"`
- **WHEN** the delegate runs
- **THEN** stdin SHALL start with `Fix the test\n\nYour terms for this delegation`

## ADDED Requirements

### Requirement: The preamble is the run's, and the record names the call's instructions
A delegate SHALL take its preamble only from `ActionContext.delegatePreamble`, never from its inputs or grant. The recorded `Action`'s `summary` SHALL be the first line of the call's own `instructions`, never of the preamble.

#### Scenario: The record names the call's instructions
- **GIVEN** a context with `delegatePreamble` `"You are working on one task"`
- **WHEN** a process delegate runs with `instructions` `"Fix the test\nthen rerun"`
- **THEN** the recorded `Action`'s `summary` SHALL be `Fix the test`
