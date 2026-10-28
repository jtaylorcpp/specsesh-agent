## Context

`run()` takes one `actionHost(call: ActionCall)` for `run` statements. After `add-pi-tool-loop`, `createPiReasoningPort` takes a `tools: PiToolHost` for offered tools. The durable side already has the whole host model: `HostAction`, `createActionRegistry`, `checkBindings` and `agentScriptExtensions({ actions, workspace })`, all in `./durable` and runtime-neutral. Both bins live in `src/bin`, which may import any layer.

## Goals / Non-Goals

**Goals:** a CLI user hands a script their own tools; one tool shape (`HostAction`) for library and CLI, one-shot and durable; refusals before any model call.

**Non-Goals:** MCP (`add-mcp-tools`); the task loop's config; built-in registration flags; module sandboxing.

## Decisions

1. **A module is the unit.** `--tools ./tools.mjs` is loaded with `import(pathToFileURL(resolve(cwd, path)))`. It may be `.mjs` or `.js` (ESM), or `.cjs` through Node's interop. TypeScript files are not loaded: the bins run without `tsx`, and the docs say to compile. The export read is `default`, else `tools`. A function is called once with `{ workspace }` and awaited. Several `--tools` are concatenated in flag order, then `createActionRegistry` refuses duplicates.
2. **Shape check (`loadTools`).** Each entry must be an object with:
   - a non-empty `name`;
   - `kind` in the four kinds;
   - `inputs` and `outputs` plain objects whose values are `string`, `number` or `boolean`;
   - `replay` `safe` or `unsafe`;
   - `execute` a function.

   An entry with `durable`, or a `delegate/` name, is refused here, before the registry's own check, with a module-specific message. Every message has the form `--tools <path>: <problem>` (for entry problems, `--tools <path>: tool <n|name>: <problem>`), and the exit code is `2`. An import that throws is reported the same way with the error's message.
3. **`registryHost(registry, { workspace, signal? })` in `src/durable/tool-host.ts`.** It returns `{ actionHost(call), toolHost(call) }`. Both look up `call.tool`:
   - **Missing:** `{ ok: false, message: "mcpTool://<tool> is not registered on this host" }`.
   - **`durable` action:** `{ ok: false, message: "<tool> runs only in a durable host" }`.
   - **Otherwise:** `execute(inputs, { workspace, signal })`. A throw becomes `ok: false` with the message. An `ok: true` result whose outputs don't match the declared names and types becomes `ok: false` naming the mismatch, the same rule `run` outputs follow under the durable host (`extension.ts`). Reuse that check if it is exported, or move it to `actions.ts` and use it from both.
4. **`agent run`.** Tools are loaded before the provider is resolved, and the bindings are checked (`checkBindings(source, registry)`) before any port is created, so a refused run never touches Ollama or a model. The run gets `actionHost` and, on a pi provider, the port gets `tools: toolHost`. Without `--tools`, behaviour is unchanged: no `actionHost`, no tool host, and the existing errors.
5. **`durable run` and `resume`.** With `--tools`, `Harness.open` is given a registry that has `agentScriptExtensions({ actions, workspace })`'s `run` and `step` installed in place of the plain pair. Without `--tools`, it gets the plain pair as today. `resume` reads the stored task's script (`task.input.source`) and calls `checkBindings` with the loaded registry before `harness.resume()`. On a mismatch it prints the error and exits `2`, and nothing resumes. pi-durable does not store the tools: the user passes them again, and the resume hint printed by `run` includes the same `--tools` and `--workspace` flags.
6. **Spec deltas avoid editing the flag lists.** New flags arrive as ADDED requirements ("run also takes --tools…", "the usage also lists…") rather than by modifying the existing option-list requirements, so `add-mcp-tools` can add its own flags beside them without both changes rewriting one requirement. The single MODIFIED requirement is the durable harness's extension pair, which this change genuinely changes.

## Testing

Fixture modules in `__tests__/fixtures/tools/`: a default array, a named `tools` function, a throwing import, a bad entry and a duplicate. One-shot tests use the faux provider injected through the bin's `models` dependency; durable tests use the existing crash fixtures' pattern (a child process killed mid-step, then `resume --tools`).

## Risks

- **A resumed run with different tools.** If the stored script still binds, a resume with a different module that has the same names is accepted. That is the user's choice, like resuming with a different binary, and the docs say to pass the same flags.
- **Module side effects at import.** They are the user's code, run once per process.

## Verified live

2026-10-27, from the repo root, on a local Ollama server, `qwen3.5:latest`:

- **One-shot.** `node packages/agent/dist/bin/agentscript-pi.js run packages/agent/examples/tools/tools.agent --entry echo_it --entry count_it --tools packages/agent/examples/tools/tools.mjs --provider ollama --model qwen3.5:latest --json` exited `0`, kind `completed`:
  - `echo` ran from `echo_it`'s `run` statement, with no model call, and set `echoed` to `"Agent Script runs your own tools"`.
  - In `count_it`, the model called the offered `word_count` once with that text. The call answered `{ count: 6 }`, and the step ended `answered` (`"6"`).
  - Final variables: `text` and `echoed` were `"Agent Script runs your own tools"`, and `count` was `6`.
- **Durable.** `node packages/agent/dist/bin/agentscript-durable.js run packages/agent/examples/tools/tools.agent --db /tmp/add-cli-tools-live.db --entry echo_it --entry count_it --tools packages/agent/examples/tools/tools.mjs --provider ollama --model qwen3.5:latest` ended `# task 7 — completed` with `count = 6`. Its stderr hint was `agentscript-durable resume 7 --db /tmp/add-cli-tools-live.db --tools packages/agent/examples/tools/tools.mjs`. The process wasn't killed, so `resume` wasn't exercised live.

## Decisions made during the build

- **A flaky group check.** Group 4's first group check failed only on `task/worktree.test.ts` "Two tasks run at once": a git worktree lock race, outside this change. The recommended path was to rerun the checks and accept the group if they passed. They passed (group loop 636), and the race is parked in `openspec/parked.md`.
