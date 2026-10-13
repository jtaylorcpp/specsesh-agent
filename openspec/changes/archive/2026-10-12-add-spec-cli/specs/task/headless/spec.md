## MODIFIED Requirements

### Requirement: The runner never commits
`agentscript-task` SHALL run only `git status`, `git rev-parse`, `git worktree add`, `git worktree list` and `git config user.name`. It SHALL NOT commit, add, stash, check out or remove anything. Its only writes are a worktree and branch it creates, the files the loop's actions change, the ticked line in `tasks.md`, and the database.

#### Scenario: A converged loop leaves its work uncommitted
- **WHEN** a loop converges in a git workspace
- **THEN** `git log` SHALL show the same HEAD as before the run, and the loop's edits SHALL be uncommitted
