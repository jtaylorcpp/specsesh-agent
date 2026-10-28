# Parked

Found while writing the baseline specs. Each needs its own change; none is in `baseline-agentscript-durable`, which specs behaviour as it is.

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
- **claude-code provider registers only four ids** (`claude-haiku-4-5`, `haiku`, `sonnet`, `opus`). `claudeCodeModel(id)` builds any other but does not register it, so `agentscript-durable --provider claude-code --model claude-sonnet-4-5` is refused as an unknown model, while `agentscript-pi` accepts any id.
- **claude-code: a timeout is reported as `claude exited by signal without a JSON result`**, never naming the timeout.
- **claude-code: `spawnRunner` never removes its abort listener** from a long-lived signal.

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

- **claude-code deltas through `--output-format stream-json`.** The claude-code port uses `reason`'s stream argument only for a tool step's `tool_call` and `tool_result` (from add-claude-code-tools), so a streamed run on it gets no text or thinking deltas. Reading `claude -p --output-format stream-json` would let it map text and thinking deltas to `onDelta`. Deferred from add-run-streaming, whose scope was the pi port. Source: the change's proposal, Out of scope.

## Claude Code tools (from add-claude-code-tools)

- **Back to `--safe-mode` on tool steps.** `--safe-mode` turns off every MCP server, `--mcp-config` included (Claude Code 2.1.310), so a tool step passes `--setting-sources "" --disable-slash-commands --strict-mcp-config` instead. That replacement is an observed equivalence (the same 642-token context), not a documented one. If a later Claude Code keeps `--mcp-config` servers under `--safe-mode`, tool steps should go back to it. Watch Claude Code's release notes, and run `pnpm test:claude-code` on each new version: it re-checks the isolation against `--safe-mode` (input tokens, and a project CLAUDE.md sentinel), a real bridged tool call and a durable run. Source: the change's design, Risks.

## Durable claude-code tools (from add-durable-claude-code-tools)

- **Temp directories survive a killed process.** A `SIGKILL`ed bin leaves its bridge's `/tmp/agentscript-bridge-*` (mode `0700`, a dead token) and `spawnRunner`'s `agentscript-claude-*` step directories, which also predates the change. A sweep at startup could remove the ones whose owning pid is gone, if the pid went into the directory name. Source: the change's design, Verified live.
- **A held `claude -p` outlives a killed host** until its bridge calls fail or `timeoutMs` passes. Spawning it in its own process group, and killing the group on exit, would tighten that. Source: the same.

## Durable streaming (from add-durable-streaming)

- **A streaming route on `defineAgentHost`.** An SSE (or similar) route that streams a run's `RunEvent`s, built on `watchScript`. Deferred from add-durable-streaming, which is library-only. Source: the change's proposal, Out of scope.
- **Watching from a process that doesn't run the harness.** pi-durable's events are in-process, so `watchScript` can't follow a run another process owns. Doing so is a storage-level question. Source: the change's proposal, Out of scope.

## Task loop (from add-task-agent)

- **A crash between ticking and the judge's commit reports `ticked: false`.** The judge phase writes tasks.md, then commits the outcome. If the process dies in between, the re-run judge finds the line already ticked and reports `ticked: false` with "already ticked", though this loop ticked it. Recording the tick's intent in the checkpoint first would close it.
- **One harness, one action configuration.** `agentScriptExtensions` binds one registry and workspace per harness, so loops with different workspaces, checks or allowlists need separate harnesses. The CLI's `resume`/`answer` install the stored configuration after opening the harness; a library host must do the same.
- **Delegates offered as step tools get no task preamble** (from loop-supplies-delegate-contract). Only `run` calls receive `RunInput.delegatePreamble`. A process delegate offered under `reasoning.actions` runs as a pi-durable tool registered once per harness and reads its offer from the step's `agentscript.step-actions` doc, so carrying the preamble means adding it to that doc and its dispatch in `src/durable/extension.ts`. The bundled scripts call their delegates with `run`, and agent delegates are run-only.
- **`task-delegate.agent`'s `orient` could stop restating the requirements** (from loop-supplies-delegate-contract). The delegate now sees the proposal, design and deltas in full, so the plan could focus on approach. The `RETIRE:` paragraph still belongs in the plan.

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
