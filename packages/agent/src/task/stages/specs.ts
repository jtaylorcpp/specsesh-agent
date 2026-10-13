/**
 * The specs stage: drafts one delta per capability under `specs/` from the
 * approved design, seeded with the spec of every capability the proposal
 * modifies. The loop seeds `approved` with the proposal's and the design's
 * files, `design/` included. The gate is `openspec validate --strict`, then
 * coverage against the proposal and the size budget over `openspec show`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_SCRIPTS } from "../options.js";
import type { SpecStage, StageContext, StageIssue } from "../spec-stage.js";
import { modifiedSpecs } from "./design.js";
import { openspecDeltas, openspecValidate } from "./openspec-cli.js";
import { readProposalCapabilities } from "./proposal-md.js";
import { coverageIssues, specsSizeIssues } from "./specs-gate.js";

/** The approved `proposal.md`, or undefined before there is one. */
function approvedProposal(changeDir: string): string | undefined {
	const path = join(changeDir, "proposal.md");
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** True for the one `ERROR` that says `openspec validate` itself could not run or be read. */
const validateFailed = (issues: readonly StageIssue[]): boolean =>
	issues.length === 1 && issues[0]?.path === "." && (issues[0]?.message.startsWith("`openspec validate` failed") ?? false);

/**
 * OpenSpec's own issues, then coverage, then size. When `validate` cannot run, its one
 * `ERROR` stands for the command and `show` is not tried; when `show` fails, its `ERROR`
 * replaces the size check. Coverage always reads the delta files.
 */
export async function specsGate({ changeId, changeDir, files, run }: StageContext): Promise<StageIssue[]> {
	const proposal = readProposalCapabilities(approvedProposal(changeDir) ?? "");
	const validated = await openspecValidate(run, changeId);
	if (validateFailed(validated)) return [...validated, ...coverageIssues(proposal, [], files)];
	const shown = await openspecDeltas(run, changeId);
	return [
		...validated,
		...shown.issues,
		...coverageIssues(proposal, shown.deltas, files),
		...(shown.issues.length === 0 ? specsSizeIssues(proposal, shown.deltas) : []),
	];
}

export const specsStage: SpecStage = {
	name: "specs",
	owns: ["specs/"],
	after: ["design"],
	script: { path: fileURLToPath(BUNDLED_SCRIPTS.specSpecify) },
	seed: ({ workspace, changeDir }) => {
		const proposal = approvedProposal(changeDir);
		return { base: proposal === undefined ? "" : modifiedSpecs(workspace, proposal) };
	},
	gate: specsGate,
};
