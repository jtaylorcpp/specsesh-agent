## 1. The declaration, the renderer and the checks

- [ ] 1.1 `scripts/parity.mjs` (new, no dependencies): exports `renderParity(data)` (decision 4) and `parityProblems(data, { readme, testNames, commandMatrix, exists })`, returning one string per problem (stale block, unknown value, missing cell, evidence on `untested`/`no`, none on `tested`/`live`, a missing test name or script, a disagreement with the command matrix; decisions 3 and 5). As a CLI: `--write` rewrites the README block, `--check` runs every check against the repo and exits 1 listing problems. Root `package.json`: `"parity": "node scripts/parity.mjs --write"`. `parity.json` (new) holds the matrix from the design, each name checked; a name that isn't found is looked up under its current name or the cell becomes `untested`
- [ ] 1.2 `packages/agent/__tests__/package/parity.test.ts` (new), every scenario of `package/parity`: "Scenario: The README block matches the render", "Scenario: A stale block is caught", "Scenario: Providers match the command matrix", "Scenario: A cell with an unknown value is refused", "Scenario: Every cited test and script exists", "Scenario: A renamed test is caught", "Scenario: A tested cell without evidence is caught", "Scenario: The repo's matrices agree", "Scenario: A contradiction is caught". The drift scenarios run `parityProblems` on mutated copies; nothing in the repo is edited

## 2. The README and the rule

- [ ] 2.1 Root `README.md`: a `## Provider parity` section after `## Commands`, one sentence on what the values mean and that `pnpm parity` regenerates it, then the markers, filled by `pnpm parity`; a `pnpm parity` row in the Commands table. `CLAUDE.md`: `pnpm parity` in Commands, and the rule from decision 6 under "Specs". Run `node scripts/parity.mjs --check`, `pnpm check`, `pnpm test`

The change ends with `pnpm change close add-provider-parity-matrix`.
