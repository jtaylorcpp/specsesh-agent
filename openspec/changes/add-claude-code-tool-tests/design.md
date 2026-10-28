## Context

- **Provider sessions** (`src/claude-code/provider-session.ts`) are tested in `__tests__/pi/claude-code-sessions.test.ts` with a fake bridge and a scripted runner. Before this change, a throwaway probe ran the three new session paths, and all passed with no hang.
- **The durable end-to-end test** (`__tests__/durable/claude-code-tools.test.ts`) runs the built bin with a fake `claude` on `PATH`. The fake reads `--mcp-config`, calls the first allowed tool over MCP, and answers.
- **Opt-in live tests** use `vitest.live.config.ts` (`__tests__/live/**/*.live.test.ts`) and `claudeReady()` (`__tests__/live/ready.ts`), which skips without a logged-in `claude`.

## Decisions

1. **The crash.**
   - **The tool kills its host.** A fixture tools module, `__tests__/fixtures/tools/crash-echo.mjs`, has an `echo` (replay `safe`). Its `execute` calls `process.exit(137)` when `CRASH_ON_ECHO` is `1`. Host actions run in the bin's process, so this kills the host while pi-durable runs a call that Claude Code made and the provider handed out. The held fake `claude` is orphaned.
   - **The fake answers from the transcript.** When stdin contains `Tool echo returned`, the fake makes no call and answers `resumed: <the echoed text>`. That stands in for a model that sees the earlier result. It also appends its stdin to `$FAKE_CLAUDE_LOG`, so the test can read what each process was given.
   - **The orphan must not hang the test.** The fake exits when its MCP call fails, which happens when the host dies.
   - **Run 1:** `CRASH_ON_ECHO=1 … run …` exits `137`.
   - **Run 2:** `resume <id> --db … --tools <module>`, without the variable. The interrupted `safe` call replays, the provider finds no live session, and a fresh fake is given the transcript. It exits `0` and `completed`. The last logged stdin contains `[called echo with`, and the result's text starts `resumed:`.
2. **The live check, `__tests__/live/claude-code-tools.live.test.ts`.**
   - **Setup.** The model is Haiku. `describe.skipIf(!claudeReady().ok)` logs the reason when it skips. The checks run one at a time.
   - **Isolation by tokens.** The same question (`--system-prompt "You answer questions."`) runs twice: once with `claudeArgs` without `tools` (`--safe-mode`), and once with `claudeArgs` given the `tools` of a real `mcpBridge()` serving no tools. The second run has the same isolation flags, the same `--mcp-config` path, and `--allowedTools ""`, which Claude Code accepts (checked 2026-10-28: `success`). It adds no tool definitions, so the two runs' input tokens (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`) must be within 10% plus 100 tokens of each other. The global CLAUDE.md leak measured about +4000.
   - **Isolation by a sentinel.** A temp directory holds a `CLAUDE.md` saying `The project codeword is PERIWINKLE-4417.` The port runs a one-tool step there (`cwd`), asking for any codeword or `NONE`. The answer must not contain `PERIWINKLE-4417`.
     - **Positive control:** the same question through plain `claude -p` in that directory, with no isolation flags, must contain it. If it doesn't, the test fails as unable to detect a leak, rather than passing vacuously.
   - **A real tool call.** The port, with `mcpBridge()` and a recording host, runs a step offering `secret_number`. The tool answers `{ value: 4817 }`, a number the model can't guess. The test asserts the host was called once, `toolCalls` holds it, and the answer contains `4817`.
   - **Durable.** The built durable bin runs `examples/tools/tools.agent --entry echo_it --entry count_it --tools examples/tools/tools.mjs --provider claude-code --model haiku --json`. It must exit `0` with one `word_count` call recorded and `count` `6`.
   - **The script.** `pnpm test:claude-code`, in the root and in `packages/agent`, runs `vitest run --config vitest.live.config.ts __tests__/live/claude-code-tools.live.test.ts`. `pnpm test:live` also picks the file up, by its glob.
   - **Cost.** About six Haiku requests: notional on a subscription, a few minutes of wall time.
3. **Spec.** The scenarios are added to the existing requirements, which are otherwise unchanged. The live check is one ADDED requirement in `pi/claude-code`, as `test:live` is specified in `task/headless`.

## Decisions made during the build

- **A bug the new scenario found.** "A process that exits while a call is held ends the session" failed against `add-durable-claude-code-tools`'s code. The failure:
  - `nextEvent` waits one event-loop turn before handing out queued calls;
  - if the process ended in that turn, `end()` had already answered and emptied the queue;
  - so the request ended `toolUse` with no calls.

  The fix, in `src/claude-code/provider-session.ts`: after that turn, an empty queue returns the process's `done` event, so the request maps the result (here an error). The scenario and a second test both fail without the fix and pass with it. The throwaway probe run before this change didn't catch the bug: it only logged that path.
