/**
 * The group-judge script contract: the variables the group loop seeds before the judge
 * runs and the ones it reads back. Checked at start, on the parsed declarations, so a
 * script that drops one is refused by name and type before any loop or model request.
 */

import { analyze } from "../authoring/index.js";
import { readDeclarations } from "../interpreter/compose.js";
import type { ContractType } from "./contract.js";
import { TaskLoopStartError } from "./errors.js";

/** Seeded before the judge runs. */
export const GROUP_SEEDED: Readonly<Record<string, ContractType>> = {
	group_number: "number",
	group_title: "string",
	tasks: "string",
	proposal: "string",
	deltas: "string",
	check_output: "string",
	rework_count: "number",
};

/** Read back from the judge run's final variables. */
export const GROUP_READ_BACK: Readonly<Record<string, ContractType>> = {
	next_action: "string",
	rework_task: "string",
	feedback: "string",
	question: "string",
};

/** One line per missing or mistyped judge variable; empty when the script keeps the contract. */
export function groupContractProblems(source: string): string[] {
	const declarations = readDeclarations(analyze(source).parsed);
	const problems: string[] = [];
	for (const [name, type] of Object.entries({ ...GROUP_SEEDED, ...GROUP_READ_BACK })) {
		const declared = declarations.get(name);
		if (declared === undefined) problems.push(`${name} is not declared; declare it as ${type}`);
		else if (declared.type !== type) problems.push(`${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	return problems;
}

/** Refuse a group script that breaks the contract, naming every variable and its expected type. */
export function checkGroupContract(source: string): void {
	const problems = groupContractProblems(source);
	if (problems.length > 0) {
		throw new TaskLoopStartError(
			`the group script breaks the group-judge contract, so the loop was not started:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
		);
	}
}
