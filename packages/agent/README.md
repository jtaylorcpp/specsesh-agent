# @specsesh/agent

Agent Script as an **authoring format**, plus an **interpreter** over a declared
subset of it, and the hosts that run it: any pi provider, your own Claude Code
subscription, crash-safe pi-durable tasks on Node, or a Cloudflare Durable Object.

```bash
npm install @specsesh/agent
```

## Entry points

There is no root import: pick the layer you need. Each layer's libraries are optional
peer dependencies, so a consumer of the interpreter alone installs none of them.

| Entry | What it holds | Peers it needs |
|---|---|---|
| `@specsesh/agent/authoring` | `parse`, `analyze`, `Document` (edit with undo/redo, lint) | none |
| `@specsesh/agent/interpreter` | `run`, the step machine (`start`/`next`/`apply`), `ReasoningPort`, the subset | none |
| `@specsesh/agent/pi` | A `ReasoningPort` on pi-ai, plus model helpers | `@earendil-works/pi-ai` |
| `@specsesh/agent/claude-code` | A `ReasoningPort` and a pi provider that run each step through your own `claude -p` (Node only) | `@earendil-works/pi-ai` |
| `@specsesh/agent/durable` | The pi-durable extensions and `startScript` / `waitForScript` / `runScript` | `@earendil-works/pi-ai`, `@earendil-works/pi-durable`, `@earendil-works/chord` |
| `@specsesh/agent/cloudflare` | `AgentScriptHost`, a Durable Object class for a Worker to re-export (workerd only) | the durable peers and `agents` |
| `@specsesh/agent/openspec` | The OpenSpec ontology: typed schemas for a change, its lifecycle steps, its execution loops and their evidence | none (uses the `typebox` dependency) |
| `@specsesh/agent/task` | The task loop: `startTaskLoop` / `waitForTaskLoop` / `answerEscalation`, `taskLoopExtensions`, and the bundled `task.agent` and `task-delegate.agent` (Node only) | the durable peers |

The authoring, interpreter and openspec entries run on Node and on Workers.

## `@specsesh/agent/openspec`

