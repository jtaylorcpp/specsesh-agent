/**
 * The specs stage's gate, the part with no `openspec` call: a delta for every
 * capability the approved proposal names and none other, a `## Purpose` on each
 * new one, and the change's size, its task limits left to the tasks stage.
 * Pure rules over the stage's files and the deltas `openspec show` parsed.
 */

import { type Change, type Delta as ModelDelta, type Scenario, sizeIssues } from "../../openspec/index.js";
import type { StageIssue } from "../spec-stage.js";
import type { Delta } from "./openspec-cli.js";
import type { readProposalCapabilities } from "./proposal-md.js";

type Files = Readonly<Record<string, string>>;

/** The `area/name` paths the approved proposal names. */
export type ProposalCapabilities = ReturnType<typeof readProposalCapabilities>;

const SPEC_FILE = /^specs\/([^/]+\/[^/]+)\/spec\.md$/;
const PURPOSE = /^## Purpose\b/m;

const specFile = (capability: string) => `specs/${capability}/spec.md`;
const error = (capability: string, message: string): StageIssue => ({ level: "ERROR", path: specFile(capability), message });

/** The capabilities with a delta: each `specs/<area>/<name>/spec.md` among `files`, then each delta's `spec`, distinct. */
export function deltaCapabilities(deltas: readonly Delta[], files: Files): string[] {
	const fromFiles = Object.keys(files).flatMap((path) => SPEC_FILE.exec(path)?.[1] ?? []);
	return [...new Set([...fromFiles, ...deltas.map((delta) => delta.spec)])];
}

/**
 * An `ERROR` per capability the proposal names with no delta, per delta for a
 * capability it doesn't name, and per new capability whose delta file has no
 * `## Purpose`, each at the capability's `specs/<area>/<name>/spec.md`.
 */
export function coverageIssues(proposal: ProposalCapabilities, deltas: readonly Delta[], files: Files): StageIssue[] {
	const named = [...new Set([...proposal.new, ...proposal.modified])];
	const covered = deltaCapabilities(deltas, files);
	const issues: StageIssue[] = [];
	for (const capability of named) {
		if (!covered.includes(capability)) {
			issues.push(error(capability, `the proposal names \`${capability}\` but there is no delta for it: write ${specFile(capability)}`));
		}
	}
	for (const capability of covered) {
		if (!named.includes(capability)) {
			issues.push(error(capability, `\`${capability}\` has a delta but the proposal does not name it; delete ${specFile(capability)}`));
		}
	}
	for (const capability of proposal.new) {
		const text = files[specFile(capability)];
		if (text !== undefined && !PURPOSE.test(text)) {
			issues.push(error(capability, `\`${capability}\` is new, so ${specFile(capability)} needs a \`## Purpose\` section`));
		}
	}
	return issues;
}

/**
 * The draft as the ontology's `Change`, enough for `sizeIssues` to count: the
 * proposal's capabilities, one requirement per delta and its scenarios, no task
 * list. Not schema-valid (scenarios are counted, not read), so only for counting.
 */
export function asChange(proposal: ProposalCapabilities, deltas: readonly Delta[]): Change {
	const path = (capability: string) => capability.split("/");
	return {
		id: "draft",
		schema: "spec-driven",
		state: "drafting",
		proposal: {
			why: "",
			whatChanges: [],
			capabilities: { new: proposal.new.map(path), modified: proposal.modified.map(path) },
			outOfScope: [],
			impact: [],
		},
		deltas: deltas.map((delta): ModelDelta => {
			const capability = path(delta.spec);
			const { name, text, scenarios } = delta.requirement;
			switch (delta.operation) {
				case "ADDED":
				case "MODIFIED":
					return { op: delta.operation, capability, requirement: { name, text, scenarios: scenarios as Scenario[] } };
				case "REMOVED":
					return { op: "REMOVED", capability, name, reason: "", migration: "" };
				case "RENAMED":
					return { op: "RENAMED", capability, from: "", to: name };
			}
		}),
	};
}

/** False for a groups or tasks issue: task counts are the tasks stage's to check. */
export const notTasks = (issue: StageIssue): boolean => issue.path !== "tasks.md";

/** The size `WARNING`s for capabilities, requirements and scenarios. */
export function specsSizeIssues(proposal: ProposalCapabilities, deltas: readonly Delta[]): StageIssue[] {
	return sizeIssues(asChange(proposal, deltas)).filter(notTasks);
}
