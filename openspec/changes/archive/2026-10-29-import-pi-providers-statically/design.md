## Context

`builtinModels` was loaded on first use in `cliModels` and `pickTests`, while `agentscript-pi.ts` imported it statically. Bun's bundler wraps modules reached both ways in lazy initialisers, and a consumer saw the call that runs pi-ai's `models` initialiser dropped.

## Decisions

1. **Static everywhere.** Both modules already need pi-ai at runtime (`./task` requires the durable peers, which include pi-ai, and the bins need it to run any model), so a static import costs only load time.
2. **The test scans for any dynamic `import()` of an `@earendil-works/pi-ai` subpath**, not just `providers/all`, so the mix can't come back through another subpath.

## Decisions made during the build

## Risks / Trade-offs

- Not reproduced here; the consumer's CI is the proof.
- `./task` and the bins load pi-ai's provider catalogue at import time.
