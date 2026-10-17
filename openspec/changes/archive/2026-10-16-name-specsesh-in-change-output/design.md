# Design: name-specsesh-in-change-output

## Context

Slice 4 of `add-specsesh-command`'s `slices.md` (archived). `specsesh change` calls `agentscript-change`'s `main` in process, so whatever that `main` prints is what `npx specsesh change` users see. Today it names `agentscript-change` in its usage and resume hints and `pnpm change` in every next-command line, refusal and stale-approval hint.

## Decisions

- **One wording, both entries.** `agentscript-change` and `specsesh change` print the same text, naming `specsesh change`. Printing the old name from the old bin would need `main` to know how it was called, for a bin that stays only through 0.x. A user of `agentscript-change` can still run what it prints once `specsesh` is installed.
- **The strings live where they are built.** `change-output.ts` already gathers the next-command helpers (`reviseCmd`, `approveCmd`, `answerCmd`, `buildCmd`, `buildAnswerCmd`, `buildAmendCmd`, `closeCmd`, `retryCmd`, `sliceCmd`) and the stale-approval lines; they change in place. The usage and the two resume hints are in `src/bin/agentscript-change.ts`; the refusals in `cmd-draft.ts`, `cmd-approve.ts` and `cmd-close.ts`.
- **`pnpm change` runs `specsesh change`.** The root script becomes `node packages/specsesh/bin/specsesh.js change`, through the workspace link `packages/specsesh/node_modules/@specsesh/agent`, so this repository exercises the published path. It still needs `pnpm build` first.
- **Docs stay.** The guides, READMEs and `CLAUDE.md` describe this repository, where `pnpm change` remains right; renaming them is not part of this change.
