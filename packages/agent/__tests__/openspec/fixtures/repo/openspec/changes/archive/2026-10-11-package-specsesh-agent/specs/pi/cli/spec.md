## ADDED Requirements

### Requirement: The bin is the compiled CLI
The `agentscript-pi` bin SHALL be `dist/bin/agentscript-pi.js`, compiled from `src/bin/agentscript-pi.ts`, starting with `#!/usr/bin/env node`, and SHALL run the CLI in-process with no `tsx`. It SHALL exit with the CLI's exit code, and print an uncaught error as `<name>: <message>` on stderr and exit `1`.

#### Scenario: Arguments and exit code pass through
- **WHEN** the bin runs `frobnicate`
- **THEN** it SHALL exit `2` with the usage on stderr

#### Scenario: The installed bin needs no tsx
- **GIVEN** the packed tarball installed in an empty project with no `tsx`
- **WHEN** `npx agentscript-pi models claude-code` runs there
- **THEN** it SHALL exit `0` and print the claude-code model hint

## REMOVED Requirements

### Requirement: The bin runs the TypeScript CLI through tsx
**Reason**: The package ships compiled JavaScript, so nothing needs `tsx` at runtime.
**Migration**: The bin is `dist/bin/agentscript-pi.js`; see "The bin is the compiled CLI".
