# Parked

Found while writing the baseline specs. Each needs its own change; none is in `baseline-agentscript-durable`, which specs behaviour as it is.

## Possible bugs

- **cloudflare: faux responses leak across runs.** A start body's `faux` is queued before `startScript`; if the script is refused (422) they stay queued and answer the next run.
- **cloudflare: malformed JSON body → unhandled 500**, not a 4xx (confirmed: uncaught `SyntaxError`, no JSON body).
- **cloudflare: a missing `AI` binding** outside faux mode is cast, not checked, so it fails late.
- **cli: some usage errors exit 1, not 2.** A bad `--var`, a missing file and an unknown flag throw instead of printing usage.
- **cli: an unknown model still creates the SQLite file.** `Harness.open` runs before the model check (no task is created). The test name "before creating anything" overstates it.
- **durable: no bound on `submit_result` retries** within a step, beyond whatever pi-durable has.
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

- Offered tool names collide across concurrent runs in one harness. pi-durable resolves a conversation's tools by name, and `agentScriptExtensions` keeps one live tool per offer name (last registered wins). Two runs offering the same name (`note`, say) with different descriptions or input schemas share whichever definition was registered last, so one run's model can see the other's description and have its arguments validated against the other's schema. Execution is still correct: each call reads its own offer (bound inputs, action) from its step conversation's `agentscript.step-actions` doc. A crash during a model-callable tool call is also not yet tested (the act phase's crashes are).
- `agentscript-durable` installs the plain extensions, so a script with actions is refused there. Propose `--workspace <dir>` (plus `--allow` / `--check`) to install `agentScriptExtensions({ actions: builtinActions(...), workspace })`; the task CLI will install its own registry.
