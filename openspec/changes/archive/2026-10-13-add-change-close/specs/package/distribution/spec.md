## MODIFIED Requirements

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the nine entry points with one line each on what they hold and which peers they need, and name all four bins.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the nine `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable`, `agentscript-task` and `agentscript-change`
