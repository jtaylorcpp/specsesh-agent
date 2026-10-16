# Design: add-npm-release-workflow

## Context

Slice 3 of `add-specsesh-command`'s `slices.md`. After `add-specsesh-package` there are two publishable packages, `@specsesh/agent` (`packages/agent`) and `specsesh` (`packages/specsesh`), released in lockstep at one version (the policy is in `add-specsesh-command/design.md`, "Versioning"). The repository `jtaylorcpp/specsesh-agent` is public, which npm provenance requires, and the `specsesh` npm org exists, owned by `jtaylorcpp`.

npm trusted publishing (docs.npmjs.com/trusted-publishers, read 2026-10-16): a GitHub Actions job with `id-token: write` publishes with a short-lived OIDC token instead of a stored token. It needs npm CLI 11.5.1+ and Node 22.14+. Provenance is attached automatically for a public package from a public repository; this workflow still passes `--provenance` so the intent is visible and tested. A trusted publisher is configured per package on npmjs.com (or with `npm trust`, npm 11.15+), **and only for a package that already exists on the registry**, so the very first publish of each package is manual.

## The workflow

`.github/workflows/release.yml` (full draft in `design/examples/release.yml`; rendered run in `design/mock.html`):

1. `on: push: tags: ["v*"]`, nothing else. A tag is the only way to publish.
2. One job, `publish`, on `ubuntu-latest`, `permissions: { id-token: write, contents: read }`.
3. Checkout, pnpm (`packageManager`'s version), Node 24 with `registry-url: https://registry.npmjs.org`. Every `uses:` pinned to a full commit SHA with the tag in a comment.
4. `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm pack:check` (it builds `dist/` in its global setup).
5. `node scripts/release-check.mjs "$GITHUB_REF_NAME"` → the dist-tag, saved as a step output.
6. `pnpm --filter @specsesh/agent pack --pack-destination ../../release` and the same for `specsesh` (pnpm rewrites `workspace:*` to the exact version).
7. `node scripts/release-check.mjs "$GITHUB_REF_NAME" --packed release/specsesh-<v>.tgz`.
8. `npm publish release/specsesh-agent-<v>.tgz --access public --provenance --tag <dist-tag>`, then the same for `release/specsesh-<v>.tgz`.

If `@specsesh/agent` publishes and `specsesh` fails, re-running the job fails on the agent (version exists). The fix is to publish `specsesh` from a re-run of only that step, or to cut the next patch. Not automated here.

## The release check

`scripts/release-check.mjs` (sketch in `design/examples/release-check.mjs`), no dependencies:

- Reads `packages/agent/package.json` and `packages/specsesh/package.json` under the repository root: the script's parent directory, or `RELEASE_CHECK_ROOT` when set, which the tests point at fixture trees.
- Semver: `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`, no build metadata. Prerelease → `next`, else `latest`.
- npm version from `npm --version` on PATH; the tests put a fake `npm` first on PATH, as other tests fake `claude` and `pnpm`.
- `--packed <tgz>`: `tar -xzOf <tgz> package/package.json`, then compare `dependencies["@specsesh/agent"]` with the version.
- Every problem is collected before exiting, one stderr line each; stdout holds only the dist-tag.

## Cutting a release

1. Edit `version` in both `packages/agent/package.json` and `packages/specsesh/package.json` (same value), commit on `main`.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. Watch the `release` workflow; check `npm view @specsesh/agent@0.2.0` and the provenance badge on npmjs.com.

## Manual steps (not tasks)

The npm org `specsesh` already exists (created by the principal), so `@specsesh/*` can be published. In order:

1. **Before the first publish.** Make sure two-factor authentication is on for the `jtaylorcpp` npm account (`npm trust` and the trusted-publisher settings require it). Land slices 1–3 (and, preferably, 4–5) on `main`.
2. **First publish, by hand, once per package.** A trusted publisher can only be attached to a package that exists, so each package's first version goes up from a local checkout of the tag, with no provenance:
   ```sh
   git checkout v0.1.0
   pnpm install --frozen-lockfile && pnpm check && pnpm test && pnpm pack:check
   node scripts/release-check.mjs v0.1.0                       # prints latest
   pnpm --filter @specsesh/agent pack --pack-destination ../../release
   pnpm --filter specsesh pack --pack-destination ../../release
   node scripts/release-check.mjs v0.1.0 --packed release/specsesh-0.1.0.tgz
   npm login                                                   # interactive, 2FA
   npm publish release/specsesh-agent-0.1.0.tgz --access public
   npm publish release/specsesh-0.1.0.tgz --access public
   ```
   `@specsesh/agent` first, since `specsesh` depends on it. Do **not** push the `v0.1.0` tag before this, or the workflow will try (and fail) to publish it without a trusted publisher. If a placeholder is preferred so that 0.1.0 itself carries provenance, publish `0.0.1` by hand instead and let the workflow publish `0.1.0`.
3. **Attach the trusted publisher to each package**, on npmjs.com (package → Settings → Trusted Publisher → GitHub Actions: owner `jtaylorcpp`, repository `specsesh-agent`, workflow filename `release.yml`, environment empty), or with npm 11.15+:
   ```sh
   npm trust github @specsesh/agent --repo jtaylorcpp/specsesh-agent --file release.yml --allow-publish
   npm trust github specsesh --repo jtaylorcpp/specsesh-agent --file release.yml --allow-publish
   ```
   npm does not validate these fields, and they are case-sensitive. A new configuration expires unless it completes a publish within 2 days, so cut the next tag within that window (or reconfigure).
4. **First workflow publish.** Bump both manifests to the next version (e.g. `0.1.1`), tag, push the tag, and confirm both versions show provenance on npmjs.com.
5. **Lock it down.** For each package: Settings → Publishing access → "Require two-factor authentication and disallow tokens". Revoke any automation token that existed for publishing.

## Open questions

- A GitHub environment (`environment: npm`, with required reviewers) would add a manual approval before each publish; it then has to be named in the trusted publisher too. Not included; easy to add.
- The action SHAs to pin are chosen at implementation time (latest `actions/checkout`, `actions/setup-node`, `pnpm/action-setup` majors).
