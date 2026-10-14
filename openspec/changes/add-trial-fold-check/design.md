# Design: add-trial-fold-check

## Context

`close` already checks a change by folding it into a temporary copy of `openspec/` and running `openspec validate --specs --strict` there. `add-spec-amendments-cli` moved that code out of `cmd-close.ts` into a shared function. This design calls it `trialFold`, though the real export name and shape are whatever that change shipped.

Two places don't use the fold yet:

- **The specs stage's gate.** It runs `openspec validate <change> --strict --json` on the deltas only. In openspec 1.14.1 that command length-checks ADDED requirements but not MODIFIED ones (gaps.md #17).
- **`pnpm change build`.** It ends after the change check. Nothing there looks at the folded specs.

This change adds the trial fold to both. It does not change openspec, `close`, or the other stages' gates.

The shape this design assumes for the shared fold:

```ts
// from cmd-close.ts (shared by add-spec-amendments-cli). Assumed shape.
trialFold(workspace: string, change: string): Promise<{
  ok: boolean;                 // validate exited 0 with no ERROR or WARNING
  issues: { level: "ERROR" | "WARNING"; spec: string; path?: string; message: string }[];
  output: string;              // validate's printed output, as close shows it
}>
```

If the real export differs, a small adapter in the new module covers the difference. It stays the only adapter, and the fold logic is not copied.

## How it is used

Neither place gets a new flag or command. Users see the fold through the specs loop and the build.

### At the specs stage's gate

The specs gate gets one more rule, after strict validation. The rule only runs when strict validation reported no `ERROR`. A delta that is already invalid is not folded, so the same problem is not reported twice.

```ts
// src/spec/stages/specs-gate.ts (sketch)
const strict = await strictValidationIssues(workspace, change);   // existing first rule
const fold = strict.some(i => i.level === "ERROR")
  ? []
  : await trialFoldIssues(workspace, change);                     // new rule
return [...strict, ...fold, ...coverageIssues, ...sizeIssues];
```

`trialFoldIssues` turns each `ERROR` or `WARNING` the fold reports into one gate issue:

- **Level:** the same level the fold gave it.
- **Message:** starts with `trial fold: ` so the drafter can tell it apart from a delta issue.
- **Path:** the change's own delta, `specs/<area>/<name>/spec.md`, when the change has a delta for that spec. Otherwise it is the main spec, `openspec/specs/<area>/<name>/spec.md`.

If the fold can't run (openspec can't be spawned, it prints nothing parseable, or the copy fails), the rule reports one `ERROR` naming `trial fold (openspec validate --specs --strict)`.

The specs loop already iterates on any `ERROR` or `WARNING`, so it keeps redrafting until the folded specs validate. The full flow is in [design/examples/specs-gate.ts](design/examples/specs-gate.ts).

### In `pnpm change build`

```sh
pnpm change build add-spec-amendments-judge
```

When every change check exits `0`, the `check` phase runs the trial fold in the same phase:

- **Evidence:** the fold is recorded as one more `CheckEvidence` in the same `{ check: "change" }` iteration. Its command is `openspec validate --specs --strict (trial fold)`, followed by the exit code and the fold's output.
- **Fold passes:** the loop ends `converged`, as it does today.
- **Fold fails:** the iteration is unmet and the loop ends `blocked`. The escalation is at `level` `"change"`, goes to `principal`, and its question holds the fold's output.
- **Answering the escalation:** a new change run starts. It goes straight to `check`, runs the change checks and the trial fold again, and keeps the groups already entered. The principal fixes the deltas through the specs stage, then answers.

The full session is in [design/examples/build.sh](design/examples/build.sh). [design/mock.html](design/mock.html) shows all three flows rendered: a specs gate pass, a blocked build, and a build that passes after the answer.

## Decisions

1. **One shared fold, wrapped once.** Both callers go through `trialFoldIssues` in a new `src/spec/trial-fold-issues.ts`. It calls the `cmd-close.ts` export and maps the result to gate issues. The build's check phase uses the same wrapper's raw result for its evidence and its escalation text. There is no second copy of the fold.
2. **Fold after strict validation, only when it is clean.** Folding a delta that openspec already rejects either fails or repeats the same error. Skipping the fold in that case keeps the issue list short. It costs one more iteration when both kinds of problem are present.
3. **Report every fold issue, including ones on specs the change does not touch.** The principal asked for each error or warning, so none are filtered out. Main specs are kept valid because every `close` runs this fold, so issues on untouched specs should be rare. When one does appear, it is a real blocker for `close` anyway.
4. **Issue paths point at the delta when there is one.** The drafter can only edit the change's files, so the issue names the file the drafter has to fix.
5. **Blocked, not failed, in the build.** The code is done and correct; only the spec text needs fixing. Ending `blocked` with the fold's output asks the principal to decide. Answering it re-runs only the `check` phase, so built groups are not rebuilt.
6. **No new checkpoint phase or task version.** The fold runs inside `check` after the change checks. Running it again on resume is harmless because it only touches a temporary copy. The checkpoint shape `{ phase, queue, entries, child? }` and version `1` stay the same.

## Risks

- **Cost.** Each specs gate run and each build copies `openspec/` and runs validate once more. On this repository that should take seconds. If it grows, the copy could be limited to the specs the change touches, but that would mean changing the shared fold, which is out of scope here.
- **Answering a fold block depends on the spec stage.** After the fix, the edited deltas no longer match `approvals.json`. The re-run `check` phase does not re-check approvals; only `startChangeLoop` does that. The principal is expected to re-approve the specs stage before answering. The alternative is to make a fold block unanswerable, so that a fresh `pnpm change build` is needed (ticked groups are not rebuilt). That would be stricter but heavier. Say if you prefer it.
- **The shared fold's shape is assumed.** If `add-spec-amendments-cli` exports something with no structured issues (output only), the wrapper has to parse `--json` itself. That is still one place, but it is more code than the sketch above.
- **Temporary copies left behind.** A process killed mid-fold can leave the temporary copy on disk. The shared fold is expected to clean up in `finally`. Nothing here adds cleanup of its own.
