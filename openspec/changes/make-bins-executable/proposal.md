## Why

`tsc` writes `packages/agent/dist/bin/*.js` as plain files, so after `pnpm install && pnpm build` in a fresh clone, running a bin directly (`packages/agent/dist/bin/agentscript-change.js …`) or through a link to it fails with "Permission denied". npm marks bins executable when it installs a package, but nothing does for the workspace build. Separately, `npm i -g @specsesh/agent` alone fails at runtime with `ERR_MODULE_NOT_FOUND` for `@earendil-works/chord`, because the Node peers are optional; the README should send command-line users to `specsesh`, which depends on them.

## What Changes

- `packages/agent/scripts/chmod-bins.mjs` (new): reads the manifest's `bin` map and sets mode `0755` on each target, failing with the target's name when one is missing.
- `packages/agent`'s `build` and `check` scripts run it after `tsc -p tsconfig.build.json`, so every way the repository emits `dist/` leaves the bins executable.
- `packages/specsesh/bin/specsesh.js` stays committed with mode `100755`, and a test holds it there.
- `packages/agent/README.md`'s install block names `npm install -g specsesh` (or `npx specsesh`) for the command line, before the library install and its peers.

## Out of scope

- Any change to the bins' code, names or the packages' dependencies.
- The release workflow (`add-npm-release-workflow`).

## Capabilities

- **Modified:** `package/distribution`.

## Impact

- New: `packages/agent/scripts/chmod-bins.mjs`.
- `packages/agent/package.json` (`build`, `check`), `packages/agent/README.md`.
- Tests: `packages/agent/__tests__/package/bins.test.ts` (new).
