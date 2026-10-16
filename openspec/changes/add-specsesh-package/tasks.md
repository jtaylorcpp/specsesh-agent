## 1. The specsesh package

- [ ] 1.1 `packages/specsesh/package.json` (new): the manifest design.md gives in full under "The package", version equal to `packages/agent`'s
- [ ] 1.2 `pnpm-lock.yaml`: run `pnpm install` so the workspace links `packages/specsesh` and its dependencies from 1.1
- [ ] 1.3 `packages/specsesh/bin/specsesh.js` (new): the bin design.md shows under "The bin", calling `main` from `@specsesh/agent/cli`
- [ ] 1.4 `packages/specsesh/LICENSE` (new): a byte-for-byte copy of `packages/agent/LICENSE`
- [ ] 1.5 `packages/specsesh/README.md` (new): the npm page design.md outlines under "The READMEs"

## 2. The agent package

- [ ] 2.1 `packages/agent/package.json`: add `repository` with `url` `git+https://github.com/jtaylorcpp/specsesh-agent.git` and `directory` `packages/agent`
- [ ] 2.2 `packages/agent/README.md`: list `@specsesh/agent/cli` among ten entries and point the command-line section at `npx specsesh`

## 3. Tests

- [ ] 3.1 `packages/agent/__tests__/package/manifest.test.ts`: "Both manifests identify their package", "The license files are Apache 2.0", "Only the two packages publish" and "Every entry is documented" (4)
- [ ] 3.2 `packages/agent/__tests__/package/specsesh.test.ts` (new): "The specsesh manifest is exact", "The bin imports only the cli entry", "The workspace bin prints the version" and "The specsesh readme shows how to run it" (4)
- [ ] 3.3 `packages/agent/__tests__/package/pack.test.ts`: `pnpm pack` specsesh, then "The installed specsesh prints its version" and "The packed specsesh pins the agent exactly" (2)
- [ ] 3.4 `packages/agent/__tests__/package/pack.test.ts`: keep "A clean tarball passes", "A broken entry fails by name" and "The installed task bin prints its usage" passing with the second tarball (3)

## 4. Docs

- [ ] 4.1 `CLAUDE.md`: the Layout section names two packages, `@specsesh/agent` and the `specsesh` command in `packages/specsesh`
