## 1. pi port: tests for scenarios with none today

- [x] 1.1 `packages/agentscript-pi/__tests__/port.test.ts`: `RESULT_TOOL` equals `"submit_result"`; default `maxTokens` 4096; `onMessage` called once per step with the raw message; a structured step offers exactly one tool (name, parameters = schema, `constrainedSampling`, description); a text-only step has no `tools`; a text step ignores a `submit_result` call; an error with no message names its stop reason
- [x] 1.2 `packages/agentscript-pi/__tests__/port.test.ts`: `forceTool` for `bedrock-converse-stream`, `openai-responses`, `azure-openai-responses`, `google-generative-ai`, `google-vertex`, `mistral-conversations`
- [x] 1.3 `packages/agentscript-pi/__tests__/port.test.ts`: `categoryFromStatus` for `413` and `422`; `DEFAULT_PROVIDER` / `DEFAULT_MODEL` values; the unknown-model hint lists at most 12 ids

## 2. claude-code: tests for scenarios with none today

- [x] 2.1 `packages/agentscript-pi/__tests__/claude-code.test.ts`: the three `"claude-code"` constants; `claudeArgs` exact argv; schema and turn bound appended in that order; `onResult` sees each parsed result
- [x] 2.2 New `packages/agentscript-pi/__tests__/spawn-runner.test.ts`: a missing binary resolves with `spawnError` and `code: null`; a process past `timeoutMs` is terminated (e.g. `node -e` sleeping) and resolves `code: null`; stdin reaches the child; `cwd` is `os.tmpdir()`
- [x] 2.3 `packages/agentscript-pi/__tests__/claude-code-provider.test.ts`: only the four listed ids are registered (`claude-sonnet-4-5` is `undefined`); `cost.total` carries `total_cost_usd`; the three constants

## 3. CLI: tests for scenarios with none today

- [x] 3.1 New `packages/agentscript-pi/__tests__/cli.test.ts` (spawn `bin/agentscript-pi.mjs`; `main` is not exported): unknown command and no command exit 2 with usage; `run` without a file exits 2; a missing file exits 1 with `ENOENT`; `models` lists `claude-haiku-4-5\t…`; `models claude-code` text; `models nowhere` prints nothing and exits 0; an unknown model exits 1 with `UnknownModelError`
- [x] 3.2 `packages/agentscript-pi/__tests__/cli.test.ts`: env provider/model resolution, `--provider claude-code --model sonnet` reaches `claude --model sonnet`, text output shape, `--json` shape with `usage`, exit 1 on a failed run. These need a model without network: put a fake `claude` script first on `PATH` for the claude-code path, or report them as needing `main` to be injectable

## 4. Close

- [x] 4.1 `pnpm --filter agentscript-pi test` and `check` pass; each new test is named `Scenario: <exact scenario name>`
- [x] 4.2 `pnpm spec:archive baseline-pi-adapter`, then `pnpm spec:check`