Types for executing an OpenSpec change, where every step has a typed input and output.
Each type is one [TypeBox](https://github.com/sinclairzx81/typebox) schema exported under the
type's name, with the static type `Static` of it, so a value can be checked wherever it crosses
a boundary (a model's tool call, a durable checkpoint): `check(Clause, value)`, or
`Value.Check(Clause, value)`. A TypeBox schema is a JSON Schema; `toJSONSchema(Clause)` returns
it as plain JSON. A few rules compare two fields of one value (a task id against its group, a
rename's `from` against its `to`); those are refinements on the schema itself, which
`Value.Check` and `check` run and the plain JSON Schema does not carry. The entry reads
no files and runs no loop.

- **Taxonomy:** `Root`, `Capability`, `CapabilityPath`, `Requirement`, `Scenario`, `Clause`,
  `Change`, `Proposal`, `Delta` (`Added`, `Modified`, `Removed`, `Renamed`), `Design`,
  `TaskList`, `TaskGroup`, `Task`, `TaskId`, `TaskLink`, `RequirementRef`, `ScenarioRef`,
  `LinkBasis`; `formatRef` / `parseRef`, `applyDelta`, `unclaimedScenarios`.
- **Steps:** `propose`, `specify`, `design`, `plan`, `validate`, `approve`, `execute` and
  `archive` (`STEPS`, `STEP_SCHEMAS`), each returning a `StepResult` rather than throwing
  (`invokeStep`); the change state machine, `ChangeState` and `transition(state, event)`.
- **Loops:** one shape (`LoopInput`, `Iteration`, `Verdict`, `Feedback`, `Escalation`,
  `LoopOutcome`) used three times: the **task loop** (`TaskOutcome`), the **group loop**
  (`GroupOutcome`) and the **change loop** (`ChangeOutcome`); `outcomeStatus`, `judge`,
  `feedbackFor` and the other rules a runner applies between iterations.
- **Evidence:** `TestEvidence`, `ValidationEvidence`, `CheckEvidence`, `DiffEvidence`,
  `ReviewEvidence`, `Finding`; `satisfies(target, evidence)`.

## Command-line tools

- `agentscript-pi run <file> [--provider <id>] [--model <id>] [--entry <subagent>]... [--var name=value]... [--json]`
  runs a script once, on any pi provider or with `--provider claude-code`; `agentscript-pi models [provider]`
  lists a provider's models. Needs `@earendil-works/pi-ai`.
- `agentscript-durable run <file> --db <path> [...]` runs a script as a durable task on a Node SQLite file;
  `agentscript-durable resume <task-id> --db <path>` finishes one whose process died. Needs the durable peers.
- `agentscript-task run <change> <task-id>|--next [--db <path>] [...]` works one task of an OpenSpec change as a
  durable task loop (plan, act, check, judge, again) until it converges, blocks, or spends its budget, and
  ticks the task in tasks.md when it converges; `agentscript-task resume <loop-id>` finishes one whose process
  died, `agentscript-task answer <loop-id> --by principal --decision <text>` answers a blocked loop's
  escalation, and `agentscript-task status` lists the loops in a database. Defaults come from the nearest
  `agentscript.config.json` (`task` object); `<change>` is an id under its `changesDir`, or a path. It runs
  headless (JSON Lines progress on stderr), refuses a dirty git tree unless `--allow-dirty`, never commits,
  and with `--worktree` runs the task in a new git worktree on `task/<change>/<task-id>`. Needs the durable peers.

Credentials are pi-ai's own environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...).

## What it does not do

**It never compiles.** Agent Script's compiler emits a Salesforce-internal
specification format that executes only on Salesforce infrastructure — the
runtime is not open source. Compiling from here would produce a build that can
never be run.

That is enforced structurally. The dependencies are
`@sf-agentscript/language` (analysis engine, lint passes, Language Service API)
and `@sf-agentscript/parser-javascript` (error-tolerant parser). The compiler
ships in `@sf-agentscript/agentforce`, which is deliberately **not** a
dependency of this package.

**It holds no credential and imports no model client.** Reasoning leaves through
an injected port (`ReasoningPort`, from `@specsesh/agent/interpreter`). The model
clients live in the other entry points, behind optional peers. See
`src/interpreter/port.ts`.

## Drift travels one way

The Agent Script **language specification is closed to outside contribution** —
upstream's own words: *"we're not accepting changes to the language spec for
now. The spec needs to stay in sync with the runtime."* So we cannot propose a
change, and we cannot fork one either: a divergent dialect would be a language
nobody else's tooling reads.

Drift is therefore **absorbed, never upstreamed**. Every upstream dependency is
pinned to an exact version, and `scripts/check-subset-conformance.mjs` — run by
this package's own `test` script — parses one probe per supported construct and
fails naming any whose handling changed. A version bump cannot land while a
construct silently started meaning something else.

The supported constructs are declared once, in `src/interpreter/subset.ts`. The
conformance script, the refusal a caller gets, and the list below all read that
same declaration rather than keeping a copy of it.

## The supported subset

Anything outside this list is refused **before the run starts**, by name and
position, and worded as *unsupported by this runtime* — the document is very
likely valid Agent Script that Salesforce's runtime would execute; what is true
is that we do not implement it.

<!-- SUBSET:BEGIN — generated from renderSubsetMarkdown(); do not hand-edit -->
- `config` — the config block naming the agent
- `system.instructions` — standing instructions, as a multiline block
- `variables` — declared variables with a type and a literal default
- `variables.description` — a variable's description
- `subagent` — a named subagent with a description
- `subagent.reasoning` — a subagent's reasoning block
- `reasoning.prompt-line` — a prompt line, interpreted by the model
- `reasoning.interpolation` — a `{!@variables.x}` reference inside a prompt line
- `reasoning.logic-line` — a logic line, run deterministically every turn
- `reasoning.structured-output` — assigning a variable from a field of the step's structured result
- `subagent.actions` — actions a subagent defines, each bound to a host tool
- `reasoning.run` — a run statement, calling an action deterministically
- `reasoning.actions` — actions a reasoning step offers the model as tools
<!-- SUBSET:END -->

`__tests__/core/subset-single-source.test.ts` fails if that block and the declaration
disagree, so the three restatements this requirement warns about cannot appear.

**This already caught something.** The vocabulary in Salesforce's own README
example is `topic`; the pinned dialect deprecates it — *"'topic' is deprecated:
Replace topic with subagent."* The subset uses `subagent`. Building on the
deprecated spelling would have been a decision nobody made.

## The interpreter runs the dialect's spelling, not a near-miss of it

A document this interpreter runs must be one an author could SAVE — the two
halves of this package parse the same text with the same dialect, and where
they disagreed, the authoring surface was right. Three spellings had drifted,
each runnable and each an error in the author's editor:

| the dialect | the near-miss it rejects |
|---|---|
| `approved: mutable boolean = True` | `true` — *"'true' is not a valid value in AgentScript. Did you mean 'True' (capitalized)?"* |
| `| Draft the {!@variables.stage}.` | `{@variables.stage}` — *"The '!' is required for template interpolation."* |
| `set @variables.verdict = @outputs.verdict` | `@output` — *"'@output' is not a recognized namespace"* |

`run()` now refuses any document carrying error-severity diagnostics, before it
scans and before it dispatches. That covers a fourth case the list above cannot:
the parser RECOVERS from a syntax error rather than throwing, so an unterminated
string used to execute to `completed` with a variable holding a value the
recovery invented. Every fixture the interpreter tests against is asserted
lint-clean by `__tests__/core/fixtures-lint.test.ts`, which is the seam that was
missing when all three drifted.

## License

Apache-2.0. See `LICENSE`.
