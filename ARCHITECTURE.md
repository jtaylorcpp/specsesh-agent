# Architecture

How specsesh is put together, what each part is for, and where each part is going. Snapshot: `main`
at `194539c` (0.4.6), 2026-11-06.

The live diagrams are in `blueprint/` (open them in Herdr's Blueprint panel; `blueprint/index.mmd` is
the root). They draw only what the code has. This page holds what a diagram can't: the model, the
decisions, and the gaps between the two.

## The model

specsesh is four subsystems, published as one library, and a fifth is planned.

| Subsystem | What it is for | Code |
|---|---|---|
| **CLI** | One way into the library: the `specsesh` command. | `src/cli`, `src/bin`, `packages/specsesh` |
| **Agent harness** | The agent primitive: a durable run that takes a model. | `src/durable`, `src/node`, `src/mcp`, `src/cloudflare`, `src/pi`, `src/claude-code` |
| **Agent Script** | How one agent is oriented and tuned, and what drives its run. | `src/authoring`, `src/interpreter`, the bundled `.agent` scripts |
| **OpenSpec workflow** | An opinionated use of the other three: iterate an OpenSpec change to done. | `src/task`, `src/openspec` |
| **Herdr host** (planned, #61) | Agent Script agents as native Herdr agents: a session started from the desktop app, and a panel that tunes its script. | `specsesh session`, `src/herdr` → `./herdr`, not yet written |

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

## Herdr host (planned)

Agent Script agents should run natively in Herdr: a person starts a session from the desktop app's
menu, gives it work in its terminal and sees its status in the sidebar, as with any other agent. A
panel beside it tunes the session's script while it runs.
The OpenSpec workflow is not needed for this; its Herdr pieces come later and are optional. Nothing
here is written yet; #61 tracks it. `blueprint/herdr.mmd` draws each planned piece, tied to the
code it will hook into.

### Herdr, as the host sees it

The desktop app (`herdr-app`) shows spaces, tabs and panes. herdr-core 0.1.18 (`hc`) runs every
terminal and keeps it alive when the window closes.

- **An agent is a terminal whose program reports its status** with OSC 7501. The probes behind #61
  confirmed the format:

  ```text
  ESC ] 7501 ; state=working:app=specsesh:title=<base64>:msg=<base64>:progress=25 BEL
  ```

  - `state` is `idle`, `working`, `done`, `blocked` or `error`.
  - `kind` (`permission`, `question` or `auth`) goes with `blocked`.
  - `app` and `progress` (0–100) are plain values. `title` and `msg` are base64: plain text there
    makes hc drop the whole report.
  - The app shows `done` until the person looks, then `idle`. A tab's and a space's status is the
    most urgent of their agents': blocked > done > working > idle.
- **The app's agent menu** lists each `programs.json` entry that has a `run` (`knownAgents()`), and
  shows whether it is installed. An agent's `app` name picks its name, icon and tile from the same
  table. The person adds the entry to `~/.config/herdr-app/programs.json`.
- **A tab can start an agent with a first message:** `herdr-app do tab.new --argv '[…]' --task "…"`.
- **Input.** What the person types, or what `hc send` pastes, arrives on the terminal. `hc
  interrupt` presses the stop key; `hc send` refuses a `blocked` terminal without `--force`.
- **Agents stay up for another turn.** Agents start other agents with `hc run`, often from a
  template (`~/.config/herdr-core/templates/<name>.md`, with frontmatter `name`, `description` and
  `command`).

### What it takes

Needed to start a session from the desktop app:

1. **The session: `specsesh session [--script <name|path>] [--session <name>] [--provider --model --db]`.**
   - It is an interactive program, so it also works outside Herdr.
   - Each message typed into it becomes one durable run of the script in the terminal's folder.
   - It takes any script that keeps the delegate contract (`instructions` in, `ok` and `summary`
     out). The default is the bundled `edit`, which reads, edits and runs commands; `read` is the
     read-only choice.
   - It remembers its turns. A run's `instructions` are the earlier turns, each message with its
     run's `summary`, then the new message. Past a size budget, the oldest turns drop first.
   - Ctrl-C stops the current run (it stays resumable) and returns to the prompt; it does not end
     the session.
   - It re-reads its script before each run, so an edit applies at the next turn. A script that
     fails `specsesh agent check` is refused for that run, and the refusal names the problems.
   - A line that starts with `/` is a command:
     - `/rerun` runs the last message again on the current script;
     - `/script <name|path>` switches the script;
     - `/model <ref>` switches the model.
   - It labels its terminal `specsesh.session=<name>`. In its folder it keeps `session.json` and a
     copy of every script version it ran, `scripts/<hash>.agent`. `session.json` holds the script's
     path, the turns (each with its status, `summary` and the version it ran on) and the current
     run's step. The panel reads both.
   - Its runs and turns are stored under its name in the Herdr app's home (see Decisions). The name
     is the hc terminal's, unless `--session` gives one. A session started under a name that
     already exists continues that session, finishing any unfinished run first.
2. **Its status, reported to Herdr.** Under hc, the session writes OSC 7501 to its terminal:
   - `idle`, once it is ready for input;
   - `working` during a run, with the run's first message as `title` and the current step or
     action as `msg`, both from `watchScript`;
   - `done` when the run completes, after it prints `summary`;
   - `error` when the run fails;
   - always with `app=specsesh`.

   This is `watchScript`'s first consumer (#30). The Claude Code provider streams no text (#31), so
   on it the terminal shows each step's text when the step ends.
3. **A menu entry.** `specsesh herdr program [--script --provider --model]` prints the
   `programs.json` entry: name, icon and tile, `match: ["specsesh"]`, and `run:
   ["specsesh", "session", …]`. The person adds it. `specsesh` must be on `PATH` as a program, not
   an alias: installed with `npm i -g specsesh`, or linked from this repo for development.

Wanted:

4. **A tuning panel**: a Herdr mod named `specsesh` that sits beside the session's terminal.
   - **Which session.** It follows the focused specsesh session (an agent whose `app` is
     `specsesh`) and finds that session's folder from the terminal's `specsesh.session` label.
   - **Editing.** It shows the session's script in an editor, checks each edit with `specsesh agent
     check --json`, and shows each problem at its line.
   - **Save.** Saving uses `writeTextFile`'s compare-and-swap, so it never overwrites a change made
     elsewhere, and it is allowed only when the check passes.
     - A user's script is saved in place.
     - A bundled script (`edit`, `read`) is saved as a copy in the session's folder, and the session
       runs that copy from then on. **Save as…** writes it into the repo.
   - **When an edit applies.** At the next turn. **Rerun** stops the current run (`hc interrupt`)
     and sends `/rerun`, so the same message runs again on the saved script.
   - **Turns.** It lists the turns, each with its status, `summary` and the script version it ran
     on, and can restore an earlier version into the editor. It switches the model with `/model`.
   - **Install.** It ships in `@specsesh/agent`. `specsesh herdr mod` prints its folder, and the
     person copies it into `~/.config/herdr-app/mods/specsesh`. `herdr-app check` must pass on it.

Recommended:

5. **Templates**, so agents can start sessions as sub-agents. `specsesh herdr template <script>`
   prints one; for example, `hc run --bg --name fix specsesh-edit "Fix the failing test in x.rs"`.

Later, and optional:

6. **OpenSpec status.** The same reporter as an `EventSink` for loop events, so that `specsesh
   task` and `change` show `working`, `done`, `blocked` or `error`.
7. **Answers in the terminal.** With an opt-in flag, a blocked loop waits for the principal's
   decision in its terminal and answers through `answerEscalation` or `answerSpecLoop`.
8. **hc runner.** Runner `hc` takes `agent`'s grant keys and runs the delegate as a session in a
   child terminal. The caller waits with `hc wait` and reads `{ ok, summary, files_changed }`. It is
   `replay: "unsafe"`, like a process delegate.

### Decisions

- **No dependency on pi-harness or the pi coding agent.** pi-harness (HenryQW/pi-harness) is pi
  coding-agent extensions. Its Herdr client, `@henryqw/pi-herdr`, drives the older `herdr` CLI
  (`herdr agent start --kind pi --pane`, `HERDR_SOCKET_PATH`), not `hc`. We borrow its rules:
  - a thin client, with Herdr the authority on commands and responses (its ADR 002);
  - never retry a request that may have been dispatched (`requestHerdr`);
  - one writer per checkout, readers in parallel (pi-subagent's checkout admission);
  - never write the user's configuration.
- **A generic session, with Herdr on top.** `specsesh session` is the front end. `src/herdr` →
  `./herdr` (Node only) holds what is Herdr's: the OSC 7501 reporter, the program entry, templates
  and the panel's files, and later the hc runner. It is the only code that speaks to hc or writes OSC 7501, a
  rule for `layers.test.ts`.
- **A tuned script applies at the next turn.** A run stays pinned to the script it started on
  (`RunState.sourceHash`), which keeps resume exact. Picking up an edit mid-run would mean relaxing
  that pin in the interpreter. Rerun gives the quick loop instead: stop, tune, run the same message
  again.
- **The panel talks to the session only through what a person can see:** it reads the session's
  folder and writes to its terminal (`/rerun`, `/model`, `hc interrupt`). There is no socket or
  private channel between them.
- **Status goes to the terminal, never into output.** It goes to `/dev/tty`, only when
  `HC_TERMINAL_ID` is set and a terminal exists, so piped output and the JSON Lines stream stay
  clean.
- **We print entries and templates; the person adds them.** Nothing writes `programs.json` or
  `~/.config/herdr-core`.
- **Sessions live in the Herdr app's home, for now.** Each session is a database at
  `<app home>/specsesh/sessions/<name>.sqlite`. The app home is `HERDR_APP_HOME`, or else
  `~/.config/herdr-app`. The `specsesh/` folder is ours: Herdr doesn't read it, and we write nothing
  Herdr owns (`data/`, `settings.json`, `mods/`, `programs.json`). `--db` overrides the path.
- **Headless stays the default for loops.** Waiting for an answer in the terminal is opt-in, so a
  loop started by a script or another agent still ends rather than waiting forever.
- **The hc runner starts only our own session.** It never starts `claude`, `codex` or `pi` with
  their own tools. Claude Code stays model access only.

### Open questions

Neither blocks a session or its panel in the desktop app.

- **Who is the principal when a decision is typed into a terminal?** `hc send --force` can reach a
  blocked terminal, so hc alone doesn't show that a person typed the decision. This blocks piece 7.
  - One safe default: a terminal answer may answer a question or ask for a revision, but may not
    approve a review.
  - Approval would stay with `specsesh task answer --by principal --principal <name>`.
- **Does the `hc` runner join the CLI's runners when the run is under hc?** This blocks piece 8.
  - One safe default: library hosts pass `hcRunner()` themselves.
  - The CLI would keep `agent` as its only runner until a use shows otherwise.

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
8. **Herdr host:** Agent Script sessions in the Herdr desktop app, with a tuning panel (#61).

Open question: where does the generic loop live, in the harness or in a layer of its own between the
harness and the workflows? (#33)

## Keeping this current

- `blueprint/index.mmd` draws the subsystems above, plus the library; each box opens its detail
  diagram. A planned box is marked `active` and tied to the code it will hook into until its own
  code lands. Update a diagram in the same change as the code it draws.
- Update this page when a decision lands or changes, and move a gap out of it once it's closed.
