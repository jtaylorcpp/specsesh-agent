## Context

Four workspace packages exist only to keep boundaries: the core must not import a model client, the durable layer builds on pi. A single npm package can keep those boundaries as entry points, enforced by tests, without making a consumer install and version four things.

## Layout after the change

```
packages/agent/                    @specsesh/agent
  src/authoring/   src/interpreter/        ← today's packages/agentscript/src
  src/pi/                                  ← packages/agentscript-pi/src
  src/durable/                             ← packages/agentscript-durable/src
  src/cloudflare/                          ← AgentScriptHost from packages/agentscript-cloudflare/src
  src/bin/agentscript-pi.ts  src/bin/agentscript-durable.ts
  __tests__/{core,pi,durable}/...
  scripts/check-subset-conformance.mjs
examples/hello-world/              depends on "@specsesh/agent": "workspace:*"
examples/cloudflare-worker/        the Worker + wrangler.jsonc + crash-resume.sh + routes.sh
```

## Decisions

- **One package with subpath exports, not four packages.** One version, one install. The `exports` map lists each entry with `types` and `import` conditions; there is no root `.` export, so nothing pulls in every layer by accident.
- **The import boundary moves from package to directory.** Today's import-boundary test checks the core imports only its declared dependencies. After the change it checks that `src/authoring` and `src/interpreter` import only `@sf-agentscript/*`, `node:` built-ins and each other; `src/pi` adds pi-ai; `src/durable` adds pi-durable and chord; only `src/cloudflare` may import `agents` or `cloudflare:workers`.
- **Optional peers.** `@earendil-works/pi-ai`, `pi-durable`, `chord` and `agents` are `peerDependencies` with `peerDependenciesMeta.optional: true`, pinned to the versions tested (`^1.1.0` for pi; `^0.28.0` for agents). They are also dev dependencies, so the workspace tests run.
- **tsc, not a bundler.** `tsc -p tsconfig.build.json` emits `dist/` file-for-file, so `.d.ts` paths match the exports and stack traces map to source. The existing `.js`-suffixed relative imports already satisfy NodeNext.
- **Bins are compiled entry points** (`dist/bin/*.js` with a shebang); `tsx` leaves the dependency list.
- **`cloudflare:workers` stays external.** `src/cloudflare` is compiled like the rest and is only loadable inside workerd; the pack check skips importing it under Node and instead the Worker example bundles it with wrangler.
- **The faux test hooks stay in the Worker example**, not in the published `AgentScriptHost`. The published class takes its model choice from the constructor's env (`AGENTSCRIPT_MODEL`, Workers AI by default); `AGENTSCRIPT_FAUX*` handling moves to a subclass in `examples/cloudflare-worker`. This is the one place code is reshaped rather than moved, and its routes and status codes stay as specced.

## Verification

- All existing suites pass from the new locations (core 231, pi, durable 68, Worker crash and route scripts).
- `pnpm pack:check`: build, `npm pack`, install the tarball in an empty temp project with only the peers it needs, `node -e "import('@specsesh/agent/<entry>')"` for every Node entry, run `agentscript-durable run` from the installed bin on a faux model, and confirm the tarball holds no `src/`, `__tests__/` or `.ts` outside `.d.ts`.
- `examples/cloudflare-worker` passes its crash and route scripts against the built package.

## Risks

- **The `AgentScriptHost` split** could break the Cloudflare scripts. They run unchanged against the example, which is the check.
- **Peer ranges** wider than tested (`^1.1.0`) may admit a breaking pi minor. pi is 1.x; revisit if it breaks.
