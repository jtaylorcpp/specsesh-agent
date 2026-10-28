## 1. The adapter and the loader

- [ ] 1.1 `packages/agent/src/durable/tool-host.ts`: `registryHost` (`design.md` decision 3), exported from `src/durable/index.ts`, sharing the declared-outputs check with `extension.ts` (move it into `actions.ts` if it is private). Tests in `__tests__/durable/tool-host.test.ts`: "Scenario: A registered tool runs through both hosts", "Scenario: An unregistered tool is refused", "Scenario: Wrong outputs are refused", plus a durable action answered `runs only in a durable host`
- [ ] 1.2 `packages/agent/src/bin/tools.ts`: `loadTools(paths, { cwd, workspace })` (`design.md` decisions 1–2) answering `{ ok: true, registry, actions }` or `{ ok: false, message }`. Fixture modules under `__tests__/fixtures/tools/`: `echo.mjs` (default array), `fn.mjs` (named `tools` function recording its argument), `throws.mjs`, `no-execute.mjs`, `durable.mjs`, `dupe.mjs`. Unit tests in `__tests__/pi/tools-loader.test.ts` for each refusal's message

## 2. agentscript-pi

- [ ] 2.1 `packages/agent/src/bin/agentscript-pi.ts`: `--tools` and `--workspace`, the usage text, binding check before any port, `actionHost` and the port's `tools` from `registryHost` (`design.md` decision 4). Tests in `__tests__/pi/cli.test.ts`: "Scenario: A script calls a tool from a module", "Scenario: The model calls an offered tool from a module", "Scenario: A function export gets the workspace", "Scenario: An entry without execute is refused", "Scenario: A script naming a missing tool is refused", "Scenario: Without --tools nothing changes". Existing scenarios still pass

## 3. agentscript-durable

- [ ] 3.1 `packages/agent/src/bin/agentscript-durable.ts`: `--tools`/`--workspace` on both commands, loaded before the harness opens; `agentScriptExtensions` in place of the plain pair when given; the resume hint repeats them (`design.md` decision 5). Tests in `__tests__/durable/cli.test.ts`: "Scenario: The harness is closed after a refusal" (still), "Scenario: A durable run calls a tool from a module", "Scenario: The resume hint repeats the tools", "Scenario: A bad tools module is refused before the database opens"
- [ ] 3.2 `resume` re-checks bindings against the stored script before `harness.resume()`. A crash fixture under `__tests__/durable/fixtures/` running a tool script with `--tools`, killed with `exit(137)` mid-step. Tests: "Scenario: A crashed tool run resumes with its tools", "Scenario: A resume without the tools is refused"

## 4. Docs and example

- [ ] 4.1 `packages/agent/examples/tools/`: `tools.mjs` (an `echo` and a `word_count`) and `tools.agent`, which runs one tool and offers the other. `docs/llm/agent.md` and `docs/llm/durable.md`: the flags, the module shape, and that `claude-code` still refuses offered tools. README `## Run it once`: a two-line `--tools` example. `openspec/parked.md`: replace the `agentscript-durable … refused there` note with what remains (built-ins from the CLI). `scripts/check-assets.mjs` if it lists examples. Run `pnpm docs:check`, `pnpm check`, `pnpm test`, and run the example once live on Ollama (`--provider ollama --model qwen3.5:latest`), recording the result in `design.md` under "Verified live"

The change ends with `pnpm change close add-cli-tools`.
