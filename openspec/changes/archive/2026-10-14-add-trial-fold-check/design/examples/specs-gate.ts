// The specs stage's gate with the trial fold added after the strict change validation rule.
import { trialFoldIssues } from "../task/stages/trial-fold-issues";
import type { Issue } from "../ontology";

export async function specsGate(workspace: string, change: string): Promise<Issue[]> {
  const issues = await strictChangeIssues(workspace, change); // existing first rule
  if (!issues.some((i) => i.level === "ERROR")) {
    issues.push(...(await trialFoldIssues(workspace, change)));
  }
  issues.push(...coverageIssues(workspace, change), ...(await specsSizeIssues(workspace, change)));
  return issues;
}

declare function strictChangeIssues(w: string, c: string): Promise<Issue[]>;
declare function coverageIssues(w: string, c: string): Issue[];
declare function specsSizeIssues(w: string, c: string): Promise<Issue[]>;
