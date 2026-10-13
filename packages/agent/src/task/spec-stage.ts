/**
 * A spec stage: one artifact of an OpenSpec change (its proposal, design,
 * specs or tasks), the files it owns in the change directory, the script that
 * drafts them and the gate that checks them with no model.
 *
 * The stage contract is checked on the parsed declarations, as the task
 * script's is, so a script that dropped a declaration is refused by name and
 * type before anything starts.
 */

import { analyze } from "../authoring/index.js";
import { readDeclarations } from "../interpreter/compose.js";
import type { ValidationReport } from "../openspec/index.js";
import type { CheckRun } from "./checks.js";
import type { ContractType } from "./contract.js";
import type { Source } from "./options.js";

export type StageIssue = ValidationReport["issues"][number];

export interface StageContext {
	readonly changeId: string;
	/** Absolute: the repo root, where `openspec/` lives. */
	readonly workspace: string;
	/** Absolute: `<workspace>/openspec/changes/<id>`. */
	readonly changeDir: string;
	/** The stage's owned files, as now on disk, by path relative to the change directory. */
	readonly files: Readonly<Record<string, string>>;
	/** A command in the workspace, e.g. `openspec validate`. */
	run(argv: readonly string[]): Promise<CheckRun>;
}

export interface SpecStage {
	/** "proposal", "design", "specs", "tasks". */
	readonly name: string;
	/** Paths relative to the change directory; a trailing "/" owns every file under it. */
	readonly owns: readonly string[];
	readonly script: Source;
	readonly seed?: (context: StageContext) => { base?: string } | Promise<{ base?: string }>;
	gate(context: StageContext): Promise<StageIssue[]> | StageIssue[];
}

/** True when `path`, relative to the change directory, is one the stage may write. */
export function owns(stage: Pick<SpecStage, "owns">, path: string): boolean {
	const normal = path.replace(/\\/g, "/");
	if (normal === "" || normal.startsWith("/") || /^[A-Za-z]:/.test(normal)) return false;
	if (normal.split("/").includes("..")) return false;
	return stage.owns.some((entry) => (entry.endsWith("/") ? normal.startsWith(entry) && normal.length > entry.length : normal === entry));
}

/** Every variable a stage script declares: seeded before an iteration, or read back after it. */
export const SPEC_STAGE_CONTRACT: Readonly<Record<string, ContractType>> = {
	change_id: "string",
	stage: "string",
	intent: "string",
	approved: "string",
	current: "string",
	base: "string",
	carried: "string",
	iteration: "number",
	files: "string",
	summary: "string",
	next_action: "string",
	question: "string",
};

/** The `next_action` values the spec loop acts on. */
export const SPEC_NEXT_ACTIONS = ["review", "ask"] as const;

/** One line per missing or mistyped contract variable; empty when the stage script keeps the contract. */
export function stageContractProblems(source: string): string[] {
	const declarations = readDeclarations(analyze(source).parsed);
	const problems: string[] = [];
	for (const [name, type] of Object.entries(SPEC_STAGE_CONTRACT)) {
		const declared = declarations.get(name);
		if (declared === undefined) problems.push(`${name} is not declared; declare it as ${type}`);
		else if (declared.type !== type) problems.push(`${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	const action = declarations.get("next_action");
	if (action?.type === "string" && typeof action.initial === "string" && !(SPEC_NEXT_ACTIONS as readonly string[]).includes(action.initial)) {
		problems.push(
			`@variables.next_action defaults to ${JSON.stringify(action.initial)}, which is not one of ${SPEC_NEXT_ACTIONS.map((a) => JSON.stringify(a)).join(", ")}`,
		);
	}
	return problems;
}
