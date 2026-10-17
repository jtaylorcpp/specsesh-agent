## Why

After `add-specsesh-package`, both packages pack and run, but nothing publishes them. Publishing by hand from a laptop needs a long-lived npm token and leaves no record of which commit was built. npm trusted publishing lets a GitHub Actions job publish with a short-lived OIDC token and attach provenance tying each version to its commit and workflow, and a release check keeps the two packages in lockstep.

## What Changes

- `.github/workflows/release.yml`: on a pushed `v*` tag only, install, `pnpm check`, `pnpm test`, `pnpm pack:check`, the release check, `pnpm pack` both packages, the check again on the packed `specsesh`, then `npm publish <tarball> --access public --provenance --tag <dist-tag>`, `@specsesh/agent` first.
- The job's permissions are `id-token: write` and `contents: read`; no npm token is stored or referenced, and every action is pinned to a commit.
- `scripts/release-check.mjs <tag> [--packed <specsesh.tgz>]`: refuses a tag that is not `v<version>` of both manifests, unequal or non-semver versions, an npm older than 11.5.1, or a packed `specsesh` whose `@specsesh/agent` dependency is not that exact version; otherwise prints the dist-tag, `next` for a prerelease and `latest` otherwise.

## Out of scope

- The npm-side setup and the first publish: manual steps in `design.md`.
- A pull-request CI workflow.
- Changelogs, GitHub releases and version bumping (the principal edits both manifests and tags).
- Publishing `@specsesh/ontology` (its own repository).

## Capabilities

- **New:** `package/release`.

## Impact

- New: `.github/workflows/release.yml`, `scripts/release-check.mjs`.
- Tests: `packages/agent/__tests__/repo/release-check.test.ts` and `packages/agent/__tests__/repo/release-workflow.test.ts` (new).
- `CLAUDE.md`: a Releasing section.
