# Parked

Bugs, ideas and gaps found along the way that nobody is working on yet. When work starts on one,
open a GitHub issue for it (or fold it into one) and delete it here. Planning lives in
`ARCHITECTURE.md`, `blueprint/` and the issues; this file is only the backlog of loose ends.

The sections below came from `openspec/parked.md` and `gaps.md` when the repo stopped using
OpenSpec for its own planning (2026-11-06). Change ids such as `add-task-agent` name archived
OpenSpec changes, which are in git history before that date.

## Self-hosting (paused 2026-11-06)

This repo no longer runs its own task loop. Removed until it is set up again without OpenSpec
changes of our own: `agentscript.config.json`, the root `pnpm task` and `pnpm change` scripts, and
the live task-loop run in `pnpm test:live` (`packages/agent/__tests__/live/task.live.test.ts`, which
wrote its fixtures under `__tests__/live-fixture/` in a copy of the repo). All are in git history.


## Possible bugs

- **cloudflare: faux responses leak across runs.** A start body's `faux` is queued before `startScript`; if the script is refused (422) they stay queued and answer the next run.
- **cloudflare: malformed JSON body → unhandled 500**, not a 4xx (confirmed: uncaught `SyntaxError`, no JSON body).
- **cloudflare: a missing `AI` binding** outside faux mode is cast, not checked, so it fails late.
- **cli: some usage errors exit 1, not 2.** A bad `--var`, a missing file and an unknown flag throw instead of printing usage.
- **cli: an unknown model still creates the SQLite file.** `Harness.open` runs before the model check (no task is created). The test name "before creating anything" overstates it.
- **core: undeclared variables never reach `UndeclaredVariableError`** through `start`; the dialect's lint reports them as errors first, so callers get `UnparsedDocumentError`.
- **core: `UnreadableDocumentError` looks unreachable.** Every malformed input tried (empty, whitespace, comments, `}{`, NUL) yields a root or an error diagnostic first, so `UnparsedDocumentError` always wins. Candidate for removal; its scenario has no test.
- **core: `integer` variables always warn.** The only default an `integer` can have (`= 0`) draws the dialect warning `declared as 'integer' but default value is 'number'`. A warning, so it runs.
- **core: mixed-type `<`/`>` comparisons coerce** the JavaScript way (`"10" < 9` is false).
- **core: answered / cut-short outcomes are not validated** (`text`, `turns` pass through as given).

- **pi cli: `--max-tokens abc` passes `NaN`** as `maxTokens` to pi; no validation.
- **pi cli: `models <unknown provider>` prints nothing and exits 0**, where `run` fails such a provider by name.
- **pi cli: `main` is not exported**, so the CLI can only be tested by spawning the bin (the durable CLI takes injected deps).

## Not verified

- A Lifecycle alarm waking an idle Durable Object with no incoming request. The crash test's restarted object is woken by a GET.
- Which model a step uses when `RunInput.model` is absent (`host.ts` says "copies of that conversation's agent"; dispatch creates a fresh conversation).

## Stale comments and wording

- Singular `@output` in `compose.ts` (header, `PendingAssignment.field`) and `scan.ts`; the namespace is `@outputs`.
- `run.ts`: `RunStateError` doc says `next` throws on an awaiting state (it re-returns the request); `hashSource` doc says "8 hex digits" (it is `<length hex>-<8 hex>`).
- `port.ts`: "four … the other five" for ten categories; specsketch and "private workspace package" history in `port.ts` and `port-shape.test.ts`.
- `authoring/index.ts` lists the base `agentscript-dialect`; the code parses with `agentforce-dialect`. `document.ts` says `topic`; the vocabulary is `subagent`.
- `packages/agent/src/cloudflare/index.ts` header: GET also returns `task`/`phase`/`step`; POST returns 202.
- Test `describe` names mix the inherited `platform-agentscript-interpreter:` prefix with the new `core-<capability>:` one.
- Persistence is specced in both `core/composition` and `core/step-machine`; fold into one when either changes.

## Actions (from add-agentscript-actions)

