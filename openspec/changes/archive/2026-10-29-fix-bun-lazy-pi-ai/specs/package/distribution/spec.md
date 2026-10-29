## ADDED Requirements

### Requirement: Library modules reach no pi-ai lazy module statically
No file under `packages/agent/src/` outside `src/bin/` and `src/cli/` SHALL statically import a pi-ai `api/<name>.lazy` or `providers/<name>` subpath. Those modules load parts of pi-ai with a dynamic `import()`, and a static path to them breaks Bun bundles. `pickTests` SHALL load `providers/all` with a dynamic `import()`, and only when it builds a pi model itself.

#### Scenario: No library module statically imports a pi-ai lazy module
- **WHEN** every file under `src/` except `src/bin/` and `src/cli/` is scanned, comments stripped
- **THEN** none SHALL statically import `@earendil-works/pi-ai/api/<name>.lazy` or `@earendil-works/pi-ai/providers/<name>`

### Requirement: A Bun bundle of ./task streams through the claude-code provider
`pnpm test:bun`, opt-in and not in `pnpm test`, SHALL bundle a script that imports `@specsesh/agent/claude-code` and `@specsesh/agent/task` with `bun build --target=bun --external @earendil-works/pi-ai/providers`, run it, and expect the provider's `stream` to return. It SHALL use `BUN` or `bun` on `PATH`, and skip, saying why, when neither is found.

#### Scenario: A Bun bundle of ./task streams
- **GIVEN** a script that calls `claudeCodeProvider({ binary: "/usr/bin/false" }).stream(...)` and imports `TASK_LOOP` from `@specsesh/agent/task`
- **WHEN** it is bundled with `bun build --target=bun --external @earendil-works/pi-ai/providers` and the bundle runs under Bun
- **THEN** it SHALL print `stream ok`

## REMOVED Requirements

### Requirement: pi-ai is imported statically
**Reason**: Pointed the wrong way. A static path from a library entry to pi-ai's `*.lazy` and `providers/*` modules is what breaks Bun bundles, and `pickTests` must load `providers/all` dynamically so a bundler can mark it external.
**Migration**: Replaced by "Library modules reach no pi-ai lazy module statically".
