## Why

A built change still ends with `pnpm spec:archive <change>`, a script that exists only in this repository. The principal wants the last verb on the change itself: `pnpm change close <change>` folds the change's deltas into the specs and archives it, once the change is finished. `close` ships with the package, so any repository that uses `pnpm change` gets it.

## What Changes

- **`pnpm change close <change>`.**
  - It refuses an unfinished change and changes nothing. Unfinished means a task is unticked, or the change's newest change loop in the database didn't converge, or the change fails strict validation.
  - It folds safely, the way `scripts/spec-archive.mjs` does. It validates the change, folds it into a temporary copy of `openspec/` and validates the merged specs, and only then runs `openspec archive <change> --yes` for real. `OPENSPEC_TELEMETRY=0` is set throughout.
  - It prints the capabilities it folded into and where the change moved, and ends with the commit command. It doesn't commit.
- **A built change points at `pnpm change close <change>`.**
- **The package ships four bins.** The distribution spec and the README name `agentscript-change`.

## Out of scope

- Committing, pushing or opening a pull request.
- Reopening a closed change.
- `scripts/spec-archive.mjs` stays as this repository's own script. It does the same steps.

## Capabilities

- **Modified:** `change/cli`, `package/distribution`.

## Impact

- New: `packages/agent/src/task/cmd-close.ts`. Updated: `change-output.ts`, `src/bin/agentscript-change.ts`, `packages/agent/README.md`, `__tests__/package/manifest.test.ts`.
- Depends on `add-change-build`, archived first, and on `add-actors-and-workspaces` for the README requirement it modifies.
