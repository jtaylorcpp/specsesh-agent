## Why

`add-specsesh-command` gives `@specsesh/agent` a `./cli` entry, but nothing puts a `specsesh` bin on PATH, and `npx @specsesh/agent …` cannot work: the package has four bins, none named after it, and the CLIs need `pi-ai`, `pi-durable` and `chord`, which it declares as optional peers that `npx` never installs. A thin, unscoped `specsesh` package with those as real dependencies makes `npx specsesh change build <change>` work in any repository.

## What Changes

- New publishable package `packages/specsesh`, named `specsesh`: one bin, `specsesh` (`bin/specsesh.js`, plain JavaScript, no build), that calls `main` from `@specsesh/agent/cli`.
- Its dependencies: `@specsesh/agent` as `workspace:*` (packed as the exact version) and `@earendil-works/pi-ai`, `pi-durable` and `chord` at the exact versions `@specsesh/agent`'s tests run on.
- Both packages share one version, license, Node engine and `repository` (needed for npm provenance); the spec no longer pins `0.1.0`.
- `packages/specsesh/README.md` for the npm page; `packages/agent/README.md` lists the ten entries and points at `npx specsesh`.
- `pnpm pack:check` packs `specsesh` with `pnpm pack`, installs it beside the agent tarball with nothing else, and runs the installed `specsesh`.

## Out of scope

- Publishing and the release workflow (`add-npm-release-workflow`).
- The `specsesh` names in the sub-CLIs' output (`name-specsesh-in-change-output`, `name-specsesh-in-task-output`).
- A root `pnpm specsesh` script; the existing `pnpm agent|durable|task|change` stay as they are.
- Any change to `@specsesh/agent`'s dependencies or optional peers.

## Capabilities

- **Modified:** `package/distribution`.

## Impact

- New: `packages/specsesh/{package.json,bin/specsesh.js,README.md,LICENSE}`; `pnpm-lock.yaml` links it.
- `packages/agent/package.json` (`repository`), `packages/agent/README.md`.
- Tests: `__tests__/package/manifest.test.ts`, `__tests__/package/specsesh.test.ts` (new), `__tests__/package/pack.test.ts`.
- `CLAUDE.md` describes two packages.
