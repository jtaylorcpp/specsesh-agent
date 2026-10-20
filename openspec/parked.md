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
- `agentscript-durable` installs the plain extensions, so a script with actions is refused there. Propose `--workspace <dir>` (plus `--allow` / `--check`) to install `agentScriptExtensions({ actions: builtinActions(...), workspace })`; the task CLI will install its own registry.

## Task loop (from add-task-agent)

- **A crash between ticking and the judge's commit reports `ticked: false`.** The judge phase writes tasks.md, then commits the outcome. If the process dies in between, the re-run judge finds the line already ticked and reports `ticked: false` with "already ticked", though this loop ticked it. Recording the tick's intent in the checkpoint first would close it.
- **One harness, one action configuration.** `agentScriptExtensions` binds one registry and workspace per harness, so loops with different workspaces, checks or allowlists need separate harnesses. The CLI's `resume`/`answer` install the stored configuration after opening the harness; a library host must do the same.
- **Delegates offered as step tools get no task preamble** (from loop-supplies-delegate-contract). Only `run` calls receive `RunInput.delegatePreamble`. A process delegate offered under `reasoning.actions` runs as a pi-durable tool registered once per harness and reads its offer from the step's `agentscript.step-actions` doc, so carrying the preamble means adding it to that doc and its dispatch in `src/durable/extension.ts`. The bundled scripts call their delegates with `run`, and agent delegates are run-only.
- **`task-delegate.agent`'s `orient` could stop restating the requirements** (from loop-supplies-delegate-contract). The delegate now sees the proposal, design and deltas in full, so the plan could focus on approach. The `RETIRE:` paragraph still belongs in the plan.

## Headless runner (from add-headless-task-runner)

- **`changed` after `resume` is measured from the resume, not the loop's start.** The porcelain snapshot is taken when the process starts waiting, so edits made before a crash are not listed by the resumed run.
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
