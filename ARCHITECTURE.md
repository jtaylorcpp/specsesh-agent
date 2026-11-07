# Architecture

How specsesh is put together, what each part is for, and where each part is going. Snapshot: `main`
at `194539c` (0.4.6), 2026-11-06.

The live diagrams are in `blueprint/` (open them in Herdr's Blueprint panel; `blueprint/index.mmd` is
the root). They draw only what the code has. This page holds what a diagram can't: the model, the
decisions, and the gaps between the two.

## The model

specsesh is four subsystems, published as one library.

| Subsystem | What it is for | Code |
|---|---|---|
| **CLI** | One way into the library: the `specsesh` command. | `src/cli`, `src/bin`, `packages/specsesh` |
| **Agent harness** | The agent primitive: a durable run that takes a model. | `src/durable`, `src/node`, `src/mcp`, `src/cloudflare`, `src/pi`, `src/claude-code` |
| **Agent Script** | How one agent is oriented and tuned, and what drives its run. | `src/authoring`, `src/interpreter`, the bundled `.agent` scripts |
| **OpenSpec workflow** | An opinionated use of the other three: iterate an OpenSpec change to done. | `src/task`, `src/openspec` |

Paths under `src/` are in `packages/agent/`.

- **The library is the product; the CLI is one front end.** `@specsesh/agent` exports each layer as
  its own entry (`./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`, `./node`,
  `./mcp`, `./cloudflare`, `./openspec`, `./task`, `./cli`), so another product or harness can use
  the harness and Agent Script without the CLI or the OpenSpec workflow.
  `__tests__/package/layers.test.ts` enforces the directory boundaries.
- **The script drives the harness.** A durable run asks the interpreter's step machine (`next`) for
  the next step or action, carries it out (a model turn or a host action), and hands the outcome back
  (`apply`). The step machine's state (`RunState`) is plain JSON, which is what pi-durable checkpoints.
- **The workflow layer runs scripts on the harness.** Every loop iteration is an `agentscript.run`
  child task running a bundled `.agent` script.

## Agent harness

### Today

- **Durable run** (`src/durable/extension.ts`). `agentscript.run` is a pi-durable task with the phases
  `next` → `dispatch` → `await` → `act`. Each model step is a fresh pi-durable conversation; a step
  that writes variables offers `submit_result`, whose parameters are the step's schema. A crashed run
  resumes from its last commit (verified on Node SQLite and on local Durable Object storage).
- **Model interface.** A pi-ai `Provider`/`ModelRef`. `cliModels` (`src/bin/models.ts`) registers
  pi-ai's built-in providers (Anthropic, OpenAI, Google for Gemini, …), Ollama and the Claude Code
  provider.
- **Tools.** One registry of host actions:
  - workspace actions: `read_file`, `edit_file` (a whole file), `replace_in_file` (exact text),
    `run_command`, `list_files`, `search_files`, and `delete_file` only when granted;
  - argv builtins (`src/node/builtins.ts`);
  - MCP server tools, as `<server>/<tool>` (`src/mcp`);
  - granted delegates (below).

  A script reaches them two ways: `run @actions.x` runs one from code in the `act` phase, with no
  model; `reasoning.actions` offers them to the model as tools in the step's conversation, and each
  call runs on the host.
- **Delegates.** Opt-in grants under `delegates` in `agentscript.config.json`. Runner `agent` runs one
  of our scripts (`read`, `edit` or a path) as a child run, and is the only runner the CLI has. A
  library host may bring its own process runners (`ProcessRunner`), passing the same `runners` to the
  harness and to the loop starts (`TaskLoopOptions.runners`). Delegates don't nest.
- **Hosts.** Node: SQLite storage, `localWorkspace`, `defaultRunners`. Cloudflare: `AgentScriptHost`
  and `defineAgentHost` (Durable Objects), Workers AI, Sandbox and Artifacts workspaces. Cloudflare
  is not deployed.
- **Streaming.** `watchScript(harness, id)` (`src/durable/watch.ts`) turns a durable run into
  `RunEvent`s: step and action start and end, `text_delta` and `thinking_delta` from the step's
  conversation, and tool calls. A watcher that attaches late gets the history first.

### Claude Code

