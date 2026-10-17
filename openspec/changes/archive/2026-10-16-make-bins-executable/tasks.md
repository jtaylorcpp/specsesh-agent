## 1. The build

- [x] 1.1 `packages/agent/scripts/chmod-bins.mjs` (new): `chmod 0755` every `bin` target of the manifest in its directory, or of the manifest at `CHMOD_BINS_MANIFEST` when set (for the tests), exiting `1` naming a missing target, as design.md says
- [x] 1.2 `packages/agent/package.json`: `build` and `check` end with `&& node scripts/chmod-bins.mjs`
- [x] 1.3 `packages/specsesh/bin/specsesh.js`: committed with git mode `100755` (`git update-index --chmod=+x` if it is not)
- [x] 1.4 `packages/agent/README.md`: the first code block gives `npm install -g specsesh` and `npx specsesh` for the command line, then the library install and its peers

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/package/bins.test.ts` (new): "Every built bin is executable", "A built bin runs directly", "A missing bin target is named", "The specsesh bin is committed executable" and "The install block names specsesh" (5)

## 3. Verify

- [x] 3.1 `pnpm check`, `pnpm test` and `pnpm spec:check` pass
