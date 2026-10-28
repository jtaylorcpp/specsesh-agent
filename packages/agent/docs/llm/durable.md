# specsesh durable: crash-safe runs

`specsesh durable` runs one Agent Script as a durable task in a SQLite database. Each step is checkpointed, so a run whose process dies resumes at the step it was on instead of starting over. Use it for long scripts outside a task loop; `specsesh task` and `specsesh change build` are already durable.

- `specsesh durable run <file> --db <path>` starts a run and prints `# task <id> — <outcome>`, each step, and the final variables. It takes the same `--provider`, `--model`, `--entry` and `--var name=value` as `specsesh agent run`, and `--json`.
- Before any model call, stderr names the run's task id. If the process dies, `specsesh durable resume <task-id> --db <path>` finishes it with the same database. Task ids are numbers.
- `run` and `resume` take `--tools <path>` (repeatable) and `--workspace <dir>` (default the working directory), loaded and refused as for `specsesh agent run` (see `specsesh agent help`, "Tools"), before the database opens. With `--tools`, the harness installs `agentScriptExtensions({ actions, workspace })` with the loaded tools, so the script's actions are checked at creation. Without it, a script that defines actions is refused, as before.
- `resume` must be given the same `--tools` and `--workspace` as `run`: the database doesn't store them. It checks the stored script against the loaded tools before resuming, and on a mismatch (including no `--tools` for a script that defines actions) prints the binding error, such as `mcpTool://echo is not registered on this host`, exits `2` and resumes nothing. The resume hint `run` prints already repeats those flags: `resume 7 --db runs.sqlite --tools ./tools.mjs`.
- `--provider claude-code` still fails `invalid_request` on a step that offers tools (`reasoning.actions`); `run @actions.x` statements need no model.

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
