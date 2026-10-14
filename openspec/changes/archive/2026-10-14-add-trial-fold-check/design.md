# Design: add-trial-fold-check

## Context

`close` already runs a trial fold. It copies `openspec/` into a temporary directory, folds the change's deltas into that copy's specs, and runs `openspec validate --specs --strict` there. `add-spec-amendments-cli` moved that routine, `trialFold`, out of `close`'s command code so other code can call it. It is still exported from `src/task/cmd-close.ts`.

In openspec 1.14.1, `validate <change> --strict` checks the length of ADDED requirements but not MODIFIED ones. So today a change can pass the specs gate, `pnpm change build` and verify, and still fail at `close` (gaps.md #17). This change calls the same `trialFold` in two more places:

1. **The specs stage's gate** (`spec/stages`). The fold's errors and warnings go back into the spec loop as issues on the draft.
2. **The change loop's `check` phase** (`task/change`). The fold runs after the change checks pass. A failing fold ends the build `blocked` instead of `converged`.

The principal made two decisions during the build (group 1 escalation):

- **(a) `trialFold` returns structured issues.** The shared `trialFold` in `src/task/cmd-close.ts` now runs `openspec validate --specs --strict --json` and returns issues as `{ level, spec, message }`. `close` formats those issues itself, and its printed output stays exactly as it is today. Neither new caller parses human-readable text.
- **(b) The gate's wrapper lives in `src/task/stages/trial-fold-issues.ts`**, with its tests in `__tests__/task/stages/trial-fold-issues.test.ts`. Putting it under `src/spec/` would break the package's layer rule.

This is the only change made to `close`'s code: the routine it shares now returns structured data. What `close` does and prints stays the same. openspec itself and the gates of the proposal, design and tasks stages do not change.

The new shape of the shared routine (full version in `design/examples/trial-fold.ts`):

```ts
// src/task/cmd-close.ts
export interface TrialFoldIssue { level: "ERROR" | "WARNING"; spec: string; message: string }
export interface TrialFoldResult {
  ok: boolean;
  command: "openspec validate --specs --strict --json";
  exit: number | null;          // null: could not spawn
  issues: TrialFoldIssue[];     // from the JSON report, INFO dropped
  failure?: string;             // spawn error, or "no parseable JSON" plus raw stdout/stderr
}
export function trialFold(workspace: string, change: string): Promise<TrialFoldResult>;
export function formatTrialFold(result: TrialFoldResult): string; // the lines close prints today
```

`trialFold` builds `issues` from the JSON report. For each item of type `spec`, each of its issues becomes one `TrialFoldIssue`, with `spec` set to the item's id (for example `task/change`). `INFO` issues are dropped. The routine creates the temporary copy and removes it in a `finally`, so no caller deals with temporary directories. `formatTrialFold` is the formatting `close` used to do inline. `close` calls it, so its output is unchanged, and the build calls it too, so a blocked build shows the same text `close` would show.

## How it is used

### At the specs gate

The specs gate keeps strict change validation as its first rule. Then, only if that validation reported no `ERROR`, it calls `trialFoldIssues` from `src/task/stages/trial-fold-issues.ts` and adds the result:

```ts
// src/task/stages/trial-fold-issues.ts
import { trialFold } from "../cmd-close";

export async function trialFoldIssues(workspace: string, change: string): Promise<Issue[]> {
  const fold = await trialFold(workspace, change);
  if (fold.failure !== undefined) {
    return [{ level: "ERROR", message: `openspec validate --specs --strict could not run: ${fold.failure}` }];
  }
  const deltas = await deltaSpecs(workspace, change); // e.g. Set { "task/change", "spec/judge" }
  return fold.issues.map((i) => ({
    level: i.level,
    path: deltas.has(i.spec) ? `specs/${i.spec}/spec.md` : `openspec/specs/${i.spec}/spec.md`,
    message: `trial fold: ${i.spec}: ${i.message}`,
  }));
}
```

```ts
// specs gate, after the strict change validation rule
const issues = await strictChangeIssues(workspace, change);
if (!issues.some((i) => i.level === "ERROR")) {
  issues.push(...(await trialFoldIssues(workspace, change)));
}
issues.push(...coverageIssues(/* … */), ...sizeIssues(/* … */));
```

Each issue keeps the fold's level. Its `path` is the change's delta for that spec, `specs/<spec>/spec.md`, which is the file the next draft has to fix. A spec with no delta keeps a workspace path, `openspec/specs/<spec>/spec.md`. A fold that could not run, or printed no parseable JSON, is one `ERROR` naming `openspec validate --specs --strict`, the same way the existing first rule handles a command that fails. The full code is in `design/examples/trial-fold-issues.ts`, and the gate is in `design/examples/specs-gate.ts`. Because every fold warning is an issue, the spec loop keeps iterating until the folded specs validate. Only then can the specs stage be approved.

### In `pnpm change build`

In the `check` phase, the build runs each of `changeChecks` first, exactly as today. If any check exits non-zero, the build ends `failed` as before. If all exit `0`, the build calls `trialFold` directly from `src/task/cmd-close.ts`:

- **Fold passes:** the loop ends `converged`, with `unclaimed` filled in as today.
- **Fold fails or cannot run:** the loop ends `blocked` at `level` `"change"` and escalates to `principal`. The escalation's question is `trial fold failed: openspec validate --specs --strict` followed by `formatTrialFold(result)`. The `check` iteration also records a `CheckEvidence` for the fold command, with its exit code (or none) and that same text.

```ts
// change loop, check phase, after every change check exited 0
const fold = await trialFold(workspace, change);
evidence.push({ command: fold.command, exit: fold.exit, output: formatTrialFold(fold) });
if (!fold.ok) {
  return blocked({ level: "change", to: "principal",
    question: `trial fold failed: openspec validate --specs --strict\n${formatTrialFold(fold)}` });
}
return converged({ entries, unclaimed });
```

From the command line (`design/examples/build.sh`):

```sh
pnpm change build add-spec-amendments-judge
# … groups converge, change checks pass …
# blocked: trial fold failed: openspec validate --specs --strict
#   ✗ [ERROR] spec/judge: Requirement "…" text exceeds 500 characters (612)
$EDITOR openspec/changes/add-spec-amendments-judge/specs/spec/judge/spec.md
pnpm change answer add-spec-amendments-judge "deltas shortened"   # re-runs the check phase only
```

The rendered sessions for the gate and the build are in `design/mock.html`.

## Decisions

- **`trialFold` returns structured issues (principal's decision a).** It runs `openspec validate --specs --strict --json` and returns `{ level, spec, message }` issues. `close` formats them with `formatTrialFold`, and its output stays the same. Neither the gate nor the build reads human-readable openspec output.
- **One routine, no copies.** `close`, the gate wrapper and the change loop all import from `src/task/cmd-close.ts`. The build reuses `formatTrialFold` so that its blocked output matches what `close` prints.
- **The wrapper lives in `src/task/stages/` (principal's decision b).** That is `src/task/stages/trial-fold-issues.ts`, with tests in `__tests__/task/stages/trial-fold-issues.test.ts`. `src/spec/` cannot import from `src/task/` under the layer rule.
- **Issue paths point at the delta.** The `spec` id maps to `specs/<spec>/spec.md` inside the change when the change has a delta for it. Otherwise the path is `openspec/specs/<spec>/spec.md`. Either way the message names the spec.
- **The fold runs at the gate only when change validation is clean.** A delta that fails `validate <change> --strict` may not fold at all, and running the fold anyway would repeat the same problem as noise.
- **Warnings count as failures.** `--strict` makes openspec exit non-zero on warnings. At the gate each warning is a `WARNING` issue, so the loop iterates. In the build, any `ok: false` blocks. `INFO` is dropped.
- **A failing fold blocks the build; it does not fail it.** The code is done and only the specs need editing, which the principal decides on. A fold that cannot run (for example, `openspec` is missing) also blocks, with its `failure` text as the output.
- **Answering a fold block re-runs the `check` phase.** No group is blocked, so there is no group loop to hand the answer to. `answerChangeEscalation` starts a new change run, carrying the entries, that goes straight to `check`: the change checks, then the fold.
- **The fold goes in the existing `check` phase.** There is no new phase, and the checkpoint version stays `1`. If the process is killed during the fold, `check` runs again. Both the change checks and the fold are safe to repeat.
- **Every requirement stays under 500 characters.** The `task/change` behaviour goes into two new ADDED requirements, one for the fold in `check` and one for answering a fold block, instead of lengthening the existing MODIFIED ones. The same applies to the specs gate's fold rule in `spec/stages`. This change must pass its own fold.

## Risks

- **Cost:** every specs gate run and every build copies `openspec/` and runs openspec one more time. This is acceptable at the current size of `openspec/`. Copying less is a later optimisation and is not part of this change.
- **The JSON report shape:** `trialFold` depends on openspec 1.14.1's `--json` report (items with `id`, `type` and `issues`). If a later openspec changes that shape, the routine returns `failure` ("no parseable JSON"). The gate then reports one `ERROR` and the build blocks, so the problem stays visible instead of passing silently. The tests for `close` and for `trial-fold-issues` pin the shape.
- **`close`'s output:** moving the formatting into `formatTrialFold` could change what `close` prints. A test compares `close`'s output on a failing fold before and after the change.
- **The openspec gap may close:** if a later openspec checks MODIFIED requirements in the delta, the fold only duplicates that check. It stays correct, just redundant.
- **Answer semantics:** re-running `check` on an answer assumes the principal fixed the deltas first. An answer given without a fix blocks again with the same output. That is safe, but it repeats the work.

Files: `design/mock.html`, `design/examples/trial-fold.ts`, `design/examples/trial-fold-issues.ts`, `design/examples/specs-gate.ts`, `design/examples/build.sh`.
