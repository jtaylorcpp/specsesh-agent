/**
 * The task-script contract: the variables the loop seeds before an iteration
 * and the ones it reads back after. Everything else in a script is the
 * author's to tune.
 *
 * Checked on the parsed declarations before the dialect's lint, so a script
 * that dropped a declaration but still sets the variable is refused for the
 * contract, by name and type, not for an undeclared reference.
 */

import { analyze } from "../authoring/index.js";
import { readDeclarations } from "../interpreter/compose.js";
import { TaskLoopStartError } from "./errors.js";

export type ContractType = "string" | "number" | "boolean";

/** Seeded before each iteration. */
export const SEEDED: Readonly<Record<string, ContractType>> = {
	task_id: "string",
	task_text: "string",
	proposal: "string",
	design: "string",
	deltas: "string",
	iteration: "number",
	carried: "string",
};

/** Read back from the run's final variables. */
export const READ_BACK: Readonly<Record<string, ContractType>> = {
	met: "boolean",
	unmet: "string",
	next_action: "string",
	question: "string",
};

/** The `next_action` values the loop acts on. */
export const NEXT_ACTIONS = ["retry", "amend-spec", "ask"] as const;

/** One line per missing or mistyped contract variable; empty when the script keeps the contract. */
export function contractProblems(source: string): string[] {
	const declarations = readDeclarations(analyze(source).parsed);
	const problems: string[] = [];
	for (const [name, type] of Object.entries({ ...SEEDED, ...READ_BACK })) {
		const declared = declarations.get(name);
		if (declared === undefined) problems.push(`${name} is not declared; declare it as ${type}`);
		else if (declared.type !== type) problems.push(`${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	const action = declarations.get("next_action");
	if (action?.type === "string" && typeof action.initial === "string" && !(NEXT_ACTIONS as readonly string[]).includes(action.initial)) {
		problems.push(
			`@variables.next_action defaults to ${JSON.stringify(action.initial)}, which is not one of ${NEXT_ACTIONS.map((a) => JSON.stringify(a)).join(", ")}`,
		);
	}
	return problems;
}

/** Refuse a script that breaks the contract, naming every variable and its expected type. */
export function checkContract(source: string): void {
	const problems = contractProblems(source);
	if (problems.length > 0) {
		throw new TaskLoopStartError(
			`the script breaks the task-script contract, so the loop was not started:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
		);
	}
}
