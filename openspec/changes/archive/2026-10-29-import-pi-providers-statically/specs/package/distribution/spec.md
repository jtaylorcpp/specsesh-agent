## ADDED Requirements

### Requirement: pi-ai is imported statically
No file under `packages/agent/src/` SHALL import `@earendil-works/pi-ai` or a subpath of it with a dynamic `import()`. A module reached both statically and dynamically makes Bun's bundler wrap it in a lazy initialiser that can be dropped.

#### Scenario: No source imports pi-ai dynamically
- **WHEN** every file under `src/` is scanned, comments stripped
- **THEN** none SHALL contain a dynamic `import()` of `@earendil-works/pi-ai` or `@earendil-works/pi-ai/<subpath>`
