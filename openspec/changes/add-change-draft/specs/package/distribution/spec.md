## RENAMED Requirements

- FROM: `### Requirement: The three CLIs are compiled bins`
- TO: `### Requirement: The four CLIs are compiled bins`

## MODIFIED Requirements

### Requirement: The four CLIs are compiled bins
The manifest's `bin` SHALL map `agentscript-pi` to `./dist/bin/agentscript-pi.js`, `agentscript-durable` to `./dist/bin/agentscript-durable.js`, `agentscript-task` to `./dist/bin/agentscript-task.js` and `agentscript-change` to `./dist/bin/agentscript-change.js`. Each SHALL start with `#!/usr/bin/env node`. `tsx` SHALL NOT be a dependency or peer dependency, and no published file SHALL reference it.

#### Scenario: The bins are wired to compiled files
- **WHEN** the manifest's `bin` is read after a build
- **THEN** all four targets SHALL exist and start with `#!/usr/bin/env node`

#### Scenario: tsx is gone
- **WHEN** the manifest and every file under `dist/` are scanned
- **THEN** none SHALL mention `tsx`
