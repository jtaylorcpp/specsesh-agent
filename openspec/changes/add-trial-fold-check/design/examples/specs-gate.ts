// Sketch: the trial fold as the specs gate's second rule, and in the change loop's check phase.
// `trialFold` is the function add-spec-amendments-cli shared from cmd-close.ts (name and shape assumed).
import { trialFold } from "../../src/cli/cmd-close.ts";

type Level = "ERROR" | "WARNING";
interface GateIssue { level: Level; path: string; message: string }

const FOLD = "trial fold (openspec validate --specs --strict)";

// src/spec/trial-fold-issues.ts
export async function trialFoldIssues(
  workspace: string,
  change: string,
  deltaSpecs: Set<string>, // "<area>/<name>" of each delta the change has
): Promise<GateIssue[]> {
  let result;
  try {
    result = await trialFold(workspace, change);
  } catch (err) {
    return [{ level: "ERROR", path: FOLD, message: `${FOLD}: ${String(err)}` }];
  }
  return result.issues.map((i) => ({
    level: i.level,
    path: deltaSpecs.has(i.spec)
      ? `specs/${i.spec}/spec.md`
      : `openspec/specs/${i.spec}/spec.md`,
    message: `trial fold: ${i.spec}: ${i.message}`,
  }));
}

// In the specs gate: only fold when the change's own strict validation has no ERROR.
export async function specsGate(workspace: string, change: string, deltaSpecs: Set<string>) {
  const strict = await strictValidationIssues(workspace, change);
  const fold = strict.some((i) => i.level === "ERROR")
    ? []
    : await trialFoldIssues(workspace, change, deltaSpecs);
  return [...strict, ...fold /* , coverage, size … unchanged */];
}

// In the change loop's `check` phase, after every change check exits 0:
export async function foldAfterChangeCheck(workspace: string, change: string) {
  const r = await trialFold(workspace, change);
  const evidence = { command: `openspec validate --specs --strict (trial fold)`, exit: r.ok ? 0 : 1, output: r.output };
  if (r.ok) return { evidence, end: "converged" as const };
  return {
    evidence,
    end: "blocked" as const,
    escalation: {
      level: "change" as const,
      to: "principal",
      question:
        `The folded specs fail openspec validate --specs --strict:\n${r.output}\n` +
        `Fix the deltas through the specs stage, then answer to re-run the change check and the fold.`,
    },
  };
}

declare function strictValidationIssues(w: string, c: string): Promise<GateIssue[]>;
