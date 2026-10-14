Catch spec problems that only appear once a change is folded, before `close`. The specs stage's gate runs `close`'s trial fold (fold the change into a temporary copy of `openspec/` and run `openspec validate --specs --strict` there) and reports each error or warning it finds as an issue on the draft. `pnpm change build` runs the same trial fold after its change check, and a failing fold ends the build blocked with the fold's output, not built. Reuse the trial fold `add-spec-amendments-cli` shared from `cmd-close.ts`.

Why: gaps.md #17. openspec 1.14.1's `validate --strict` length-checks ADDED requirements in a delta but not MODIFIED ones; only the folded spec reports them. add-spec-amendments-judge passed drafting, its build and verify, then failed close's trial fold on three MODIFIED requirements over 500 characters, after the code was done.

Out of scope: changing openspec; `close` (it already runs the trial fold); the drafting gates of other stages.
