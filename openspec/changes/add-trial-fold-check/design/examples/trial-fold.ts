// src/task/cmd-close.ts: the trial fold that add-spec-amendments-cli shared.
// It now runs `openspec validate --specs --strict --json` and returns structured issues.
// close, the specs gate wrapper and the change loop all import from here; none keeps a copy.

export interface TrialFoldIssue {
  level: "ERROR" | "WARNING"; // INFO from the report is dropped
  /** The folded spec's id, e.g. "task/change". */
  spec: string;
  message: string;
}

export interface TrialFoldResult {
  ok: boolean;
  command: "openspec validate --specs --strict --json";
  /** Exit code of the validate command, or null when it could not be spawned. */
  exit: number | null;
  /** One per issue of each `type: "spec"` item in the JSON report. */
  issues: TrialFoldIssue[];
  /** Set when the command could not run or printed no parseable JSON. */
  failure?: string;
}

/** Copy openspec/ to a temp dir, fold `change` into it, validate with --json, always remove the copy. */
export declare function trialFold(workspace: string, change: string): Promise<TrialFoldResult>;

/** The lines close printed before this change, now built from `issues` (or `failure`). */
export declare function formatTrialFold(result: TrialFoldResult): string;

// close itself, with unchanged output:
//   const fold = await trialFold(workspace, change);
//   if (!fold.ok) { process.stderr.write(formatTrialFold(fold)); return refuse(); }
