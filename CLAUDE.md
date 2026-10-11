# agentscript

Solo project. Agent Script (Salesforce's agent language) as an authoring format, plus our own
interpreter over a declared subset of it. Spun out of coopcli on 2026-10-10 from tag
`archive/pre-unspecced` (`packages/agentscript`); the pre-split history lives in coopcli
(`5adc6fb2`, `a393f49a`, `c38e7f95`, `6e819b8f`, `baf124c9`). coopcli's OpenHypothesis/OpenSpec
flow does **not** apply here.

## Layout (pnpm workspace)

One npm package, `@specsesh/agent` (`packages/agent`, Apache-2.0), with an entry point per layer.
The layer boundaries are directories, enforced by `__tests__/package/layers.test.ts`.

| Directory → entry | What it is |
|---|---|
| `src/authoring`, `src/interpreter` → `./authoring`, `./interpreter` | The core: authoring + interpreter. No model client, ever. |
| `src/pi` → `./pi` | A `ReasoningPort` on `@earendil-works/pi-ai`, so any pi provider can run a script. Default testing model: `anthropic/claude-haiku-4-5`. |
| `src/claude-code` → `./claude-code` | The claude-code port and pi provider (Node only). |
| `src/durable` → `./durable` | A pi-durable extension: each run is a crash-safe `agentscript.run` task. Works in any pi-durable host (Node SQLite/JSONL/memory, or a Durable Object). |
| `src/cloudflare` → `./cloudflare` | `AgentScriptHost`, the Durable Object class (via Cloudflare's `PiHarness`, `agents` 0.28.0), Workers AI by default. |
| `src/bin` | The `agentscript-pi` and `agentscript-durable` bins. |

pi-ai, pi-durable, chord and `agents` are optional peers (dev dependencies here); only the four
`@sf-agentscript/*` packages are required. `examples/hello-world` and `examples/cloudflare-worker`
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

- **Step machine** (`start` / `next` / `apply` in `run.ts`): the run's state is plain JSON (`RunState`),
  `next` is pure, and `run()` is a loop over the three. A failed step rolls back only its own logic
  lines; logic-only subagents before it stay committed. This is what durable hosts checkpoint.
- **`./durable`**: task phases `next` → `dispatch` (create a task-owned child conversation
  for the step, in one commit) → `await` (submit with request ID `agentscript:<task>:<step>`, wait,
  `apply`). Each step is a fresh conversation: system block as `instructions`, its prompt, and
  `submit_result` only when it writes variables. The tool validates against the step schema (in the
  `agentscript.step` doc, shown via a `result` section), returns errors for the model to retry, and
  ends the run with `control.terminate`. Task IDs are numbers; a string ID makes `waitForTask` hand
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
  `pnpm pack:check` proves the packed tarball installs and runs in an empty project.

## Commands

```bash
pnpm check                      # tsc in every package (builds packages/agent/dist first)
pnpm test                       # agent: conformance + vitest (core, pi, durable, package); Worker scripts
pnpm pack:check                 # build, npm pack, install into empty projects, import every entry, run the bins
pnpm build                      # tsc → packages/agent/dist (the bins below run from it)
pnpm agent run packages/agent/examples/triage.agent --provider claude-code   # your subscription
pnpm agent run packages/agent/examples/triage.agent        # pi, needs ANTHROPIC_API_KEY
pnpm agent run <file> --provider openai --model gpt-4o-mini --var name=value --json
pnpm agent models anthropic     # list a provider's models
pnpm durable run <file> --db runs.sqlite [--provider --model --entry --var --json]   # durable, pi-ai
pnpm durable resume <task-id> --db runs.sqlite                                      # finish a crashed run
pnpm durable run <file> --db runs.sqlite --provider claude-code                     # durable, on your subscription
pnpm --filter hello-world-example start [name]                                      # the example app, on Haiku
pnpm --filter cloudflare-worker-example dev    # wrangler dev; add --var AGENTSCRIPT_FAUX:1 without an account
pnpm --filter cloudflare-worker-example test   # crash/resume (kill -9 mid-step) + route checks, on local DO storage
pnpm spec:check                 # openspec validate --all --strict
pnpm spec:archive <change-id>   # archive, but only after validate --strict passes
pnpm docs:check                 # docs/ concept pages: front matter, ids, README index, spec refs, links
```

Provider/model also come from `AGENTSCRIPT_PROVIDER` / `AGENTSCRIPT_MODEL`; credentials are pi's
env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ...). The bins are compiled JavaScript;
nothing needs `tsx`.

## Specs (OpenSpec 1.14.1, pinned)

`openspec/specs/<area>/<capability>/spec.md` is the contract: `core/{authoring,subset,composition,
reasoning-port,step-machine}`, `pi/{port,cli,claude-code}`, `durable/{run-task,host,cli,cloudflare}` and
`package/distribution`. Specs state public
behaviour only; internals go in a change's `design.md`. Stock `spec-driven` schema.

- Every behaviour change starts as `openspec new change <verb-led-id>` with deltas against these specs.
- One test per scenario, named `Scenario: <exact scenario name>`.
- **Never `openspec archive` directly.** 1.14.1 archives invalid changes with exit 0 and drops
  requirements; `pnpm spec:archive` refuses unless `validate --strict` passes.
- A delta that creates a capability should carry `## Purpose`: it is only read at creation, and
  archive otherwise writes a placeholder that `spec:check` rejects.
- Requirement text (before its scenarios) must stay under 500 characters, or strict fails.
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

`packages/agent/__tests__/core/{import-boundary,no-compiler}.test.ts` and `__tests__/package/layers.test.ts` enforce the first two.
