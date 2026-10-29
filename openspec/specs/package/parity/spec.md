# package/parity Specification

## Purpose
A provider parity matrix in the root README, rendered from one declaration, in which every claimed cell cites a test that exists, so the matrix fails the build instead of going stale.

## Requirements

### Requirement: The README's parity block is rendered from parity.json
The root `README.md` SHALL hold, between `<!-- PARITY:BEGIN -->` and `<!-- PARITY:END -->`, exactly what `renderParity` in `scripts/parity.mjs` renders from the root `parity.json`. `node scripts/parity.mjs --write` SHALL rewrite that block, and `--check` SHALL exit 1 when it differs and 0 otherwise.

#### Scenario: The README block matches the render
- **WHEN** the README's parity block is compared with `renderParity` of `parity.json`
- **THEN** they SHALL be identical

#### Scenario: A stale block is caught
- **GIVEN** a copy of the README whose parity block lacks one row
- **WHEN** it is checked against the render
- **THEN** the check SHALL report the block as stale

### Requirement: The matrix has fixed providers, features and values
`parity.json` SHALL list the providers `api-keys`, `claude-code`, `gemini`, `ollama` and `workers-ai`, in that order, the same as the rows of `docs/providers/README.md`. Every feature SHALL have a cell for each provider, and each cell's value SHALL be `tested`, `live`, `untested` or `no`.

#### Scenario: Providers match the command matrix
- **WHEN** `parity.json`'s providers are compared with the rows of `docs/providers/README.md`
- **THEN** they SHALL be the same names in the same order

#### Scenario: A cell with an unknown value is refused
- **GIVEN** a copy of `parity.json` with one cell's value `maybe`
- **WHEN** it is checked
- **THEN** the check SHALL report that cell

### Requirement: Every claimed cell cites evidence that exists
A `tested` or `live` cell SHALL cite at least one evidence entry, and an `untested` or `no` cell none. A `test` entry SHALL be the whole first-argument string of an `it(` or `test(` call in a `.ts` file under `packages/agent/__tests__/`. A `script` entry SHALL be an existing repo-relative file.

#### Scenario: Every cited test and script exists
- **WHEN** the repo's `parity.json` is checked
- **THEN** no evidence problem SHALL be reported

#### Scenario: A renamed test is caught
- **GIVEN** a copy of `parity.json` citing a test name that no test file has
- **WHEN** it is checked
- **THEN** the check SHALL report that name and its cell

#### Scenario: A tested cell without evidence is caught
- **GIVEN** a copy of `parity.json` with a `tested` cell and no evidence
- **WHEN** it is checked
- **THEN** the check SHALL report that cell

### Requirement: The parity matrix agrees with the command matrix
For the features `one-shot`, `durable`, `task` and `cloudflare`, a cell SHALL be `no` exactly when `docs/providers/README.md` says `no` for that provider in the column `agent`, `durable`, `task` or `cloudflare` respectively.

#### Scenario: The repo's matrices agree
- **WHEN** the repo's `parity.json` is compared with `docs/providers/README.md`
- **THEN** no disagreement SHALL be reported

#### Scenario: A contradiction is caught
- **GIVEN** a copy of `parity.json` saying `tested` for `ollama` on `cloudflare`
- **WHEN** it is compared with the command matrix
- **THEN** the check SHALL report that cell
