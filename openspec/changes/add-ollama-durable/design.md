## Context

`add-ollama-provider` gave `./pi` `ollamaProvider`, `ollamaModel` and `registerOllama(models, options?)` (sets the provider, refreshes it, resolves `{ ok, baseUrl, models | reason }`, never throws), and the fake server in `__tests__/pi/fake-ollama.ts`. `agentscript-durable` (`builtin()`) and `agentscript-task` (`io.models`, also used by `agentscript-change` and `spec-cli.ts`) each build the collection as built-ins plus `claude-code`, and every model check is a synchronous `getModel` or `getProvider`, including `resume`, which checks the stored model.

## Decisions

1. **One builder, one refresh step.** `src/bin/models.ts` (bins aren't a constrained layer) exports `cliModels()` (built-ins plus `claude-code`, no network) and `withOllama(models, refs)`: when any `ModelRef` in `refs` has provider `ollama` it awaits `registerOllama(models)` and returns its result, else returns `undefined` and touches nothing. Both bins and `agentscript-change` use them; the duplicate `builtin()` functions go. Injected `models` in tests still go through `withOllama`, so tests use the fake server.
2. **Where the refs come from.** `durable run`: the resolved `{ provider, modelId }`. `durable resume`: the stored task's input `model`. `task run`/groups/spec loops/`pick-tests`: the resolved model plus every `models` entry in the config. `task resume`/`answer`: the stored loop's `model` plus the config's `models` entries. `change` commands: as `task run`.
3. **The refusal suffix.** When the check fails and `withOllama` returned `{ ok: false }` for a model on `ollama`, the existing line gets ` (Ollama at <baseUrl>: <reason>)`. A reachable server without the model gets the plain line.
4. **Crash/resume.** A durable step's child conversation stores its model ref; on resume pi-durable streams through the collection, which now has the provider and its models. Nothing in `src/durable` changes.
5. **`pnpm test:ollama`.** `scripts/test-ollama.mjs`, opt-in like `test:live`: skips (exit 0, a `skipped:` line) when `GET $OLLAMA_HOST/api/tags` fails or lists no model; otherwise picks `OLLAMA_TEST_MODEL` or the first listed model, runs `agentscript-durable run` on `examples/triage.agent` killed with SIGKILL after its first step and resumed, then a one-task loop with the bundled `task` script on a temp copy of a fixture repo. It prints what each run ended as. Small models may fail a step; the script reports that instead of hiding it.

## Risks

- A small model may not follow the judge's `submit_result` contract. That is a model limit, not a bug here; `docs/llm/task.md` says so, and the live results go below.
