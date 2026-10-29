## Why

"Does Gemini do what Claude Code does?" has no answer in the repo short of reading the tests. The provider matrix in `docs/providers/README.md` answers only which command each provider runs on, and two of its `yes` cells (Gemini on Cloudflare, claude-code in task loops) are backed by no offline test. A parity matrix that names a test for every claim, and that fails the build when it drifts, stays true as providers change.

## What Changes

- **`parity.json`** (repo root): the one declaration. It has features as rows and the five matrix providers as columns. Each cell is `tested`, `live`, `untested` or `no`, with a short note. A `tested` or `live` cell cites its evidence: the exact name of a vitest test under `packages/agent/__tests__/`, or the path of a test script.
- **`scripts/parity.mjs`**, no dependencies: renders the declaration as Markdown. `node scripts/parity.mjs --write` rewrites the block between `<!-- PARITY:BEGIN -->` and `<!-- PARITY:END -->` in the root `README.md`, and `--check` exits 1 when the block differs. Root script `pnpm parity`.
- **README.** A `## Provider parity` section: a legend, the table, then a collapsed list of each cell's evidence.
- **A test** (`__tests__/package/parity.test.ts`) that fails when:
  - the README block differs from the render;
  - a cited test name or script doesn't exist;
  - a cell disagrees with `docs/providers/README.md` (`no` there must be `no` here, and the reverse);
  - the providers or features differ from the fixed lists.
- **The rule.** `CLAUDE.md` says that a change touching a provider updates `parity.json` in the same change. The test enforces the rest.

## Out of scope

- **Making cells true.** Untested cells are shown as `untested`, not fixed here. Each is a candidate change.
- **Dates of live runs.** A live cell cites the script, not when it last passed.
- **Shipping the matrix in the package.** It is a repo page; `docs/providers/README.md` stays the shipped command matrix.

## Capabilities

- **New:** `package/parity`.

## Impact

- `parity.json` and `scripts/parity.mjs` (new), root `package.json` (`parity`), `README.md`, `CLAUDE.md`.
- `packages/agent/__tests__/package/parity.test.ts` (new).
