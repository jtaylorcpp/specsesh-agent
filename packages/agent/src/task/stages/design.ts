/**
 * The design stage: drafts `design.md` and its attachments under `design/` from
 * the approved proposal, seeded with the spec of every capability the proposal
 * modifies. The loop seeds `approved` with the proposal's files; the gate is
 * `designGate`'s shape and facts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_SCRIPTS } from "../options.js";
import { toBundle } from "../spec-loop.js";
import type { SpecStage } from "../spec-stage.js";
import { designGate } from "./design-gate.js";
import { readProposalCapabilities } from "./proposal-md.js";

/** One `=== openspec/specs/<area>/<name>/spec.md` section per capability `proposal` modifies, in its order; one with no spec is skipped. */
export function modifiedSpecs(workspace: string, proposal: string): string {
	const specs: Record<string, string> = {};
	for (const capability of readProposalCapabilities(proposal).modified) {
		const path = `openspec/specs/${capability}/spec.md`;
		if (existsSync(join(workspace, path))) specs[path] = readFileSync(join(workspace, path), "utf8");
	}
	return toBundle(specs);
}

export const designStage: SpecStage = {
	name: "design",
	owns: ["design.md", "design/"],
	after: ["proposal"],
	script: { path: fileURLToPath(BUNDLED_SCRIPTS.specDesign) },
	seed: ({ workspace, changeDir }) => {
		const proposal = join(changeDir, "proposal.md");
		return { base: existsSync(proposal) ? modifiedSpecs(workspace, readFileSync(proposal, "utf8")) : "" };
	},
	gate: designGate,
};
