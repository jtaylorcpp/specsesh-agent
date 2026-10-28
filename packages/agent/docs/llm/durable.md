# specsesh durable: crash-safe runs

`specsesh durable` runs one Agent Script as a durable task in a SQLite database. Each step is checkpointed, so a run whose process dies resumes at the step it was on instead of starting over. Use it for long scripts outside a task loop; `specsesh task` and `specsesh change build` are already durable.

- `specsesh durable run <file> --db <path>` starts a run and prints `# task <id> — <outcome>`, each step, and the final variables. It takes the same `--provider`, `--model`, `--entry` and `--var name=value` as `specsesh agent run`, and `--json`.
- Before any model call, stderr names the run's task id. If the process dies, `specsesh durable resume <task-id> --db <path>` finishes it with the same database. Task ids are numbers.
- `run` and `resume` take `--tools <path>` (repeatable) and `--workspace <dir>` (default the working directory), loaded and refused as for `specsesh agent run` (see `specsesh agent help`, "Tools"), before the database opens. With `--tools`, the harness installs `agentScriptExtensions({ actions, workspace })` with the loaded tools, so the script's actions are checked at creation. Without it, a script that defines actions is refused, as before.
- `resume` must be given the same `--tools` and `--workspace` as `run`: the database doesn't store them. It checks the stored script against the loaded tools before resuming, and on a mismatch (including no `--tools` for a script that defines actions) prints the binding error, such as `mcpTool://echo is not registered on this host`, exits `2` and resumes nothing. The resume hint `run` prints already repeats those flags: `resume 7 --db runs.sqlite --tools ./tools.mjs`.
- `run` and `resume` also take `--mcp <file>` (repeatable), loaded and refused as for `specsesh agent run` (see `specsesh agent help`, "MCP servers"), before the harness opens. The MCP tools (`mcpTool://<server>/<tool>`) join the `--tools` actions in one registry. `resume` needs the same `--mcp` files: without them a script calling an MCP tool is refused with `not registered on this host`, exit `2`. The resume hint repeats them: `resume 7 --db runs.sqlite --mcp .mcp.json`. Each process connects its own servers, and closes them after the harness closes; an unsafe call cut off by a crash is reported, not repeated.
- `--provider claude-code` with `--tools` or `--mcp` offers a step's tools (`reasoning.actions`) to Claude Code over the local MCP bridge (`mcpBridge()`). Claude Code calls them, but each call still runs in the harness as a checkpointed host action: under its replay rule, recorded in the step's actions, and seen by `watchScript` as `tool_call`/`tool_result`. A crash loses only the held `claude` process; `resume` starts a fresh one on the transcript so far, and no finished call runs again. See the [claude-code provider page](../providers/claude-code.md#durable-tool-steps).

Exit `0` when the run completes, `1` when it doesn't, and `2` on usage or a refusal (an unknown model, an unknown task id), with the reason on stderr.

## Local model (Ollama)

```bash
specsesh durable run x.agent --db runs.sqlite --provider ollama --model qwen3:8b
```

- The model is one you pulled (`ollama pull qwen3:8b`). The server is `OLLAMA_HOST`, default `http://127.0.0.1:11434`. No key is needed.
- The server is contacted only when the run's model is on `ollama`. Any other provider makes no request to it.
- `resume` finishes a run on the model it was started on, so a run started on `ollama` resumes on the same pulled model.
- An `ollama` model that doesn't resolve is refused before a task exists, exit `2`: `no model "<model>" on provider "ollama"`. When the server didn't answer, the line ends with ` (Ollama at <url>: <reason>)`.
- Small models may fail a structured step (one that has to call `submit_result`). That is the model's limit, and the run ends `failed`.

## Watching a run (library only)

`watchScript(harness, id, context)` from `@specsesh/agent/durable` streams a durable run's `RunEvent`s. No CLI streams, and no host offers a streaming route.

- **Returns** `{ [Symbol.asyncIterator], result, stop() }`: the same `RunEvent` type and iterable-plus-`result` shape as `streamRun`. `result` settles as `waitForScript(harness, id, context)` would. `stop()` detaches this watcher and ends its iterator; the run carries on. Iterable once; iteration ends after `run_end`.
- **Event sources.**
  - The run's checkpoint, followed through `harness.watchTaskGraph`: entering `await` gives `step_start`, an applied step `step_end`, entering `act` `action_start`, a settled action `action_end`, a terminal task `run_end`.
  - The step conversation's `watchEvents`: message changes give `text_delta` and `thinking_delta`; tool executions give `tool_call` (the model's arguments overlaid with the offer's `bound` inputs, as the pi port reports them) and `tool_result`. `submit_result` emits nothing.
- **History on attach.** A late watcher first gets `step_start`/`step_end` for each applied step and `action_start`/`action_end` for each settled action, with no deltas; then the in-flight step's `step_start` and its text so far as one `text_delta`; then live events. A watcher of a finished run gets the history and `run_end`.
- **Coarser deltas.** Deltas come at pi-durable's commit pace (`partialIntervalMs`), coarser than a one-shot stream. A step watched from its start still joins to its final text.
- **Read-only.** Several watchers may attach; each has its own unbounded buffer, so a slow reader loses nothing.
- **In-process only.** It watches runs of the harness it is given; it can't watch a run another process owns.
- **Refusals.** An id naming another kind of task: `task <id> is a <kind> task, not agentscript.run`. An id with no task: `agentscript run <id> does not exist`. Both reject `result` and throw from the iterator.
- Runtime-neutral (no `node:` imports): a Durable Object can use it.

```ts
const id = await startScript(harness, source, { entry: ["greet", "sign_off"] }, context);
const w = watchScript(harness, id, context);
void harness.resume();
for await (const ev of w) if (ev.type === "text_delta") process.stdout.write(ev.delta);
const result = await w.result;
```
