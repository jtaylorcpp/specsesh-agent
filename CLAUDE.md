# agentscript

Solo project. Agent Script (Salesforce's agent language) as an authoring format, plus our own
interpreter over a declared subset of it. Spun out of coopcli on 2026-10-10 from tag
`archive/pre-unspecced` (`packages/agentscript`); the pre-split history lives in coopcli
(`5adc6fb2`, `a393f49a`, `c38e7f95`, `6e819b8f`, `baf124c9`). coopcli's OpenHypothesis/OpenSpec
flow does **not** apply here.

## Layout (pnpm workspace)

One npm package, `@specsesh/agent` (`packages/agent`, Apache-2.0), with an entry point per layer:
nine exports, in this order: `./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`,
`./node`, `./cloudflare`, `./openspec`, `./task`. The layer boundaries are directories, enforced by
`__tests__/package/layers.test.ts`.

| Directory → entry | What it is |
|---|---|
| `src/authoring`, `src/interpreter` → `./authoring`, `./interpreter` | The core: authoring + interpreter. No model client, ever. |
| `src/pi` → `./pi` | A `ReasoningPort` on `@earendil-works/pi-ai`, so any pi provider can run a script. Default testing model: `anthropic/claude-haiku-4-5`. |
| `src/claude-code` → `./claude-code` | The claude-code port and pi provider (Node only). |
| `src/durable` → `./durable` | A pi-durable extension: each run is a crash-safe `agentscript.run` task. Works in any pi-durable host (Node SQLite/JSONL/memory, or a Durable Object). Runtime-neutral: never imports `node:` or `src/claude-code`, so `./cloudflare` can import it. Holds `workspace.ts` (`Workspace`, `workspaceActions`, `runChecks`, `diffSnapshots`), `delegation.ts` (grants, `delegationActions`), `agent-runner.ts` (`agentRunner()`, the `agent` runner: checks a grant against the harness's models and registry, runs it as a durable host action whose child ID commits with the `act` checkpoint, answers `{ ok, summary, files_changed }`; also in node `defaultRunners`), `delegate-scripts.ts` (`READ_AGENT`, `EDIT_AGENT` as source strings, no file system, so they work in Workers; the delegate contract: `instructions` seeded, `ok` and `summary` read back) and `agent-config.ts` (`AgentConfig`, `createAgentHarness`). |
| `src/node` → `./node` | The Node side of `./durable`: `localWorkspace(dir)`, `builtinActions` (moved from `src/durable/builtins.ts`), `claudeCodeRunner({ binary? })` and `defaultRunners`. Adds `src/durable` and `src/claude-code`. |
| `src/cloudflare` → `./cloudflare` | `AgentScriptHost`, the Durable Object class (via Cloudflare's `PiHarness`, `agents` 0.28.0), Workers AI by default. |
| `src/openspec` → `./openspec` | The OpenSpec ontology (`openspec/{model,process,loops,evidence}`): TypeBox schemas (each a JSON Schema) with `Static` types and refinements, plus pure rules. Imports only `typebox`; no parser, no loop runner. |
| `src/task` → `./task` | The task loop (`agentscript.task-loop`): an Agent Script run once per iteration as an `agentscript.run` child until the task converges, blocks, exhausts or fails; ticks tasks.md. Bundled scripts in `src/task/scripts/` (copied into `dist/` by the build). Adds `src/node`. |
| `src/bin` | The `agentscript-pi`, `agentscript-durable` and `agentscript-task` bins. |

pi-ai, pi-durable, chord and `agents` are optional peers (dev dependencies here); only the four
`@sf-agentscript/*` packages and `typebox` (exact `1.3.27`, the version pi-ai pins) are required. `examples/hello-world` and `examples/cloudflare-worker`
(the Worker, with `FauxAgentScriptHost` adding `AGENTSCRIPT_FAUX=1` for local tests) consume the
package through `workspace:*` and its public entries only.

## Where it stands

- `./authoring` — parse, mutate with undo/redo, lint, over `@sf-agentscript/*`. Was used by
  specsketch's settings tab as a prompt editor.
- `./interpreter` — subset scan, prompt composition, logic lines, structured state, three step
  outcomes. Core tests drive a recording port; pi tests drive pi's faux provider.
- `./pi` — one `reason()` = one pi `complete()`. Structured steps offer a single
  `submit_result` tool and force it per wire API (`forceTool`). Failure categories come only from
  `stopReason` and the HTTP status, never from message text. The port has no round bound, so it
  never reports `cut-short`.
- `--provider claude-code` (`src/claude-code.ts`) — the subscription option. Each step spawns your own
  `claude -p --safe-mode --tools "" --no-session-persistence --output-format json [--json-schema]`,
  with `ANTHROPIC_API_KEY` stripped so the subscription login is used. **Never** read or forward
  Claude Code's OAuth token to pi or any other client: that is against Anthropic's terms (coopcli
  withdrew exactly that in `simplify-specsketch-workbench`), and a test pins its absence.
  `--safe-mode` is required: without it your global CLAUDE.md leaks into every step. Never `--bare`
  (it forces API-key auth). First live run: 2026-10-10, triage example, Haiku 4.5, completed.
  (This is the reasoning port, which offers no tools; a delegate's `claudeCodeRunner` is different,
  see Hard lines.)

- **Step machine** (`start` / `next` / `apply` in `run.ts`): the run's state is plain JSON (`RunState`),
  `next` is pure, and `run()` is a loop over the three. A failed step rolls back only its own logic
  lines; logic-only subagents before it stay committed. This is what durable hosts checkpoint.
- **`./durable`**: task phases `next` → `dispatch` (create a task-owned child conversation
  for the step, in one commit) → `await` (submit with request ID `agentscript:<task>:<step>`, wait,
  `apply`). Each step is a fresh conversation: system block as `instructions`, its prompt, and
  `submit_result` only when it writes variables, its parameters the step's schema (so
  `claude --json-schema` enforces the types). The tool validates the call as sent against the step
  schema (in the `agentscript.step` doc, shown via a `result` section), returns errors for the model
  to retry, the third refusal failing the step, and ends the run with `control.terminate`. Task IDs are numbers; a string ID makes `waitForTask` hand
  back a stale record.
- Verified: crash/resume on node SQLite (child process `exit(137)` mid-step, fresh harness finishes)
  and on local Durable Object storage (`kill -9` workerd mid-step, restart, run completes).
  Live: `examples/hello-world` ran durably on Claude Haiku 4.5 via the claude-code pi provider,
  both branches (2026-10-10). Not yet verified: Lifecycle's alarm waking an idle Durable Object
  with no incoming request.
- **claude-code pi provider** (`src/claude-code/claude-code-provider.ts`): lets any pi host,
  pi-durable included, run on your subscription locally. Flattens system sections into
  `--system-prompt`, the transcript into the stdin prompt, and one offered tool into
  `--json-schema` (returned as a tool call). Refuses requests offering more than one tool.
- **This is a library** consumed from other projects, not a deployed service. `examples/` holds
  consumers. `pnpm build` (tsc) emits `packages/agent/dist/`, which the exports, the bins and the examples use;
  `pnpm pack:check` proves the packed tarball installs and runs in an empty project. Cloudflare is not
  deployed yet: never `wrangler deploy`.

## Commands

```bash
pnpm check                      # tsc in every package (builds packages/agent/dist first)
pnpm test                       # agent: conformance + vitest (core, pi, durable, package); no network, no wrangler
pnpm pack:check                 # vitest (__tests__/package/pack.test.ts): npm pack, install into empty projects,
                                # import every entry, run the bins. Needs the npm registry, so not in `pnpm test`
pnpm build                      # tsc → packages/agent/dist (the bins below run from it)
pnpm agent run packages/agent/examples/triage.agent --provider claude-code   # your subscription
pnpm agent run packages/agent/examples/triage.agent        # pi, needs ANTHROPIC_API_KEY
pnpm agent run <file> --provider openai --model gpt-4o-mini --var name=value --json
pnpm agent models anthropic     # list a provider's models
pnpm durable run <file> --db runs.sqlite [--provider --model --entry --var --json]   # durable, pi-ai
pnpm durable resume <task-id> --db runs.sqlite                                      # finish a crashed run
pnpm durable run <file> --db runs.sqlite --provider claude-code                     # durable, on your subscription
pnpm task <change-id> <task-id>                      # see "Running a task"
pnpm --filter hello-world-example start [name]                                      # the example app, on Haiku
pnpm --filter cloudflare-worker-example dev    # wrangler dev; add --var AGENTSCRIPT_FAUX:1 without an account
pnpm test:cloudflare            # opt-in, not in `pnpm test`: crash/resume (kill -9 mid-step) + route scripts, local DO storage
pnpm spec:check                 # openspec validate --all --strict
pnpm spec:archive <change-id>   # archive, only if the change and a trial fold both validate --strict
pnpm docs:check                 # docs/ concept pages: front matter, ids, README index, spec refs, links
```

Provider/model also come from `AGENTSCRIPT_PROVIDER` / `AGENTSCRIPT_MODEL`; credentials are pi's
env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ...). The bins are compiled JavaScript;
nothing needs `tsx`.

## Running a task

`agentscript.config.json` holds the task runner's defaults for this repo: the claude-code provider
(your subscription) running the bundled `task-delegate` script on Opus (`model` is `opus`),
`maxIterations` 8, checks `pnpm check` and `pnpm test`, allowlist `pnpm` and `node`, the
`claude_code` delegate grant (below), and the database `.agentscript/task-loops.sqlite`
(gitignored). Build first (`pnpm build`); flags override any `task` value, never a grant.

```bash
pnpm task <change-id> <task-id>        # work one task of openspec/changes/<change-id>, unattended
pnpm task <change-id> --next           # the first unticked task; prints "no unticked task in …" when done
pnpm task <change-id> <task-id> --worktree --db .agentscript/<change-id>-<task-id>.sqlite
pnpm task <change-id> <group>          # a bare integer is a group (2), n.m is a task (2.1)
pnpm task <change-id> --next-group     # the first group with an unticked task
pnpm task add-group-loop 2 --worktree --db group-2.sqlite   # a group, in its own worktree
pnpm task status                       # loops: id, change, task or `group <n>`, status, iterations (and branch)
pnpm task resume <loop-id>             # finish a loop whose process died (worktree loops: same --db)
pnpm task answer <loop-id> --by principal --decision "…"   # a blocked loop prints this exact command
```

- **When the loop converges.** A task iterates until its checks pass or it runs out of budget, and
  iterating is the default. A `met` verdict converges only when every configured check passes: the
  loop runs the checks itself in a `gate` phase, with no model. If a check fails, the iteration is
  recorded unmet, the failing commands and the last part of their output go into the next
  iteration, and the loop retries within budget. With no checks configured, `met` alone converges.
- **The budget.** `maxIterations` defaults to 8 in the library and the CLI. This repo's
  `agentscript.config.json` also sets 8.
- **`next_action` is constrained.** It must be exactly one of `retry`, `amend-spec` or `ask` in the
  task loop, and one of `rework`, `ask` or `amend-spec` in the group loop. The loop passes these as
  start `choices`, so the judge's `submit_result` schema shows them as an `enum`. A value outside
  them sets no variable and fails the step. A script whose default `next_action` is outside them is
  refused at start. The bundled judges retry by default: `amend-spec` only when the deltas
  contradict themselves or the code, and `ask` only for a decision no passing check could settle.
- **Delegates are granted, never defaulted.** Delegation is opt-in: nothing is granted unless the
  top-level `delegates` object of `agentscript.config.json` (reviewed with the repo) grants it. Each
  name maps to `{ runner, model?, tools?, allow?, permissionMode: "dontAsk", context?, timeoutMs?,
  maxCalls? }`; defaults are the six Claude Code tools (`Read`, `Edit`, `Write`, `Glob`, `Grep`,
  `Bash`), `allow []`, `context []`, `timeoutMs` 900000 and `maxCalls` 5. `context` paths resolve
  against the config file. This repo grants `claude_code` (runner `claude-code`, model `opus`, allow
  `["pnpm","node"]`, context `["CLAUDE.md"]`), which `task-delegate` calls as
  `mcpTool://delegate/claude_code`. `run --no-delegates` withdraws every grant for one run: a
  delegating script then exits 2 naming `delegate/claude_code`, while `--script task` still runs.
  The retired `task.delegateModel` and `task.delegateContext` keys are refused with
  `grant a delegate under "delegates" instead`; an invalid grant exits 2, naming the grant and the
  key. No CLI flag can grant or reconfigure a delegate.
- **Agent delegates.** Runner `agent` delegates to one of our own scripts, on a model the config names:
  ```json
  "models": { "reviewer": { "provider": "anthropic", "model": "claude-haiku-4-5" } },
  "delegates": { "reviewer": { "runner": "agent", "model": "reviewer", "script": "read",
    "tools": ["read_file", "list_files", "search_files"], "maxSteps": 20, "maxCalls": 5 } }
  ```
  - `script` is `read` (`READ_AGENT`), `edit` (`EDIT_AGENT`) or a path relative to the config file.
  - `model` is `default` (the run's own) or a key of `models`. Redefining `models.default`, an
    unknown provider or model, or a missing script path exits 2.
  - `tools` defaults to `read_file`, `list_files`, `search_files`, and `maxSteps` to 20. `tools`
    cannot include `delegate/…`: delegates don't nest.
  - Call it with `run @actions.<x>` and `instructions`; it answers `{ ok, summary, files_changed }`.
    Offering it under `reasoning.actions` is refused with `call it with run`.
  - It runs as a durable child `agentscript.run` in the caller's workspace, so a crash resumes the
    same child. A harness refuses a bad grant with `DelegateGrantError`.
- **Delegations act through the workspace.** A delegate acts only in the loop's workspace, and each
  delegation records `files_changed` (the number of files it changed, or -1 when the workspace can't
  snapshot).
- **Headless.** It never prompts. Progress is JSON Lines on stderr after the resume hint; the outcome
  is on stdout. Exit `0` converged, `1` blocked/exhausted/failed, `2` refused.
- **Clean tree.** `run` refuses uncommitted changes (listing them) so every edit after it is the
  loop's; `--allow-dirty` overrides. `loop-ended.changed` lists the files the loop changed.
- **It never commits.** It runs only `git status`, `rev-parse`, `worktree add` and `worktree list`.
  Review the diff and commit yourself.
- **`--worktree`** runs the task in `../<repo>-worktrees/<change-id>-<task-id>` on branch
  `task/<change-id>/<task-id>`, from `HEAD` (commit the change first), after
  `pnpm install --frozen-lockfile --prefer-offline`. The main tree is untouched, so you can keep working and
  run several tasks at once, each with its own `--db` (mandatory here). Review with
  `git -C <path> diff`; remove with `git worktree remove <path>` (and `git branch -D <branch>`).
- **Groups.** `pnpm task <change> <group>` runs the group's unticked tasks in file order (ticked ones
  are skipped, so a re-run continues), then the group check: the configured `checks` once more (a group
  needs at least one). The `group.agent` judge may then rework a task, ask, or amend the spec.
  `--max-reworks <n>` (default 2) bounds the reworks; `--group-script <name|path>` picks the judge
  (default the bundled `group`). Config fields: `groupScript`, `maxReworks`.
- **Group exit codes.** `0` converged; `1` blocked, exhausted or failed; `2` usage or a refused start.
- **Group worktree.** `--worktree` uses `<worktreeDir>/<change-id>-<group>` on branch
  `task/<change-id>/<group>`; `--db` is explicit, as for a task.
- **Group loops in `status`/`resume`/`answer`.** `status` lists `group <n>` beside its task loops.
  `resume <loop-id>` and `answer <loop-id> --by … --decision …` work on group loops; a blocked
  task reruns with the decision carried in.
- **Group events** (JSON Lines on stderr): `group-started`, `group-check`, `rework`, `group-ended`;
  task events carry `group`. Text output: `# group loop <id> — <status>`, then
  `## task <id>: <status> (runs n)` per task, then `## group check: passed|failed`.
- One live process per database (`<db>.lock`); a second is refused, naming the holder's pid.
- `pnpm test:live` (opt-in, never in `pnpm test`) runs it for real on a copy of this repo, on your
  subscription; it skips when `claude` is missing or not logged in.

## Specs (OpenSpec 1.14.1, pinned)

`openspec/specs/<area>/<capability>/spec.md` is the contract: `core/{authoring,subset,composition,
reasoning-port,step-machine}`, `pi/{port,cli,claude-code}`, `durable/{run-task,host,cli,cloudflare}` and
`package/distribution`. Specs state public
behaviour only; internals go in a change's `design.md`. Stock `spec-driven` schema.

- Every behaviour change starts as `openspec new change <verb-led-id>` with deltas against these specs.
- One test per scenario, named `Scenario: <exact scenario name>`.
- A task names at most about 8 scenarios. Split a capability's tests across tasks rather than
  writing one task for all of them.
- **Never `openspec archive` directly.** 1.14.1 archives invalid changes with exit 0 and drops
  requirements; `pnpm spec:archive` refuses unless the change validates and a trial fold into a temp copy of `openspec/` validates too.
- A delta that creates a capability should carry `## Purpose`: it is only read at creation, and
  archive otherwise writes a placeholder that `spec:check` rejects.
- Requirement text (before its scenarios) must stay under 500 characters, or strict fails.
- Tests never read `openspec/changes/<id>/` for their own change: archiving moves it. Read the folded
  spec from `openspec/specs/` or the archived copy under `openspec/changes/archive/<date>-<id>/`.
- Ideas and bugs outside the current change go in `openspec/parked.md`.
- `docs/` holds the OpenSpec taxonomy and ontology, one concept per file; `docs/README.md` is the
  directory and `docs/CONVENTIONS.md` the page format. A change to the ontology specs updates the
  matching pages in the same commit, and `pnpm docs:check` must pass.
- Set `OPENSPEC_TELEMETRY=0` when calling `openspec` by hand (the scripts already do).

## Hard lines (see README.md for the reasoning)

- Never call or depend on the upstream compiler (`@sf-agentscript/agentforce`).
- No model client, SDK or credential in the core (`src/authoring`, `src/interpreter`). Provider code lives in `src/pi` and `src/claude-code`. Model turns go through the injected `ReasoningPort`.
- Upstream deps are exact-pinned. Bumping one means running `pnpm conformance` and treating a failure as a decision about the subset.
- The supported subset is declared once, in `src/interpreter/subset.ts`; the README block is generated from it.
- `claudeCodeRunner` (`src/node/claude-code-runner.ts`), the only way a delegate reaches Claude Code,
  keeps these lines (the retired `delegate_claude_code` action is gone):
  - `claude -p --safe-mode`, never `--bare` (it forces API-key auth) and never `--tools ""`;
  - `--permission-mode dontAsk` only;
  - `--allowedTools` is the file tools plus `Bash(<word>:*)` per `allow` entry, so anything else is
    denied, never prompted;
  - `ANTHROPIC_API_KEY` and `CLAUDECODE` are stripped from the child's environment;
  - Claude Code's OAuth token is never read, copied or forwarded: subscription auth only;
  - the instructions go only on stdin, followed by the terms block.

`packages/agent/__tests__/core/{import-boundary,no-compiler}.test.ts` and `__tests__/package/layers.test.ts` enforce the first two.
