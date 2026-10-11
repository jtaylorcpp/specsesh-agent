# agentscript

Solo project. Agent Script (Salesforce's agent language) as an authoring format, plus our own
interpreter over a declared subset of it. Spun out of coopcli on 2026-10-10 from tag
`archive/pre-unspecced` (`packages/agentscript`); the pre-split history lives in coopcli
(`5adc6fb2`, `a393f49a`, `c38e7f95`, `6e819b8f`, `baf124c9`). coopcli's OpenHypothesis/OpenSpec
flow does **not** apply here.

## Layout (pnpm workspace)

| Package | What it is |
|---|---|
| `packages/agentscript` (`@coopcli/agentscript`) | The core: authoring + interpreter. No model client, ever. |
| `packages/agentscript-pi` (`agentscript-pi`) | A `ReasoningPort` on `@earendil-works/pi-ai` (exact-pinned) plus a CLI, so any pi provider can run a script. Default testing model: `anthropic/claude-haiku-4-5`. |
| `packages/agentscript-durable` (`agentscript-durable`) | A pi-durable extension: each run is a crash-safe `agentscript.run` task. Works in any pi-durable host (Node SQLite/JSONL/memory, or a Durable Object). Includes a Node CLI (`run`, `resume`). |
| `packages/agentscript-cloudflare` | Example Worker: the same extension inside a Durable Object via Cloudflare's `PiHarness` (`agents` 0.28.0). Workers AI by default; `AGENTSCRIPT_FAUX=1` for local tests. |

## Where it stands

- `./authoring` — parse, mutate with undo/redo, lint, over `@sf-agentscript/*`. Was used by
  specsketch's settings tab as a prompt editor.
- `./interpreter` — subset scan, prompt composition, logic lines, structured state, three step
  outcomes. Core tests drive a recording port; `agentscript-pi` tests drive pi's faux provider.
- `agentscript-pi` — one `reason()` = one pi `complete()`. Structured steps offer a single
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
- **agentscript-durable**: task phases `next` → `dispatch` (create a task-owned child conversation
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
- **claude-code pi provider** (`agentscript-pi/src/claude-code-provider.ts`): lets any pi host,
  pi-durable included, run on your subscription locally. Flattens system sections into
  `--system-prompt`, the transcript into the stdin prompt, and one offered tool into
  `--json-schema` (returned as a tool call). Refuses requests offering more than one tool.
- **This is a library** consumed from other projects, not a deployed service. `examples/` holds
  consumers (`hello-world`). Packages still export raw `.ts` with no build step.

## Commands

```bash
pnpm check                      # tsc in every package
pnpm test                       # core: conformance script + vitest; pi: vitest
pnpm agent run packages/agentscript-pi/examples/triage.agent --provider claude-code   # your subscription
pnpm agent run packages/agentscript-pi/examples/triage.agent        # pi, needs ANTHROPIC_API_KEY
pnpm agent run <file> --provider openai --model gpt-4o-mini --var name=value --json
pnpm agent models anthropic     # list a provider's models
pnpm durable run <file> --db runs.sqlite [--provider --model --entry --var --json]   # durable, pi-ai
pnpm durable resume <task-id> --db runs.sqlite                                      # finish a crashed run
pnpm durable run <file> --db runs.sqlite --provider claude-code                     # durable, on your subscription
pnpm --filter hello-world-example start [name]                                      # the example app, on Haiku
pnpm --filter agentscript-cloudflare dev    # wrangler dev; add --var AGENTSCRIPT_FAUX:1 without an account
pnpm --filter agentscript-cloudflare test   # kill -9 mid-step crash/resume on local DO storage (~40s)
```

Provider/model also come from `AGENTSCRIPT_PROVIDER` / `AGENTSCRIPT_MODEL`; credentials are pi's
env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ...). The CLI runs through `tsx`
because the core ships raw `.ts` with `.js`-suffixed imports.

## Hard lines (see README.md for the reasoning)

- Never call or depend on the upstream compiler (`@sf-agentscript/agentforce`).
- No model client, SDK or credential in the core package (`packages/agentscript`). Provider code lives in `agentscript-pi`. Model turns go through the injected `ReasoningPort`.
- Upstream deps are exact-pinned. Bumping one means running `pnpm conformance` and treating a failure as a decision about the subset.
- The supported subset is declared once, in `src/interpreter/subset.ts`; the README block is generated from it.

`__tests__/import-boundary.test.ts` and `no-compiler.test.ts` enforce the first two.
