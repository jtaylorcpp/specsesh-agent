/**
 * The proposal stage: drafts `proposal.md` from the intent, seeded with every
 * capability the repo has. Its gate checks shape and facts, not quality: the
 * five sections in order, capability paths that exist (or don't, for new ones)
 * and the capability budget.
 */

import { fileURLToPath } from "node:url";
import { type Proposal, proposalSizeIssues } from "../../openspec/index.js";
import { BUNDLED_SCRIPTS } from "../options.js";
import type { SpecStage, StageIssue } from "../spec-stage.js";
import { capabilityLines, existingCapabilities } from "./capabilities.js";
import { PROPOSAL_SECTIONS, proposalSections, readProposalCapabilities } from "./proposal-md.js";

const PROPOSAL = "proposal.md";

const error = (message: string): StageIssue => ({ level: "ERROR", path: PROPOSAL, message });

/** One `ERROR` per missing section, naming its heading, and one when the sections present are out of order. */
export function sectionIssues(markdown: string): StageIssue[] {
	const headings = proposalSections(markdown).map((section) => section.heading);
	const issues = PROPOSAL_SECTIONS.filter((name) => !headings.includes(name)).map((name) =>
		error(`## ${name} is missing; a proposal holds ${PROPOSAL_SECTIONS.map((s) => `## ${s}`).join(", ")}, in that order`),
	);
	const present = PROPOSAL_SECTIONS.filter((name) => headings.includes(name));
	const order = present.map((name) => headings.indexOf(name));
	if (order.some((at, i) => i > 0 && at < (order[i - 1] as number))) {
		const found = [...present].sort((a, b) => headings.indexOf(a) - headings.indexOf(b));
		issues.push(error(`the sections are out of order: ${found.map((s) => `## ${s}`).join(", ")}; expected ${present.map((s) => `## ${s}`).join(", ")}`));
	}
	return issues;
}

/** An `ERROR` when no path is named, per modified path with no spec, and per new path that already has one. */
export function capabilityIssues(named: { readonly new: readonly string[]; readonly modified: readonly string[] }, existing: readonly string[]): StageIssue[] {
	const issues: StageIssue[] = [];
	if (named.new.length === 0 && named.modified.length === 0) {
		issues.push(error("## Capabilities names no capability; list backticked `<area>/<name>` paths after **New:** or **Modified:**"));
	}
	for (const path of named.modified) {
		if (!existing.includes(path)) issues.push(error(`\`${path}\` is listed as modified but has no spec in openspec/specs/`));
	}
	for (const path of named.new) {
		if (existing.includes(path)) issues.push(error(`\`${path}\` already exists and belongs under Modified`));
	}
	return issues;
}

/** The draft as the ontology's `Proposal`, enough for the size rules: each section's bullets, and the capabilities read. */
export function asProposal(markdown: string): Proposal {
	const sections = proposalSections(markdown);
	const body = (heading: string) => sections.find((section) => section.heading === heading)?.body ?? "";
	const bullets = (heading: string) =>
		body(heading)
			.split("\n")
			.filter((line) => /^\s*[-*] /.test(line))
			.map((line) => line.replace(/^\s*[-*] /, "").trim());
	const capabilities = readProposalCapabilities(markdown);
	return {
		why: body("Why").trim(),
		whatChanges: bullets("What Changes"),
		capabilities: { new: capabilities.new.map((path) => path.split("/")), modified: capabilities.modified.map((path) => path.split("/")) },
		outOfScope: bullets("Out of scope"),
		impact: bullets("Impact"),
	};
}

export const proposalStage: SpecStage = {
	name: "proposal",
	owns: [PROPOSAL],
	script: { path: fileURLToPath(BUNDLED_SCRIPTS.specProposal) },
	seed: async ({ workspace }) => ({ base: await capabilityLines(workspace) }),
	gate: async ({ workspace, files }) => {
		const markdown = files[PROPOSAL] ?? "";
		return [
			...sectionIssues(markdown),
			...capabilityIssues(readProposalCapabilities(markdown), await existingCapabilities(workspace)),
			...proposalSizeIssues(asProposal(markdown)),
		];
	},
};
