// src/task/stages/trial-fold-issues.ts (tests: __tests__/task/stages/trial-fold-issues.test.ts)
// Maps the structured trial fold to specs-gate issues. It does no text parsing.
import { trialFold } from "../cmd-close";
import type { Issue } from "../../ontology";

const FOLD = "openspec validate --specs --strict";

export async function trialFoldIssues(workspace: string, change: string): Promise<Issue[]> {
  const fold = await trialFold(workspace, change);
  if (fold.failure !== undefined) {
    return [{ level: "ERROR", message: `${FOLD} could not run: ${fold.failure}` }];
  }
  const deltas = await deltaSpecs(workspace, change); // ids with a delta under the change's specs/
  return fold.issues.map((i) => ({
    level: i.level,
    path: deltas.has(i.spec) ? `specs/${i.spec}/spec.md` : `openspec/specs/${i.spec}/spec.md`,
    message: `trial fold: ${i.spec}: ${i.message}`,
  }));
}

/** e.g. Set { "task/change", "spec/judge" } for openspec/changes/<change>/specs/{task/change,spec/judge}/spec.md */
declare function deltaSpecs(workspace: string, change: string): Promise<Set<string>>;
