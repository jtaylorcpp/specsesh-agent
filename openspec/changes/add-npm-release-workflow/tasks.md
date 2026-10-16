## 1. The release check

- [ ] 1.1 `scripts/release-check.mjs` (new): tag, version, npm and `--packed` checks and the dist-tag, as design.md's "The release check" says, reading manifests under `RELEASE_CHECK_ROOT`
- [ ] 1.2 `packages/agent/__tests__/repo/release-check.test.ts` (new): "A matching tag passes", "A tag that differs from a manifest is refused", "Unequal manifest versions are refused" and "An old npm is refused" (4)
- [ ] 1.3 `packages/agent/__tests__/repo/release-dist-tag.test.ts` (new): "A prerelease goes to next", "A release goes to latest" and "A packed range is refused", against the script from 1.1 (3)

## 2. The workflow

- [ ] 2.1 `.github/workflows/release.yml` (new): the job of design.md's "The workflow", every action pinned to a commit SHA
- [ ] 2.2 `packages/agent/__tests__/repo/release-workflow.test.ts` (new): "Only a version tag triggers it", "The checks run before any publish" and "The agent publishes before specsesh", reading the file from 2.1 as text (3)
- [ ] 2.3 `packages/agent/__tests__/repo/release-trust.test.ts` (new): "The job may mint an OIDC token and nothing more", "No npm token is referenced", "Every publish is public with provenance" and "Every action is pinned to a commit" (4)

## 3. Docs

- [ ] 3.1 `CLAUDE.md`: a Releasing section: lockstep versions, tag `v<version>`, the release workflow and `scripts/release-check.mjs`, and never `npm publish` by hand after the first