- Offered tool names collide across concurrent runs in one harness. pi-durable resolves a conversation's tools by name, and `agentScriptExtensions` keeps one live tool per offer name (last registered wins). Two runs offering the same name (`note`, say) with different descriptions or input schemas share whichever definition was registered last, so one run's model can see the other's description and have its arguments validated against the other's schema. Execution is still correct: each call reads its own offer (bound inputs, action) from its step conversation's `agentscript.step-actions` doc. Since `bound-step-results`, `submit_result`'s parameters are live the same way, so concurrent structured steps can show a provider another step's schema; the tool still checks against its own step doc's `schema`. A crash during a model-callable tool call is also not yet tested (the act phase's crashes are).
- **The durable CLI doesn't register the workspace built-ins** (`read_file`, `edit_file`, `run_command`). Since `add-cli-tools`, `--tools` and `--workspace` install `agentScriptExtensions({ actions, workspace })` with a module's tools, and a module can register the built-ins itself with `builtinActions({ workspace })`. A flag for them (plus `--allow` / `--check`) would need no module; the task CLI installs its own registry.

## MCP tools (from add-mcp-tools)

- **Optional MCP tool parameters.** Only a tool's required scalar parameters map to inputs, so its optional parameters can't be reached, and a tool whose useful behaviour needs one can't be driven fully. A later change could add per-tool input selection in the `.mcp.json` entry. Source: the change's design, Risks.

## Pi tool loop (from add-pi-tool-loop)

- **An offer named `submit_result` shadows the result tool.** On a structured step, a pi port given a tool host offers `submit_result` beside the step's tool offers. The scan doesn't forbid a reasoning action named `submit_result`, so the two would collide. The scan or `composeToolOffers` could reject the name. Source: the change's design, Risks.

## Run streaming (from add-run-streaming)

- **claude-code pi provider text streaming (held sessions, durable runs).** The claude-code port now streams text and thinking deltas (add-claude-code-text-streaming), but the pi provider still runs `--output-format json`, because pi-durable checkpoints whole messages. Streaming it would need stream-json in the provider and its held sessions. Source: add-claude-code-text-streaming's proposal, Out of scope.

## Claude Code tools (from add-claude-code-tools)

- **Back to `--safe-mode` on tool steps.** `--safe-mode` turns off every MCP server, `--mcp-config` included (Claude Code 2.1.310), so a tool step passes `--setting-sources "" --disable-slash-commands --strict-mcp-config` instead. That replacement is an observed equivalence (the same 642-token context), not a documented one. If a later Claude Code keeps `--mcp-config` servers under `--safe-mode`, tool steps should go back to it. Watch Claude Code's release notes, and run `pnpm test:claude-code` on each new version: it re-checks the isolation against `--safe-mode` (input tokens, and a project CLAUDE.md sentinel), a real bridged tool call and a durable run. Source: the change's design, Risks.

## Durable claude-code tools (from add-durable-claude-code-tools)

- **Temp directories survive a killed process.** A `SIGKILL`ed bin leaves its bridge's `/tmp/agentscript-bridge-*` (mode `0700`, a dead token) and `spawnRunner`'s `agentscript-claude-*` step directories, which also predates the change. A sweep at startup could remove the ones whose owning pid is gone, if the pid went into the directory name. Source: the change's design, Verified live.

## Failure status (from fix-pi-failure-status)

- **Failure categories in durable runs.** pi-durable's `generation.js` calls `runtime.models.streamSimple` with its own options, and `answerStep` sees `settled.reason`, not the assistant message. Threading the status through would mean wrapping the harness's `Models` and reading the conversation back. Until then durable, task and change runs report every failure as `unknown`. Source: the change's design, decision 6.
- **pi-ai: keep the HTTP status in diagnostics.** An upstream request. `normalizeProviderError` extracts `error.status`, but `formatProviderError` only folds it into `errorMessage` as text and appends no diagnostic. Once pi-ai keeps it, the diagnostic code wins and the port's recorded status becomes a fallback. Source: the change's proposal, Out of scope.

## Durable streaming (from add-durable-streaming)

- **A streaming route on `defineAgentHost`.** An SSE (or similar) route that streams a run's `RunEvent`s, built on `watchScript`. Deferred from add-durable-streaming, which is library-only. Source: the change's proposal, Out of scope.
- **Watching from a process that doesn't run the harness.** pi-durable's events are in-process, so `watchScript` can't follow a run another process owns. Doing so is a storage-level question. Source: the change's proposal, Out of scope.

## Task loop (from add-task-agent)

- **A crash between ticking and the judge's commit reports `ticked: false`.** The judge phase writes tasks.md, then commits the outcome. If the process dies in between, the re-run judge finds the line already ticked and reports `ticked: false` with "already ticked", though this loop ticked it. Recording the tick's intent in the checkpoint first would close it.
- **One harness, one action configuration.** `agentScriptExtensions` binds one registry and workspace per harness, so loops with different workspaces, checks or allowlists need separate harnesses. The CLI's `resume`/`answer` install the stored configuration after opening the harness; a library host must do the same.
- **Delegates offered as step tools get no task preamble** (from loop-supplies-delegate-contract). Only `run` calls receive `RunInput.delegatePreamble`. A process delegate offered under `reasoning.actions` runs as a pi-durable tool registered once per harness and reads its offer from the step's `agentscript.step-actions` doc, so carrying the preamble means adding it to that doc and its dispatch in `src/durable/extension.ts`. The bundled scripts call their delegates with `run`, and agent delegates are run-only.

## Headless runner (from add-headless-task-runner)

- **`task/worktree.test.ts` "Two tasks run at once" can race** (seen in add-cli-tools group 4). `git worktree list` failed because `.git/worktrees/tiny-1.2/locked` vanished while two worktrees were being added at once. A rerun passed. Serialising `git worktree add` per repository, or retrying `worktree list` on that error, would close it.
- **`group-ended.changed` after a group `resume` is measured from the resume.** A group has no baseline of its own; its task loops' `loop-ended.changed` are measured from each task loop's start (`judge-sees-loop-changes`).
- **`--json` carries neither `changed` nor the worktree's review lines.** Both are on the event stream (`loop-ended`) and in the text outcome; the JSON outcome stays `{ loop, ...outcome }`.
- **`worktreeSetup` commands have no timeout**, and their output is shown only when one fails.
- **`pnpm task` runs from the repository root** (pnpm's working directory), so a relative `--db` is relative to the root wherever you type it.
- **`pnpm test:live` asks `claude auth status` whether you are logged in.** Not yet checked against the installed `claude` (its flags were not exercised here); `AGENTSCRIPT_LIVE_FORCE=1` bypasses the question.

## Spec agent (from the add-spec-* changes)

- **A live run through all four stages.** `add-spec-cli-events` proves a real model drafts a clean proposal; designs, deltas and task lists are larger strings through `--json-schema`, and nothing live covers them yet.
- **Type-checking design examples.** The design gate checks that `design/examples/` holds a file, not that it compiles. A per-repo `designChecks` config (commands with a `{change}` placeholder) would close it.
- **`spec` could check for `openspec` on `PATH` up front.** Without it the specs and tasks gates report one `ERROR` per draft until the loop exhausts.
- **Task order is not checked.** The plan script is told to order tasks so each leaves the code working; no gate rule can see that.
- **"No command prints usage" is tested twice** (`__tests__/task/status.test.ts` and `resolve.test.ts`). `add-spec-cli` 2.1 names one; the other must follow.
- **The spec-stage scripts show carried feedback only from iteration 2** (from show-carried-on-first-iteration). `spec-proposal`, `spec-design`, `spec-specify` and `spec-plan.agent` gate `carried` on `iteration > 1`, beside the current files. Investigate whether any re-draft (an answered question, a revision) can start a run at iteration 1 with feedback that is then dropped, as the task scripts did.

## Draft and build (from add-draft-loop, add-build-loop and the add-change-* changes)

- **`pnpm change build --worktree`.** One worktree for a whole change, on `task/<change-id>`. `build` refuses the flag for now.
- **`pnpm change` with no change** could list every change and its state (drafting, waiting for review, built, …).
- **`changeChecks` in `agentscript.config.json`.** Only `--change-check` sets it; the config has `checks` alone.
- **JSON Lines events for draft and change loops.** Their child spec, group and task loops are not watched either, so nothing streams progress while `pnpm change draft` or `build` runs.
- **A change judge.** A failing change check ends the build `failed`. The ontology's change loop may rework a group or add a task for an unclaimed scenario; nothing does yet.
- **The plan stage still writes `pnpm spec:archive <change>` as a task.** A build runs it like any task, before its change check. The plan stage's rules should forbid archive tasks, since `pnpm change close` does the fold.
- **A crash between `answerSpecLoop` (or `answerGroupEscalation`) and the parent's commit** leaves a child run no parent awaits; the answer has to be given again.

## Gaps from running our own tools

Things we had to do by hand, or with a throwaway script, while executing the changes in `openspec/changes/` with our own tools (`pnpm task`, `pnpm spec:archive`). Each is a candidate for a tool. Newest last.

**Scope.** This repo is the agent, the harness and the tools for the OpenSpec process. It is not a scheduler or a queue: running changes back to back, restarting work on its own after a reboot, and pushing belong to the repo that integrates it. Gaps of that kind are marked **Integrating repo**. When a later change closes a gap, it says so in **Closed by**.

| # | What we had to do | How we did it | Closed by |
|---|---|---|---|
| 1 | Run a change's task groups one after another, stopping at the first that doesn't converge | A shell loop over `pnpm task <change> <group>` (`.agentscript/drive/drive-change.sh`) | **Closed:** `pnpm change build` (archived 2026-10-13) runs every group in order, each with its own task loops and judge |
| 2 | Commit each converged group, so the next group starts on a clean tree (`requireCleanTree`) | `git add -A && git commit` in the same shell loop | — nothing planned; every tool leaves committing to the principal |
| 3 | Rebuild `dist/` before each group. `pnpm task` runs the built bin, so a change to the runner's own source only takes effect after `pnpm build` | `pnpm build` in the shell loop before each group | — |
| 4 | Watch a running group: which task, which iteration, what the agent did | `tail` and `grep` on the stderr JSON Lines | — (`pnpm task status` lists loops only after the fact) |
| 5 | The verify group's tasks ("run `pnpm test:live`", "the orchestrator runs it", `pnpm spec:archive`) are orchestrator steps, not agent tasks | Run by hand at the end of each change | **Partly closed:** `pnpm change close` does the guarded, trial-folded archive (it archived its own change). Nothing runs the live acceptance run |
| 6 | Keep the driver running when the agent session ends or the machine reboots. Twice the loop was cut off mid-task (session ended; then a reboot wiped `/tmp`). The loops themselves were safe in SQLite and `pnpm task resume` picked them up | Driver moved to `.agentscript/drive/`, started with `setsid nohup`; resumed by hand with `pnpm task resume <loop>` | **Closed:** `add-resume-interrupted` (archived 2026-10-13): `pnpm task status` marks `interrupted` loops and `pnpm task resume --all` resumes them. Restarting them on its own: **Integrating repo** |
| 7 | Delete files a task retires. The agent's actions can read, write and run allowlisted commands, but nothing deletes a file, and the grant's allowlist is `pnpm`/`node`. Task 3.6 of `add-actors-and-workspaces` blocked after three refused attempts | The orchestrator ran `git rm` and answered the loop | **Closed:** `add-delete-file-action` adds the confined action and `add-delete-file-grant` grants it to `pnpm task` (`task.deleteFiles`; under `task-delegate` the outer step deletes what Claude Code lists as `RETIRE:`). Both archived 2026-10-13 |
| 8 | Fix a spec defect an agent finds mid-build (wrong requirement names in a REMOVED block's Migration lines). The loops can escalate `amend-spec`, but nothing applies the amendment | The orchestrator edited the delta and answered the loop. It happened four times: `add-actors-and-workspaces` 3.6, `add-spec-cli` 1.4 (a `task/headless` git rule), `add-spec-plan-stage` 1.4 (a design line the loop couldn't honour), `add-change-draft` 1.5 (the three-bins requirement left to a later change). Every one was a defect in a hand-written spec that an agent caught | **Closed:** `add-spec-amendments` (task agent), `add-spec-amendments-judge` (group judge) and `add-spec-amendments-cli` (`pnpm change build <id>` shows the amendment as a diff; `--amend` writes it, validates like `close`, and resumes, or restores the file). All archived 2026-10-13. Building them took four more hand amendments: `add-resume-interrupted` 3.2, `add-delete-file-grant` 3.2, and two scenario fixes in the amendments changes |
| 9 | Answer a loop across a change to the host itself. A group loop stores its scripts when it starts. Group 3 of `add-actors-and-workspaces` retired `delegate_claude_code`, so the answered run's stored script named an action the new config no longer grants, and failed at start The same holds for task briefs: a group loop stores its tasks when it starts, so a mid-build redraft and re-approval does not reach the running group. `add-stale-approval-guard` 1.4 and 1.6 each asked three times against a brief whose scenarios no longer existed | Committed the group's work so far, rebuilt, and started the group again (ticked tasks are skipped) | — |
| 10 | Find out why a loop failed. `pnpm task` printed `failed (runs 2)` and nothing else; the reason was only in the stored task record | Read `tasks.record` from `.agentscript/task-loops.sqlite` (`.agentscript/drive/peek.cjs`) | — |
| 11 | Run a queue of changes in order: each change's groups, its verify group, the archive, a commit and a push, then the next change | `.agentscript/drive/run-queue.sh` over `drive-change.sh` and `verify.sh` | **Integrating repo.** `pnpm change build` + `close` cover one change |
| 12 | Know how long things take. Every loop stores `startedAt` and `endedAt`, but nothing reports them per change, group or task, or counts iterations | `.agentscript/drive/stats.cjs` reads `.agentscript/task-loops.sqlite` | — |
| 13 | Restart a queue after answering an escalation, passing the answer to the blocked group only | `ANSWER=<loop> DECISION=… run-queue.sh …`, which unsets the answer after the first change | **Integrating repo.** `pnpm change build <id> "<answer>"` covers one change |
| 14 | Pass flags to `pnpm change`. pnpm 10.13.1 rejects any option after `pnpm change …` (`[ERROR] Unknown option: 'intent'`) before the script runs, while `pnpm task …` passes them through. So `pnpm change draft <id> --intent "…"`, as the README and guide 09 show it, fails; so would `build --allow-dirty` and `--db` | `pnpm run change draft <id> --intent-file …` | — the docs show a form that doesn't run; rename the script or document `pnpm run change` |
| 15 | The tasks stage's first drafts write nothing, or write `tasks.md` under its repository path (`openspec/changes/<id>/tasks.md`) instead of the change-relative `tasks.md`. Both refused by the gate and redrafted, costing 1–3 drafts each on add-resume-interrupted and add-spec-amendments | The gate's `ERROR … not owned by the tasks stage` fed the next draft, which got it right | — tell the plan stage's script the path form it owns, or accept the repository-relative form |
| 16 | Notice that an approved spec changed before the build. Editing a delta after its stage was approved should make the approval stale; `pnpm change build` builds anyway, so a hand amendment goes in unreviewed. Hit while answering `add-delete-file-grant` 3.2 | Nothing caught it; the edit was validated by hand with `openspec validate --strict` | **Closed:** `add-stale-approval-guard` (archived 2026-10-13): `build` refuses, exit 2, when an approved file no longer matches `approvals.json`, naming file and stage; `tasks.md` is hashed with ticks read as unticked; `--amend` records the amended delta's approval |
| 17 | Catch an over-long MODIFIED requirement before close. `openspec validate --strict` (1.14.1), on one change or `--all`, length-checks ADDED requirements in a delta but not MODIFIED ones; only the folded spec reports them. `add-spec-amendments-judge` passed verify and failed `close`'s trial fold on three. (An earlier note here blamed the single-change form; that came from running the global openspec 1.9.0 by hand, see #19) | Trimmed the requirements by hand and re-ran `close` | **Closed:** `add-trial-fold-check` (archived 2026-10-14): the specs gate and `pnpm change build` run `close`'s trial fold (`openspec validate --specs --strict --json`), so a folded problem is a draft issue or a blocked build, not a failed close |
| 18 | Re-run a ship after verify fails. Re-running with the answer that unblocked the build is refused (`nothing … waits for an answer`), so the driver must drop it | Edited the driver's continue script | — |
| 19 | Run the bins with the repo's openspec. `pnpm run change …` puts `node_modules/.bin` (openspec 1.14.1) first; calling `node packages/agent/dist/bin/agentscript-change.js` directly picks up the global openspec (1.9.0 here), whose `show --json` omits requirement names, so the specs gate fails every draft with "`openspec show` failed" and burned a full draft budget on `add-spec-amendments-cli` | Re-ran through `pnpm run change` | **Closed:** `add-pinned-openspec` (archived 2026-10-14): openspec is resolved from the project's `node_modules/.bin` before PATH; `draft`, `approve`, `close` and `build --amend` refuse below 1.14.1, naming version and path; gate issues name the openspec they ran |
| 20 | Abandon a stuck change loop. `build` always continues the newest change loop, and nothing can end one, so a group holding stale briefs (#9) can only be escaped with a fresh `--db`. Done four times in the gaps 16/17/19 batch. A fresh database also drops earlier answers, so a question already answered returns, and the redraft that preceded it unticks finished tasks, so they run again | `SHIP_DB=<new db> ship-change.sh <change>` | **Closed:** #52, `build --restart`: ends the newest change loop (aborting one a process died in, with its group and task loops) and starts a new one from the current files, on the same database |
