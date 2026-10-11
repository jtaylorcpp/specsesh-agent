## MODIFIED Requirements

### Requirement: delegate_claude_code runs headless Claude Code inside this project's hard lines
`delegate_claude_code` SHALL be `{ instructions } → { ok, summary }`, kind `"delegate"`, replay `"unsafe"`. It SHALL run `claude -p --safe-mode` with Claude Code's file and shell tools enabled and never prompting (see "The delegate never prompts"), in the workspace, never with `--bare`, with `ANTHROPIC_API_KEY` and `CLAUDECODE` removed from its environment, and SHALL never read, copy or forward Claude Code's OAuth token. `summary` is Claude Code's result text.

#### Scenario: The delegate's argv and environment keep the hard lines
- **WHEN** `delegate_claude_code` builds its process
- **THEN** argv SHALL contain `-p` and `--safe-mode` and SHALL NOT contain `--bare` or `--tools ""`
- **AND** the child environment SHALL contain neither `ANTHROPIC_API_KEY` nor `CLAUDECODE`, and its cwd SHALL be the workspace

## ADDED Requirements

### Requirement: The delegate never prompts
`delegate_claude_code` SHALL pass `--tools Read,Edit,Write,Glob,Grep,Bash`, `--permission-mode dontAsk`, `--output-format json` and `--no-session-persistence`, and `--allowedTools` listing `Read`, `Edit`, `Write`, `Glob`, `Grep` and one `Bash(<word>:*)` per allowlist entry, in allowlist order. A tool use outside that list is denied by Claude Code, never prompted.

#### Scenario: The allowlist becomes Bash patterns
- **GIVEN** the allowlist `["pnpm", "node"]`
- **WHEN** `delegate_claude_code` builds its argv
- **THEN** `--allowedTools` SHALL be followed by `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(pnpm:*)`, `Bash(node:*)`
- **AND** argv SHALL contain `--permission-mode` followed by `dontAsk`

#### Scenario: An empty allowlist allows no shell
- **GIVEN** the allowlist `[]`
- **WHEN** `delegate_claude_code` builds its argv
- **THEN** `--allowedTools` SHALL list only the five file tools

### Requirement: The delegate's model and context are configurable
`delegate_claude_code` SHALL pass `--model <delegateModel>` when a delegate model is configured, else the step model, and one `--append-system-prompt-file <path>` per configured context file, in order, each resolved against the workspace. A context file that does not exist SHALL make the action answer `{ ok: false }` naming it, without starting Claude Code.

#### Scenario: Context files reach the delegate
- **GIVEN** `delegateContext` `["CLAUDE.md"]` and `delegateModel` `"sonnet"`
- **WHEN** `delegate_claude_code` builds its argv
- **THEN** argv SHALL contain `--model` followed by `sonnet` and `--append-system-prompt-file` followed by the workspace's `CLAUDE.md`

#### Scenario: A missing context file fails the action
- **GIVEN** `delegateContext` `["MISSING.md"]`
- **WHEN** `delegate_claude_code` runs
- **THEN** it SHALL answer `{ ok: false }` naming `MISSING.md`, and no `claude` process SHALL start