Supported as convenient model access on a Claude subscription, with no API key. Every use is a
headless `claude -p --no-session-persistence`: there is no long-lived or resumed Claude Code
session. Claude Code's OAuth token is never read or forwarded. It is model access only:

| Role | Code | Who runs the tools | Fate |
|---|---|---|---|
| pi provider (model access) | `src/claude-code/claude-code-provider.ts`, `provider-session.ts` | Our harness. Claude Code's tool calls come back through a loopback MCP bridge as pi tool calls; a held `claude -p` lasts one step, up to `maxTurns` turns (default 100) of at most `timeoutMs` each (default 5 minutes, not counting tool time). | Keep. |
| `ReasoningPort` | `src/claude-code/claude-code.ts` | Our host, through the same bridge. | Goes with the one-shot path (#29). |
| Delegate runner (`claudeCodeRunner`) | removed | Claude Code itself, with its own file tools. | **Removed** (2026-11-06), with the bundled `task-delegate.agent`. |

Every agent that works in a repo must be able to read and edit files and run commands. The workspace
actions give that to any model, Claude Code included, so the delegate runner was a redundant second
route; the bundled `task` script does that work on the Claude Code provider. Everything the delegate did
better is back: listing and searching files in the act step (#42), the repository's own context
files (`task.context`, #43), a string-replacement edit (`replace_in_file`, #36), and room for a
coding step on Claude Code (`maxTurns`, default 100, set by `--max-turns` or `task.maxTurns`; #37).
A held session's `timeoutMs` (5 minutes) is per turn and stops while its calls are with our host, so
long checks don't count against it (`--turn-timeout` or `task.turnTimeoutMs`).

### Decisions

- **Claude Code is model access only.** No delegate runs Claude Code with its own tools.
- **One execution model: durable** (#29). The non-durable path goes:
  - `run()`, `streamRun()` and `ReasoningPort` in `src/interpreter` (the interpreter keeps
    `start`, `next` and `apply`);
  - `createPiReasoningPort` and its tool loop (`src/pi/port.ts`);
  - `createClaudeCodeReasoningPort` (`src/claude-code/claude-code.ts`);
  - `registryHost` (`src/durable/tool-host.ts`);
  - their callers: `specsesh agent run` (`src/bin/agentscript-pi.ts`) and `pickTests`
    (`src/task/test-pick.ts`).

  A one-shot run would become a durable run on in-memory storage, which pi-durable already supports.
- **Carry over first** (#28): failure categories (`authentication_failed`, `rate_limit`, `overloaded`,
  …) come only from the one-shot ports. Durable runs report `unknown`.

### Gaps for a UI

Tools in durable runs work. Streaming exists in the library, but:

- nothing consumes `watchScript` yet: no CLI output uses it, and the Cloudflare routes only start a run
  and read its result (#30);
- the Claude Code provider streams no text: a step's text arrives whole (#31);
- structured steps stream no text (#32).

## Agent Script

- **Language.** Salesforce's Agent Script, parsed and linted by the exact-pinned `@sf-agentscript/*`
  packages (`src/authoring`); we never use its compiler. We interpret a declared subset, listed once
  in `src/interpreter/subset.ts`: subagents, prompt lines, logic lines (`if`, `else`, `set`), typed
  variables, structured outputs, `run` actions and `reasoning.actions`.
- **Interpreter.** `scanDocument` refuses anything outside the subset; `compose` builds each step's
  system block, prompt and tool offers; `start`, `next` and `apply` are the step machine. The core
  has no model client, SDK or credential.
- **A script orients and tunes one agent:** its instructions, its procedure (subagents in order,
  branches), what it may call, and what it must answer.
- **No agent runs without a script.**

### Catalog

The start of a catalog of off-the-shelf scripts. `specsesh agent list` and `specsesh agent show`
read it from what ships (`src/cli/bundled.ts`): every `.agent` file in `src/task/scripts/`, plus the
delegate scripts, which ship as source strings (`src/durable/delegate-scripts.ts`) so a Worker can
use them. A script added to either shows up with no code change.

| Script | Run by | What it does |
|---|---|---|
| `task` | `specsesh task <change> <task>` (the default) | One task-loop iteration: orient, act, check, judge. |
| `group` | `specsesh task <change> <group>` | After a failed group check: rework a task, ask, or amend the spec. |
| `spec-proposal` | `specsesh change draft` (proposal stage) | Drafts `proposal.md` from the principal's words. |
| `spec-design` | `specsesh change draft` (design stage) | Drafts `design.md`, an HTML mock and example code. |
| `spec-specify` | `specsesh change draft` (specs stage) | Derives the spec deltas from the approved proposal and design. |
| `spec-plan` | `specsesh change draft` (tasks stage) | Writes `tasks.md`: small, single-action tasks. |
| `ci-test-pick` | `specsesh task pick-tests` | Picks the tests that cover one closed task. |
| `read` | a delegate grant, `"runner": "agent", "script": "read"` | Reads, lists and searches. |
| `edit` | a delegate grant, `"runner": "agent", "script": "edit"` | Also edits files and runs commands. |

`examples/agents/` teaches the language one feature at a time (`01-hello` to `05-model-tools`);
`06-custom-task-agent` is a custom task script for `specsesh task … --script <path>`.

## OpenSpec workflow

- **Loops**, each a pi-durable task: `agentscript.task-loop`, `group-loop`, `change-loop`,
  `draft-loop` and `spec-loop`. Nesting: change → group → task → run, and draft → spec → run.
- **Commands:** `specsesh change draft | approve | build | close` and `specsesh task …`.
- **Ontology:** `src/openspec`, TypeBox schemas for OpenSpec's model, process, loops and evidence.

### Generic and OpenSpec-specific

Both live in `src/task` today. The generic part (iterate until the checks pass, and what supports
it) is to be extracted so other workflows can use it (#33). A first cut of the line; the extraction's
design settles it:

| Generic loop machinery | OpenSpec-specific |
|---|---|
| `iterate` → `await` → `judge` → `gate` (`loop.ts`), `runLoopChecks` (`checks.ts`) | `tasks.md` parsing and ticking (`tasks-md.ts`, `tick.ts`), `resolve.ts` |
| the script contract: seeded and read-back variables, `next_action` choices (`contract.ts`; its `amend-spec` paths are OpenSpec's) | the task preamble's proposal, design and deltas (`preamble.ts`, `deltas.ts`) |
| files changed since the loop's baseline (`changed.ts`) | spec stages, gates and bundles (`spec-*.ts`, `stages/`) |
| escalations and answers (`answer.ts`), resume (`resume-all.ts`), status (`status.ts`) | `approvals.json` (`spec-approvals.ts`) |
| one process per database (`lock.ts`, `owner.ts`), worktrees (`worktree.ts`, `git.ts`), events (`events.ts`) | amendments, trial fold and archive (`amend.ts`, `cmd-close.ts`, `openspec-bin.ts`) |
| config (`config.ts`) | groups and changes as `tasks.md` and the change directory define them (`group.ts`, `change-loop.ts`) |

The ontology (`src/openspec/loops.ts`: budget, verdict, iteration, escalation) is mostly generic too;
where it goes is part of the same design.

## Next

1. **Codify where we are:** this page and `blueprint/`. Done; this repo plans with them, GitHub
   issues and `parked.md` (loose ends), no longer with OpenSpec changes of its own.
2. **All durable:** failure categories in durable runs (#28), then remove the one-shot path (#29).
3. **Close the gaps the delegate left.** Done: search in the act step (#42), context files (#43),
   `replace_in_file` (#36) and the Claude Code turn limit (#37).
4. **Stream to a UI:** consume `watchScript` (#30), Claude Code provider text (#31), structured steps (#32).
5. **Extract the generic loop** from `src/task` (#33).
6. **Blueprint workflows:** users define their own software-factory flows and agents (scripts), with
   OpenSpec as one flow among them (#34).
7. **Grow the catalog** of off-the-shelf scripts (#35).

Open question: where does the generic loop live, in the harness or in a layer of its own between the
harness and the workflows? (#33)

## Keeping this current

- `blueprint/index.mmd` draws the four subsystems above; each box opens its detail diagram. Update a
  diagram in the same change as the code it draws.
- Update this page when a decision lands or changes, and move a gap out of it once it's closed.
