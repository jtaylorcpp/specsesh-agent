# agentscript

Solo project. Agent Script (Salesforce's agent language) as an authoring format, plus our own
interpreter over a declared subset of it. Spun out of coopcli on 2026-10-10 from tag
`archive/pre-unspecced` (`packages/agentscript`); the pre-split history lives in coopcli
(`5adc6fb2`, `a393f49a`, `c38e7f95`, `6e819b8f`, `baf124c9`). coopcli's OpenHypothesis/OpenSpec
flow does **not** apply here.

## Layout (pnpm workspace)

Two npm packages publish from this workspace:

- `packages/agent` → `@specsesh/agent`, the library, with an entry point per layer and the four
  `agentscript-*` bins. Ten exports, in this order: `./authoring`, `./interpreter`, `./pi`,
  `./claude-code`, `./durable`, `./node`, `./cloudflare`, `./openspec`, `./task`, `./cli`. Built
  by `tsc` into `dist/`, tested from `__tests__/`. The layer boundaries are directories, enforced
  by `__tests__/package/layers.test.ts`.
- `packages/specsesh` → `specsesh`, the `specsesh` command that `npx specsesh` runs. Plain
  JavaScript (`bin/specsesh.js`), no build and no `scripts`: it only calls `main` from
  `@specsesh/agent/cli`. Its dependencies are `@specsesh/agent` at `workspace:*` plus `pi-ai`,
  `pi-durable` and `chord` pinned to the exact versions in the agent's `devDependencies`.
  `pnpm -r check` and `pnpm -r test` skip it; its tests live in `packages/agent/__tests__/package/`
  (`manifest.test.ts`, `specsesh.test.ts`, `pack.test.ts`).

Both packages publish at the same `version`, `license` (Apache-2.0), Node engine (`>=22.19.0`) and
`repository` (with its `directory`); every other workspace package is `private`. `specsesh` is
packed with `pnpm pack`, which rewrites `workspace:*` to the exact version, and `pnpm pack:check`
checks both tarballs.

The rest of this section is `packages/agent`:

| Directory → entry | What it is |
|---|---|
| `src/authoring`, `src/interpreter` → `./authoring`, `./interpreter` | The core: authoring + interpreter. No model client, ever. |
| `src/pi` → `./pi` | A `ReasoningPort` on `@earendil-works/pi-ai`, so any pi provider can run a script. Default testing model: `anthropic/claude-haiku-4-5`. `ollama.ts`: the Ollama provider (`ollamaProvider`, `registerOllama`), keyless, OpenAI-compatible. |
| `src/claude-code` → `./claude-code` | The claude-code port and pi provider (Node only). |
| `src/durable` → `./durable` | A pi-durable extension: each run is a crash-safe `agentscript.run` task. Works in any pi-durable host (Node SQLite/JSONL/memory, or a Durable Object). Runtime-neutral: never imports `node:` or `src/claude-code`, so `./cloudflare` can import it. Holds `workspace.ts` (`Workspace`, whose `publish` is optional and which `localWorkspace` never has; `memoryWorkspace`, `workspaceActions`, `runChecks`, `diffSnapshots`), `delegation.ts` (grants, `delegationActions`), `agent-runner.ts` (`agentRunner()`, the `agent` runner: checks a grant against the harness's models and registry, runs it as a durable host action whose child ID commits with the `act` checkpoint, answers `{ ok, summary, files_changed }`; also in node `defaultRunners`), `delegate-scripts.ts` (`READ_AGENT`, `EDIT_AGENT` as source strings, no file system, so they work in Workers; the delegate contract: `instructions` seeded, `ok` and `summary` read back) `agent-config.ts` (`AgentConfig`, `createAgentHarness`) and `watch.ts` (`watchScript`, a durable run as `RunEvent`s). |
| `src/node` → `./node` | The Node side of `./durable`: `localWorkspace(dir)`, `builtinActions` (moved from `src/durable/builtins.ts`), `claudeCodeRunner({ binary? })` and `defaultRunners`. `mcp.ts`: `mcpTools(servers)`, MCP servers' tools as host actions `<server>/<tool>`, the only importer of `@modelcontextprotocol/sdk`. Adds `src/durable`, `src/claude-code` and the MCP SDK. |
| `src/cloudflare` → `./cloudflare` | `AgentScriptHost`, the Durable Object class (via Cloudflare's `PiHarness`, `agents` 0.28.0), Workers AI by default; `defineAgentHost`, `workersAI` and the Sandbox/Artifacts workspaces (see below). |
| `src/openspec` → `./openspec` | The OpenSpec ontology (`openspec/{model,process,loops,evidence}`): TypeBox schemas (each a JSON Schema) with `Static` types and refinements, plus pure rules. Imports only `typebox`; no parser, no loop runner. |
| `src/task` → `./task` | The task loop (`agentscript.task-loop`): an Agent Script run once per iteration as an `agentscript.run` child until the task converges, blocks, exhausts or fails; ticks tasks.md. Also the spec loop (see below). Bundled scripts in `src/task/scripts/` (copied into `dist/` by the build). Adds `src/node`. |
| `src/cli` → `./cli` | The `specsesh` command: `main(argv, deps)` and `USAGE` route `agent \| durable \| task \| change` to `agentscript-pi \| -durable \| -task \| -change`. `task` implies `run`. `--help`, `--version`, `llm` (a short map for LLM agents, `docs/llm/guide.md`, a starter skill, `templates/SKILL.md`, and `llm providers [<name>]` / `llm deploy <local\|cloudflare>`, which print the pages below by fixed name, from `llm.ts`) and `<change|task|durable|agent> help` (the command's usage plus `docs/llm/<command>.md`) are handled here. Importing it runs nothing. Like `src/bin`, not a layer that `__tests__/package/layers.test.ts` constrains. |
| `src/bin` | The `agentscript-pi`, `agentscript-durable`, `agentscript-task` and `agentscript-change` bins. The four `agentscript-*` bins stay for 0.x; `specsesh` reaches them in-process. |
| `docs/providers/` | Shipped provider pages (`api-keys`, `claude-code`, `ollama`, `workers-ai`) and `README.md`, the provider × command × deployment matrix that `__tests__/package/usage-docs.test.ts` checks against the registered providers. |
| `docs/deploy/` | Shipped deployment pages: `local.md` and `cloudflare.md`. |

The CI test picker (`src/task/test-pick.ts`, exported from `./task`): `pickTests(input, options)` runs the
bundled `ci-test-pick.agent` once to pick the tests that cover one closed task, for Specsesh CI's
`{!@ci.selected_tests}` and `{!@ci.test_pattern}`. Input `{ task_id, task_text, scenarios, changed_files,
test_files, diff? }` (lists newline-separated); options `{ port?, provider?, model?, models?, timeoutMs?
(120000), script?, maxDiffChars? (20000) }`. `siblingTests` adds every test beside a changed file first; the
model's `pick` JSON is checked against `TestPick`, paths outside `test_files` are dropped, all is deduped. It
answers `{ ok: true, pick }` or `{ ok: false, reason }` and never throws. `TestPick`, `TestReason` and
`testPattern` live in `src/openspec/pipeline.ts` (`./openspec`, Worker-safe) until `@specsesh/ontology/pipeline`
is published; `./task` re-exports `testPattern`.

The spec loop (`agentscript.spec-loop`, version 1) is a durable task in which an agent drafts one
stage of an OpenSpec change (proposal, design, specs or tasks), a gate with no model checks it, and
the loop iterates until the gate is clean, then blocks for the principal's review. Module by module
in `src/task`:

- `spec-stage.ts`: `SpecStage { name, owns, script, after?, seed?, gate }`, `StageContext`,
  `StageIssue`. `owns` paths are relative to the change directory; a trailing `/` owns everything
  under it. `after` names the stages that must be approved before this one starts.
- `spec-bundle.ts`: parses `files` as `=== <path>` sections; text before the first header is
  ignored. An absolute, `..` or unowned path is not written and becomes an ERROR issue, and so
  does an empty bundle.
- `spec-loop.ts`: phases `iterate` → `await` → `write` → `gate`. `current` is re-read from disk
  every iteration. Blocking issues carry into the next one as `<level> <path>: <message>` lines,
  up to `maxIterations` (default 8), then the loop ends `exhausted`.
- `spec-api.ts`: `startSpecLoop`, `waitForSpecLoop` and `specLoopExtensions`, exported from `./task`.
- `spec-answer.ts`: `answerSpecLoop`, also exported from `./task`.
- `spec-approvals.ts`: reads, records and checks `approvals.json`.

The stage contract: seeded strings `change_id`, `stage`, `intent`, `approved`, `current`, `base`,
`carried` and the number `iteration`; read back `files`, `summary`, `next_action` (`review` or
`ask`) and `question`. `startSpecLoop` refuses a script that breaks it and starts nothing. A clean
gate (no ERROR or WARNING) ends `blocked`, reason `review`, escalated to the principal at level
`change`, with result `{ change, stage, files, approved: false }`. `ask` ends `blocked`, reason
`question`, to `escalateTo`, skipping the gate.

Answering: `answerSpecLoop(harness, id, { by, principal, decision }, context)`, which, like every answer in
the package, starts a new run of the blocked loop.

- **Approve.** On a review, the decision `approve` (trimmed, any case) writes no draft, records the
  approval in `approvals.json` and ends the run `converged` with `approved: true`.
- **Revise.** Any other decision on a review is carried into the next draft as
  `The principal asked for: <decision>`, iterations numbering on from the blocked run.
- **Questions.** An answer to a question is always carried the same way, even `approve`, and
  nothing is recorded.
- **Only the principal approves.** An answer to a review is refused unless `by` is `"principal"`
  and `principal` names who answered. A refused answer starts no run and records nothing.

`approvals.json` lives in the change directory. Each entry is the ontology's `Approval`
(`approved`, `by: "principal"`, `principal`, `notes`) plus `stage`, `at` and a sha256 per owned
file, and every read checks it against a TypeBox schema. Approving a stage replaces its entry and
drops the entry of every stage that follows it, directly or through others. The runner never
commits it: the principal commits it with the stage's files. `startSpecLoop` refuses a stage, and
creates nothing, when a stage in its `after` has no approval (naming that stage), when a recorded
hash no longer matches its file (naming the file and the stage to review again), or when
`approvals.json` fails the schema (naming the file). The CLI (`pnpm task answer` for spec loops)
is `add-spec-cli`'s job.

`proposalStage` (`src/task/stages/proposal.ts`, exported from `./task`) is the first stage: named
`proposal`, it owns `proposal.md`, follows no stage, and runs the bundled
`src/task/scripts/spec-proposal.agent`, one structured subagent that sets `files`, `summary`,
`next_action` (default `review`) and `question`. Its seed sets `base` to one line per capability in
`openspec/specs/`, `<area>/<name>: <purpose>`, in path order. Its gate checks shape and facts, not
quality, and includes `proposalSizeIssues` (`openspec/size`): more than two capabilities is a
`WARNING`, so the draft goes back to narrow itself.

The proposal format, as the gate enforces it (an `ERROR` for each break):

- Exactly five sections, in this order: `## Why`, `## What Changes`, `## Out of scope`,
  `## Capabilities`, `## Impact`.
- `## Capabilities` names at least one backticked `<area>/<name>` path after `**New:**` or
  `**Modified:**`, on the label's line or in nested bullets below it.
- A `Modified` path must already have a spec in `openspec/specs/`; a `New` path must not.
- Parsing is `readProposalCapabilities` in `src/task/stages/proposal-md.ts`, beside `tasks-md.ts`:
  the ontology has no Markdown parser.

```markdown
## Capabilities

- **New:** `spec/stages`.
- **Modified:**
  - `task/cli`;
  - `task/headless`.
```

`src/cloudflare`, module by module:

- `index.ts`: `AgentScriptHost`, unchanged. The entry re-exports the modules below. **Worker-only**
  (imports `agents` and `cloudflare:workers`).
- `agent-host.ts`: `defineAgentHost<Env>(config)` returns a Durable Object class whose harness is
  `createAgentHarness` inside `PiHarness`. Runners default to `{ agent: agentRunner() }`
  (`runners.ts`): no process runner, so a `claude-code` grant is refused. Same routes as
  `AgentScriptHost` (`routes.ts`), plus an optional `model` in the POST body: `400` for an unknown
  model, `422` for a refused start. **Worker-only** (imports `agents` and `cloudflare:workers`).
- `workers-ai.ts`: `workersAI(binding, modelId)`, a `ModelFactory` over the `AI` binding through
  `createAI({ binding })`. Worker-side, but it imports only `agents/models/pi-ai`, not
  `cloudflare:workers`, so it loads in plain Node; it needs only an `AI` binding.
- `sandbox-workspace.ts`: `SandboxLike` and `sandboxWorkspace(sandbox, { dir, secrets? })`. Confined
  read/write with a `realpath -m` check, quoted `timeout -s KILL` exec, git snapshot/list/search,
  `publish`, and every secret redacted as `***`. **Runtime-neutral**: plain Node tests drive it
  through the local-exec fake sandbox.
- `artifacts.ts`: `ArtifactsLike` and `artifactsSandboxWorkspace(artifacts, sandbox, { repo, fork,
  dir })`. Reuses or creates one fork per task, issues a fork-scoped write token (always redacted),
  and clones unless `dir` already holds that checkout. **Runtime-neutral**; tested against a fake
  Artifacts binding backed by local bare repos.

`sandbox-workspace.ts` and `artifacts.ts` never import `agents` or `cloudflare:workers`: the real
Sandbox SDK and Artifacts bindings are adapted to `SandboxLike`/`ArtifactsLike` at the host.

Nothing here deploys. No code or script in this package runs `wrangler deploy`; tests use fakes
and `examples/cloudflare-worker` on `wrangler dev --local` (routes covered by `test/routes.sh`).
The real binding shapes are checked at the first deploy, outside `add-cloudflare-workspace`.

In `@specsesh/agent`, pi-ai, pi-durable, chord and `agents` are optional peers (dev dependencies
there); only the four `@sf-agentscript/*` packages and `typebox` (exact `1.3.27`, the version pi-ai
pins) are required. `examples/hello-world` and `examples/cloudflare-worker`
(the Worker, with `FauxAgentScriptHost` adding `AGENTSCRIPT_FAUX=1` for local tests) consume
`@specsesh/agent` through `workspace:*` and its public entries only.

## Where it stands

- `./authoring` — parse, mutate with undo/redo, lint, over `@sf-agentscript/*`. Was used by
  specsketch's settings tab as a prompt editor.
- `./interpreter` — subset scan, prompt composition, logic lines, structured state, three step
  outcomes; `run`, and `streamRun` (or `run`'s `onEvent`) for its `RunEvent`s. Core tests drive a recording port; pi tests drive pi's faux provider.
- `./pi` — without `tools`, one `reason()` = one pi `complete()`. Structured steps offer a single
  `submit_result` tool and force it per wire API (`forceTool`). Failure categories come only from
  `stopReason` and the HTTP status, never from message text. It loops only when given `tools` (a
  `PiToolHost`): offered tools run on the host and their results go back to the model, a
  structured step that never called `submit_result` gets one forced settling request, and
  `maxRounds` (default 16) bounds it, ending `cut-short`. Without `tools`, a tool request is refused.
- `--provider claude-code` (`src/claude-code.ts`) — the subscription option. Each step spawns your own
  `claude -p --safe-mode --tools "" --no-session-persistence --output-format json [--json-schema]`,
  with `ANTHROPIC_API_KEY` stripped so the subscription login is used. **Never** read or forward
  Claude Code's OAuth token to pi or any other client: that is against Anthropic's terms (coopcli
  withdrew exactly that in `simplify-specsketch-workbench`), and a test pins its absence.
  `--safe-mode` on every step that offers no tools: without it your global CLAUDE.md leaks into
  every step. A tool step passes the measured replacement (`--setting-sources "" --disable-slash-commands
  --strict-mcp-config`) instead, because `--safe-mode` also turns off the step's MCP server
  (`add-claude-code-tools`, design decision 1). Never `--bare` (it forces API-key auth), and
  `ANTHROPIC_API_KEY` is still stripped on tool steps. Each step runs in a fresh empty directory under `os.tmpdir()`, removed
  after (or in the port's or provider's `cwd` option), and the system prompt ends with a fixed
  no-workspace note, because Claude Code's environment block (working directory, git status,
  platform) can't be turned off. First live run: 2026-10-10, triage example, Haiku 4.5, completed.
  Tools and MCP work on one-shot runs (`agent run --tools`/`--mcp`): the port, given `tools` and
  `bridge: mcpBridge()` (`src/node/mcp-bridge.ts`), serves the step's offers to `claude` as one
  loopback MCP server, `agentscript`, plus `--mcp-config`, `--allowedTools mcp__agentscript__…` and
  `--permission-mode dontAsk`; Claude Code calls them, possibly in parallel, and each runs on our
  host. Not on durable runs yet (`add-durable-claude-code-tools`). Claude Code's built-in tools stay
  off (`--tools ""`); a delegate's `claudeCodeRunner` is different, see Hard lines.

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
node packages/agent/dist/bin/agentscript-task.js pick-tests --input in.json [--provider --model --timeout <ms>]
                                # pickTests once; prints { ok, pick, pattern } or { ok, reason }; exit 0/1/2
pnpm --filter hello-world-example start [name]                                      # the example app, on Haiku
pnpm --filter cloudflare-worker-example dev    # wrangler dev; add --var AGENTSCRIPT_FAUX:1 without an account
pnpm test:cloudflare            # opt-in, not in `pnpm test`: crash/resume (kill -9 mid-step) + route scripts, local DO storage
pnpm test:ollama                # opt-in, not in `pnpm test`, built bins: a durable run killed mid-step and resumed, then a one-task
                                # loop, on a local Ollama model (OLLAMA_TEST_MODEL or the first pulled); skips when no server answers
pnpm spec:check                 # openspec validate --all --strict
pnpm change close <change-id>   # end a built change: guard, trial fold, archive (see "Specs")
pnpm spec:archive <change-id>   # this repo's own script: validate, trial fold, archive; no database
pnpm docs:check                 # docs/ concept pages: front matter, ids, README index, spec refs, links
```

Provider/model also come from `AGENTSCRIPT_PROVIDER` / `AGENTSCRIPT_MODEL`; credentials are pi's
env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ...). The bins are compiled JavaScript;
nothing needs `tsx`.

## Releasing

```bash
node scripts/release-check.mjs v0.2.0   # run it locally before tagging; prints latest or next
git tag v0.2.0 && git push origin v0.2.0
```

- **Lockstep versions.** `@specsesh/agent` and `specsesh` always share one exact semver version.
  To release, set `version` in `packages/agent/package.json` and `packages/specsesh/package.json`
  to the same value and commit on `main`. A prerelease (`0.2.0-rc.1`) goes to the `next`
  dist-tag, anything else to `latest`. Build metadata is not allowed.
- **A pushed `v<version>` tag is the only trigger.** No branch, PR or manual dispatch publishes.
- **The workflow.** `.github/workflows/release.yml` runs `pnpm install --frozen-lockfile`,
  `pnpm check`, `pnpm test`, `pnpm pack:check`, the release check, then
  `pnpm --filter <pkg> pack --pack-destination release` for both packages, the release check
  again with `--packed release/specsesh-<v>.tgz`, and finally
  `npm publish <tarball> --access public --provenance --tag <dist-tag>`, first
  `./release/specsesh-agent-<v>.tgz`, then `./release/specsesh-<v>.tgz` (the `./` matters: npm
  reads a bare `release/<name>.tgz` as GitHub shorthand and fails). It publishes through npm
  trusted publishing (OIDC). Its only permissions are `id-token: write` and `contents: read`, and
  every action is pinned to a commit SHA. It uses no npm token or `secrets.`. Don't add any.
- **`scripts/release-check.mjs <tag> [--packed <specsesh.tgz>]`**, no dependencies: both versions
  equal and semver, the tag `v<version>`, npm 11.5.1 or newer, and with `--packed`, the packed
  `specsesh` depending on exactly that `@specsesh/agent` version. It prints the dist-tag on stdout,
  exits 1 with one stderr line per problem and 2 on usage (no tag). `RELEASE_CHECK_ROOT` sets the
  repo root (the tests use it).
- **Partial failure.** If the agent publishes but `specsesh` fails, re-run only the `specsesh`
  publish step or cut the next patch. Never re-tag an existing version.
- **Never `npm publish` by hand after the first.** Each package's first version is published
  manually only because a trusted publisher can't be attached until the package exists
  (`openspec/changes/archive/2026-10-16-add-npm-release-workflow/design.md`, "Manual steps"). Every later version
  goes through the tag and the workflow so it carries provenance. Publishing access requires 2FA
  and disallows tokens.

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
- **The task preamble.** Inside a task loop (a task, or a group's task), every delegate called with
  `run` gets the task preamble before its instructions: the change, the task, the rules, then the
  proposal, design and deltas in full (`taskPreamble`, carried as `RunInput.delegatePreamble`).
  Outside a loop, and for a delegate offered as a step tool, it gets none.
- **`changed` is seeded, if declared.** Before each iteration the loop seeds `changed` (the files
  changed since the loop started, one per line, measured from a baseline its first iteration takes
  and keeps across `resume` and answers; `(unknown)` when the workspace can't snapshot) into a
  script that declares it as a string. It leaves out `tasks.md` and `excludeChanged` (the CLI's
  database). The bundled judges show it beside the delegate's per-iteration count. A host may make
  passing checks sufficient with a logic-only subagent after `judge` (`if @variables.checks_passed:`
  / `set @variables.met = True`), at the cost of making the checks the whole definition of done;
  the bundled scripts keep the judge.
- **Headless.** It never prompts. Progress is JSON Lines on stderr after the resume hint; the outcome
  is on stdout. Exit `0` converged, `1` blocked/exhausted/failed, `2` refused.
- **Clean tree.** `run` refuses uncommitted changes (listing them) so every edit after it is the
  loop's; `--allow-dirty` overrides. `loop-ended.changed` lists the files the loop changed since its
  start, from the same baseline, so it holds across `resume` and `answer` and per task in a group.
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

## Specs (OpenSpec 1.14.2, pinned; 1.14.1 is the minimum the agent supports)

`openspec/specs/<area>/<capability>/spec.md` is the contract: `core/{authoring,subset,composition,
reasoning-port,step-machine}`, `pi/{port,cli,claude-code}`, `durable/{run-task,host,cli,cloudflare}` and
`package/distribution`. Specs state public
behaviour only; internals go in a change's `design.md`. Stock `spec-driven` schema.

- Every behaviour change starts as `openspec new change <verb-led-id>` with deltas against these specs.
- One test per scenario, named `Scenario: <exact scenario name>`.
- A task names at most about 8 scenarios. Split a capability's tests across tasks rather than
  writing one task for all of them.
- **A built change ends with `pnpm change close <change>`.** It refuses an unfinished change (a task
  unticked, the change's newest change loop not converged, or `openspec validate <change> --strict`
  failing) and changes nothing. Otherwise it folds the change into a temp copy of `openspec/`,
  validates that with `--specs --strict`, and only then runs `openspec archive <change> --yes`, with
  `OPENSPEC_TELEMETRY=0` throughout. It prints the capabilities folded into, the archive directory
  and `git add -A openspec && git commit`, but never commits: that stays with the principal. There
  is no `--force`: finish the change with `pnpm change build`, or tick a task you did by hand.
- **Never `openspec archive` directly.** 1.14.1 archives invalid changes with exit 0 and drops
  requirements. `pnpm spec:archive <change>` (`scripts/spec-archive.mjs`) stays as this repo's own
  script: the same three steps (validate, trial fold, archive), no database. Other repos don't use
  it, and it isn't the step a built change points at.
- **Plans written before `close`** may end with a `pnpm spec:archive <change>` task. Run
  `pnpm change close <change>` instead, and don't write new archive tasks.
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
  - the loop's preamble and the instructions go only on stdin, followed by the terms block.

`packages/agent/__tests__/core/{import-boundary,no-compiler}.test.ts` and `__tests__/package/layers.test.ts` enforce the first two.
