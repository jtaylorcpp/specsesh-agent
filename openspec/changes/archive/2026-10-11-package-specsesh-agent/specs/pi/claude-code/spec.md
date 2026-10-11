## MODIFIED Requirements

### Requirement: The claude-code surface is exported from the root entry
`@specsesh/agent/claude-code` SHALL export `CLAUDE_CODE_PROVIDER` (`"claude-code"`), `claudeCodeArgs`, `claudeCodeEnv`, `createClaudeCodeReasoningPort`, `toClaudeCodeOutcome`, `CLAUDE_CODE_API` (`"claude-code"`), `CLAUDE_CODE_PROVIDER_ID` (`"claude-code"`), `CLAUDE_CODE_MODELS`, `claudeCodeModel`, `claudeCodeProvider`, `systemPromptOf`, `promptOf` and `toolsOf`, plus the types `ProcessResult`, `Runner`, `ClaudeCodeResult` and the option types.

#### Scenario: Argv building and spawning stay module-level
- **WHEN** a caller imports `@specsesh/agent/claude-code`
- **THEN** `claudeArgs` and `spawnRunner` SHALL NOT be among its exports; they are exports of `src/claude-code/claude-code.ts` only

#### Scenario: The provider id and API are claude-code
- **WHEN** a caller reads `CLAUDE_CODE_PROVIDER`, `CLAUDE_CODE_PROVIDER_ID` and `CLAUDE_CODE_API`
- **THEN** each SHALL equal `"claude-code"`
