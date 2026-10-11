# agentscript

Solo project. Agent Script (Salesforce's agent language) as an authoring format, plus our own
interpreter over a declared subset of it. Spun out of coopcli on 2026-10-10 from tag
`archive/pre-unspecced` (`packages/agentscript`); the pre-split history lives in coopcli
(`5adc6fb2`, `a393f49a`, `c38e7f95`, `6e819b8f`, `baf124c9`). coopcli's OpenHypothesis/OpenSpec
flow does **not** apply here.

## Where it stands

- `./authoring` — parse, mutate with undo/redo, lint, over `@sf-agentscript/*`. Was used by
  specsketch's settings tab as a prompt editor.
- `./interpreter` — subset scan, prompt composition, logic lines, structured state, three step
  outcomes. **Has never run against a real model**: every test drives a recording port. The
  only real port implementation (harness-backed, in specsketch) was never called outside tests.

## Commands

```bash
pnpm check        # tsc --noEmit
pnpm test         # subset conformance script, then vitest
pnpm conformance  # conformance only
```

## Hard lines (see README.md for the reasoning)

- Never call or depend on the upstream compiler (`@sf-agentscript/agentforce`).
- No model client, SDK or credential in `src/`. Model turns go through the injected `ReasoningPort`.
- Upstream deps are exact-pinned. Bumping one means running `pnpm conformance` and treating a failure as a decision about the subset.
- The supported subset is declared once, in `src/interpreter/subset.ts`; the README block is generated from it.

`__tests__/import-boundary.test.ts` and `no-compiler.test.ts` enforce the first two.
