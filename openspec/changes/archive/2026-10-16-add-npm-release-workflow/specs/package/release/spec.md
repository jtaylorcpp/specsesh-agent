## Purpose
How `@specsesh/agent` and `specsesh` reach public npm: a version tag runs a GitHub Actions workflow that checks, packs and publishes both through npm trusted publishing with provenance, after a release check holds them to one version.

## ADDED Requirements

### Requirement: A version tag runs the release workflow
`.github/workflows/release.yml` SHALL run only on a pushed tag matching `v*`. Its job SHALL run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm pack:check` and `node scripts/release-check.mjs`, each before any `npm publish`, and SHALL publish the `@specsesh/agent` tarball before the `specsesh` tarball.

#### Scenario: Only a version tag triggers it
- **WHEN** the workflow's `on` is read
- **THEN** it SHALL be `push` with `tags` `["v*"]` and nothing else: no `branches`, `pull_request` or `workflow_dispatch`

#### Scenario: The checks run before any publish
- **WHEN** the job's `run` steps are read in order
- **THEN** the install, `pnpm check`, `pnpm test`, `pnpm pack:check` and the release check SHALL each come before the first `npm publish`

#### Scenario: The agent publishes before specsesh
- **WHEN** the job's `npm publish` steps are read in order
- **THEN** there SHALL be exactly two, the first publishing the `specsesh-agent-` tarball and the second the `specsesh-` tarball

### Requirement: Publishing is trusted publishing with provenance
The job's `permissions` SHALL be exactly `id-token: write` and `contents: read`. Each `npm publish` SHALL pass `--access public`, `--provenance` and `--tag` with the release check's dist-tag. The workflow SHALL NOT reference `NPM_TOKEN`, `NODE_AUTH_TOKEN` or any `secrets.`, and every `uses:` SHALL be pinned to a 40-character commit SHA.

#### Scenario: The job may mint an OIDC token and nothing more
- **WHEN** the job's `permissions` are read
- **THEN** they SHALL be exactly `id-token: write` and `contents: read`

#### Scenario: No npm token is referenced
- **WHEN** the workflow file is scanned
- **THEN** it SHALL NOT contain `NPM_TOKEN`, `NODE_AUTH_TOKEN` or `secrets.`

#### Scenario: Every publish is public with provenance
- **WHEN** each `npm publish` line is read
- **THEN** it SHALL contain `--access public`, `--provenance` and `--tag`

#### Scenario: Every action is pinned to a commit
- **WHEN** each `uses:` value is read
- **THEN** it SHALL end in `@` followed by 40 hexadecimal characters

### Requirement: The release check holds the tag to both versions
`node scripts/release-check.mjs <tag>` SHALL exit `0` only when both manifests' `version` are equal and valid semver, `<tag>` is `v` followed by that version, and `npm --version` is at least `11.5.1`. Otherwise it SHALL exit `1`, printing one stderr line per problem, each naming what it found. Without a tag it SHALL print usage and exit `2`.

#### Scenario: A matching tag passes
- **GIVEN** both manifests at `0.2.0` and npm `11.6.0`
- **WHEN** the check runs with `v0.2.0`
- **THEN** it SHALL exit `0`

#### Scenario: A tag that differs from a manifest is refused
- **GIVEN** both manifests at `0.2.0`
- **WHEN** the check runs with `v0.2.1`
- **THEN** it SHALL exit `1` and stderr SHALL name `v0.2.1` and `0.2.0`

#### Scenario: Unequal manifest versions are refused
- **GIVEN** `@specsesh/agent` at `0.2.0` and `specsesh` at `0.1.0`
- **WHEN** the check runs with `v0.2.0`
- **THEN** it SHALL exit `1` and stderr SHALL name both packages and both versions

#### Scenario: An old npm is refused
- **GIVEN** `npm --version` printing `10.9.2`
- **WHEN** the check runs with a matching tag
- **THEN** it SHALL exit `1` and stderr SHALL name `10.9.2` and `11.5.1`

### Requirement: The release check picks the dist-tag and checks the packed dependency
On success the check SHALL print exactly one stdout line, the dist-tag: `next` when the version has a prerelease part, `latest` otherwise. With `--packed <specsesh.tgz>` it SHALL also exit `1` unless the tarball's `package.json` depends on `@specsesh/agent` at exactly that version.

#### Scenario: A prerelease goes to next
- **GIVEN** both manifests at `0.2.0-rc.1`
- **WHEN** the check runs with `v0.2.0-rc.1`
- **THEN** stdout SHALL be `next`

#### Scenario: A release goes to latest
- **GIVEN** both manifests at `0.2.0`
- **WHEN** the check runs with `v0.2.0`
- **THEN** stdout SHALL be `latest`

#### Scenario: A packed range is refused
- **GIVEN** a `specsesh` tarball whose `@specsesh/agent` dependency is `workspace:*` or `^0.2.0`
- **WHEN** the check runs with `v0.2.0 --packed` that tarball
- **THEN** it SHALL exit `1` and stderr SHALL name the dependency it found
