## 1. The shared model builder

- [x] 1.1 `packages/agent/src/bin/models.ts`: `cliModels()` and `withOllama(models, refs)` (`design.md` decisions 1 and 3). `agentscript-durable.ts`: replace `builtin()` with `cliModels`; `run` calls `withOllama` with the resolved model before the model check, `resume` with the stored task's model before `harness.resume()`; the refusal gets the ` (Ollama at <url>: <reason>)` suffix. Tests in `__tests__/durable/cli.test.ts`, using `__tests__/pi/fake-ollama.ts`: "Scenario: A durable run completes on a pulled ollama model", "Scenario: Other providers never contact Ollama", "Scenario: An unreachable ollama is named in the refusal", "Scenario: A crashed ollama run finishes on resume" (child process `exit(137)` mid-second-step, as the existing crash test does). The existing durable CLI scenarios still pass

## 2. The task and change CLIs

- [ ] 2.1 `agentscript-task.ts` (`io.models` default, `run`, groups, `pick-tests`, `resume`, `answer`), `src/task/spec-cli.ts` and `agentscript-change.ts`: default `io.models` to `cliModels`, and call `withOllama` with the refs from `design.md` decision 2 before each model check; the refusal suffix as in 1.1. Tests in `__tests__/task/cli.test.ts` (and `cli-group.test.ts` for the group path, if a test needs it): "Scenario: A task loop converges on a pulled ollama model", "Scenario: A named model on ollama reaches the harness", "Scenario: An unreachable ollama is named in the refusal", "Scenario: Other providers never contact Ollama", "Scenario: A crashed ollama loop resumes on its model". The existing task and change CLI scenarios still pass

## 3. Live check and docs

- [ ] 3.1 `scripts/test-ollama.mjs` and a root `test:ollama` script (`design.md` decision 5), never run by `pnpm test`. `packages/agent/docs/llm/durable.md` and `docs/llm/task.md`: a local-model example (`--provider ollama --model <pulled id>`, a config with `"provider": "ollama"` and `"script": "task"`, a `models` entry on `ollama` for an `agent` delegate), noting the `claude_code` grant stays on Claude Code and small models may fail structured steps. `CLAUDE.md`: `pnpm test:ollama` in Commands. Run `pnpm docs:check`, `pnpm check` and `pnpm test`

The change ends with `pnpm change close add-ollama-durable`.
