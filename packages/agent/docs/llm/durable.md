# specsesh durable: crash-safe runs

`specsesh durable` runs one Agent Script as a durable task in a SQLite database. Each step is checkpointed, so a run whose process dies resumes at the step it was on instead of starting over. Use it for long scripts outside a task loop; `specsesh task` and `specsesh change build` are already durable.

- `specsesh durable run <file> --db <path>` starts a run and prints `# task <id> — <outcome>`, each step, and the final variables. It takes the same `--provider`, `--model`, `--entry` and `--var name=value` as `specsesh agent run`, and `--json`.
- Before any model call, stderr names the run's task id. If the process dies, `specsesh durable resume <task-id> --db <path>` finishes it with the same database. Task ids are numbers.
- A script that defines actions is refused here: this command installs no host actions. Use `specsesh task` for scripts that act on a workspace.

Exit `0` when the run completes, `1` when it doesn't, and `2` on usage or a refusal (an unknown model, an unknown task id), with the reason on stderr.
