## 1. Create the package and move the code (history-preserving `git mv`)

- [ ] 1.1 Create `packages/agent/` with `package.json` (name, version, license, type, engines, `exports`, `bin`, `files`, `dependencies`, `peerDependencies` + `peerDependenciesMeta`, `devDependencies`, scripts `build`, `check`, `test`), `LICENSE` (Apache License 2.0 full text), `tsconfig.json` (noEmit, includes `src` and `__tests__`), `tsconfig.build.json` (rootDir `src`, outDir `dist`, declaration, sourceMap, excludes tests), `vitest.config.ts`
- [ ] 1.2 `git mv packages/agentscript/src/{authoring,interpreter}` → `packages/agent/src/`; `packages/agentscript/scripts/check-subset-conformance.mjs` → `packages/agent/scripts/`; `packages/agentscript/__tests__/` → `packages/agent/__tests__/core/`
- [ ] 1.3 `git mv packages/agentscript-pi/src/{port,categories,models}.ts` → `packages/agent/src/pi/`; add `src/pi/index.ts` exporting only the pi surface (`pi/port`)
- [ ] 1.4 `git mv packages/agentscript-pi/src/claude-code.ts` → `packages/agent/src/claude-code/claude-code.ts` and `claude-code-provider.ts` → `src/claude-code/claude-code-provider.ts`; add `src/claude-code/index.ts` with the `pi/claude-code` export list (not `claudeArgs`, `spawnRunner`)
- [ ] 1.5 `git mv packages/agentscript-pi/src/cli.ts` → `packages/agent/src/bin/agentscript-pi.ts` (shebang, in-process `main`, `<name>: <message>` + exit 1 on an uncaught error); `packages/agentscript-pi/__tests__/` → `packages/agent/__tests__/pi/`
- [ ] 1.6 `git mv packages/agentscript-durable/src/{extension,result,host,index}.ts` → `packages/agent/src/durable/`; `src/cli.ts` → `packages/agent/src/bin/agentscript-durable.ts` (keep `main` and `parseVar` exported for tests); `__tests__/` → `packages/agent/__tests__/durable/`
- [ ] 1.7 Rewrite imports: `@coopcli/agentscript/interpreter` → relative `../interpreter/index.js`; `agentscript-pi` → `../claude-code/index.js` or `../pi/index.js`; tests' paths to the new layout; drop `tsx` everywhere
- [ ] 1.8 Delete `packages/agentscript/`, `packages/agentscript-pi/`, `packages/agentscript-durable/` (manifests, bins, tsconfigs, READMEs merged into `packages/agent/README.md`)

## 2. Cloudflare: publish the host, move the Worker

- [ ] 2.1 `packages/agent/src/cloudflare/index.ts`: `AgentScriptHost` (Workers AI via `createAI`, `AGENTSCRIPT_MODEL`, default `@cf/moonshotai/kimi-k2.7-code`), overridable provider/model and a pre-route hook for subclasses, start/GET/404 routes; no `AGENTSCRIPT_FAUX`/`fauxProvider`
- [ ] 2.2 `git mv packages/agentscript-cloudflare` → `examples/cloudflare-worker`; its `src/index.ts` becomes the Worker `fetch` handler plus `FauxAgentScriptHost extends AgentScriptHost` (faux provider, `AGENTSCRIPT_FAUX_TPS`, `AGENTSCRIPT_FAUX_SEED`, `faux` in start bodies, `POST /faux`, the 400s); `wrangler.jsonc` binds `HOST` to `FauxAgentScriptHost` (migration `v1` `new_sqlite_classes`)
- [ ] 2.3 `examples/cloudflare-worker/package.json`: private, depends on `"@specsesh/agent": "workspace:*"` plus `agents`, pi peers; `test` runs `test/crash-resume.sh && test/routes.sh` unchanged

## 3. Wording, examples, workspace

- [ ] 3.1 `src/interpreter/scan.ts` refusal and `src/interpreter/port.ts` `NoReasoningPortError`: `@coopcli/agentscript` → `@specsesh/agent`; update the asserting tests in `__tests__/core/`
- [ ] 3.2 `examples/hello-world`: depend on `"@specsesh/agent": "workspace:*"`, import `@specsesh/agent/durable` and `/claude-code`, run with plain `node` after build (no `tsx`)
- [ ] 3.3 `packages/agent/README.md`: install command, six entries with their peers, both bins
- [ ] 3.4 Root `package.json`: `build`, `pack:check` (`node scripts/pack-check.mjs`), `agent`/`durable` scripts point at the built bins; `pnpm-workspace.yaml` unchanged
- [ ] 3.5 `scripts/pack-check.mjs`: build, `npm pack` to a temp dir, install into a temp project with peers, import each Node entry, run the installed `agentscript-durable` on a faux model, print `ok <step>`, clean up
- [ ] 3.6 `CLAUDE.md`: layout table, commands, "raw .ts" note removed

## 4. Tests for new and modified scenarios

- [ ] 4.1 `packages/agent/__tests__/package/manifest.test.ts`: identity, license file, only one package publishes, exact exports map, files, bins wired and shebanged, tsx gone, four exact dependencies, optional peers, readme lists entries, no `@coopcli` in src/dist/readme/manifest, dist ignored
- [ ] 4.2 `packages/agent/__tests__/package/build.test.ts`: after `pnpm build`, every `src/**/*.ts` has `.js`, `.d.ts`, `.js.map`; none from `__tests__/`; `npm pack --dry-run --json` file list is clean
- [ ] 4.3 `packages/agent/__tests__/package/layers.test.ts`: the layer graph per directory (non-empty scan); nothing outside `src/cloudflare/` imports `agents` or `cloudflare:workers`; `src/cloudflare/` has no faux strings
- [ ] 4.4 `packages/agent/__tests__/core/`: update the modified core scenarios (authoring entry targets after build, module graph inside the core directories, only `@sf-agentscript/*` imported, no credential, `.reason(` site, the `@specsesh/agent` message scenario, no model client in the core)
- [ ] 4.5 `packages/agent/__tests__/pi/`: `@specsesh/agent/pi` carries no claude-code exports; `/claude-code` keeps `claudeArgs`/`spawnRunner` module-level; bin tests spawn `dist/bin/agentscript-pi.js`
- [ ] 4.6 `scripts/pack-check.mjs` scenarios: deep import and bare package name refused (`ERR_PACKAGE_PATH_NOT_EXPORTED`), core runs with no peer installed, installed `agentscript-pi models claude-code` without tsx, a broken `exports` target fails by name
- [ ] 4.7 `examples/cloudflare-worker/test/routes.sh`: the example object is `FauxAgentScriptHost`; base `GET /runs/<host>/999` still 404s in faux mode
- [ ] 4.8 `packages/agent/__tests__/package/examples.test.ts`: examples import only the six entries and never `packages/` relatively

## 5. Close

- [ ] 5.1 `pnpm check`, `pnpm test` (core, pi, durable, package), `pnpm build`, `pnpm pack:check`, `pnpm --filter cloudflare-worker-example test` (crash-resume + routes) all pass
- [ ] 5.2 `pnpm spec:archive package-specsesh-agent`, then `pnpm spec:check`
