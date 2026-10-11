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

## Where it stands

- `./authoring` — parse, mutate with undo/redo, lint, over `@sf-agentscript/*`. Was used by
  specsketch's settings tab as a prompt editor.
- `./interpreter` — subset scan, prompt composition, logic lines, structured state, three step
  outcomes. Core tests drive a recording port; `agentscript-pi` tests drive pi's faux provider.
- `agentscript-pi` — one `reason()` = one pi `complete()`. Structured steps offer a single
  `submit_result` tool and force it per wire API (`forceTool`). Failure categories come only from
  `stopReason` and the HTTP status, never from message text. The port has no round bound, so it
  never reports `cut-short`.

## Commands

```bash
pnpm check                      # tsc in every package
pnpm test                       # core: conformance script + vitest; pi: vitest
pnpm agent run packages/agentscript-pi/examples/triage.agent        # needs ANTHROPIC_API_KEY
pnpm agent run <file> --provider openai --model gpt-4o-mini --var name=value --json
pnpm agent models anthropic     # list a provider's models
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
