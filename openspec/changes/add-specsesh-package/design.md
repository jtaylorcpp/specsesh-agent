# Design: add-specsesh-package

## Context

Slice 2 of `add-specsesh-command`'s `slices.md`; the reasons for an unscoped `specsesh` package, the lockstep versioning and staying self-contained until `@specsesh/ontology` is public are in that change's `design.md` ("The plan across slices"). In short: `npx` needs a package whose single bin is the command and whose dependencies include the Node peers that `@specsesh/agent` keeps optional. `npm view specsesh` answered 404 on 2026-10-16, and the `specsesh` npm org exists, owned by `jtaylorcpp`.

## The package

`packages/specsesh/package.json` (full text in `design/examples/package.json`):

- `name` `specsesh`, `version` equal to `@specsesh/agent`'s, `license` `Apache-2.0`, `type` `module`, `engines.node` `>=22.19.0`.
- `bin` `{ "specsesh": "./bin/specsesh.js" }`; `files` `["bin", "README.md", "LICENSE"]`.
- `exports` `{ "./package.json": "./package.json" }`: nothing to import, but tools may read the version.
- `dependencies`: `@specsesh/agent` `workspace:*`, and `@earendil-works/pi-ai`, `pi-durable`, `chord` at `1.1.0`, exact, the versions in `@specsesh/agent`'s `devDependencies`. Exact pins make `npx specsesh@0.1.0` resolve the same tree every time; the agent's own peer ranges (`^1.1.0`) stay for library users. `agents` is not a dependency: `specsesh` never loads `./cloudflare`.
- `repository` (both packages): `git+https://github.com/jtaylorcpp/specsesh-agent.git` with `directory`. npm provenance checks the attestation against this URL, so it must match the repository the workflow runs in.
- No `scripts`, no build: `bin/specsesh.js` is the published file as written. `pnpm -r check` and `pnpm -r test` skip it; its tests live in `packages/agent/__tests__/package/`.

`workspace:*` is why the release packs with `pnpm pack`: pnpm rewrites it to the exact version (`"@specsesh/agent": "0.1.0"`) in the tarball, and `npm pack` would not. The pack check reads the packed manifest to prove it.

## The bin

`packages/specsesh/bin/specsesh.js` is `design/examples/specsesh.js`: shebang, one import, the same interrupt handlers as the `agentscript-task` and `agentscript-change` entry guards (so a `SIGINT` still releases the database lock), `process.exit(await main(argv))`, and an error line plus exit `1` for anything thrown.

## The READMEs

- `packages/specsesh/README.md` (outline in `design/examples/README.md`) is the npm page: what it is in two lines, `npx specsesh --help`, `npm install --save-dev specsesh`, the four commands with one example each, prerequisites (Node 22.19, `openspec` 1.14.1+ in the project for `change`, `claude` logged in for `--provider claude-code`, or a pi provider key), and a link to the guides.
- `packages/agent/README.md` lists the tenth entry, `@specsesh/agent/cli`, and its "Command-line tools" section says to use `npx specsesh` rather than the `agentscript-*` bins.

## The pack check

`__tests__/package/pack.test.ts` gains a project with only the two tarballs (`npm install <agent.tgz> <specsesh.tgz>`): npm satisfies `specsesh`'s exact `@specsesh/agent` dependency with the local tarball because the versions match, and installs the three peers from the registry as ordinary dependencies. It then runs `node_modules/.bin/specsesh --version` and `node_modules/.bin/specsesh task`, and reads `package/package.json` out of the `specsesh` tarball (`tar -xzO`). `design/mock.html` shows the run.

## Risks

- If npm refuses the name `specsesh` at first publish (too close to an existing name), the fallback is `@specsesh/cli` with the same bin; only `name`, the READMEs and the tests change.
- Installing from two local tarballs relies on npm deduplicating `@specsesh/agent` by version; if it does not, the test installs the agent tarball first, then `specsesh`.
