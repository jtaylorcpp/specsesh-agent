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

/**
 * Seeded only into a script that declares them; a script that does not keeps the contract.
 * Declared with another type, the script is refused.
 */
export const OPTIONAL_SEEDED: Readonly<Record<string, ContractType>> = {
	changed: "string",
	delete_granted: "boolean",
};

/** An optional seed whose refusal keeps the wording it had before the table. */
const OPTIONAL_MISTYPED: Readonly<Record<string, (declared: string) => string>> = {
	delete_granted: (declared) => `delete_granted is declared ${declared}; the loop seeds it as boolean`,
};

/** Read back from the run's final variables. */
export const READ_BACK: Readonly<Record<string, ContractType>> = {
	met: "boolean",
	unmet: "string",
	next_action: "string",
	question: "string",
	amend_path: "string",
	amend_text: "string",
};

/** The `next_action` values the loop acts on. */
export const NEXT_ACTIONS = ["retry", "amend-spec", "ask"] as const;

/**
 * The `amend_path` choices: `""`, then `specs/<capability>/spec.md` per delta, in the order of
 * `deltas`. Read from the `## <capability>` headings `concatDeltas` wrote (a capability has no
 * whitespace; OpenSpec's `## ADDED Requirements` does), so a resumed loop reads no file.
 */
export function amendPathChoices(deltas: string): string[] {
	const paths = [...deltas.matchAll(/^## (\S+)$/gm)].map((m) => `specs/${m[1]}/spec.md`);
	return ["", ...new Set(paths)];
}

/** The values each choice-limited variable may take, as every child run's `choices` carries them. */
export function contractChoices(deltas: string): Record<string, string[]> {
	return { next_action: [...NEXT_ACTIONS], amend_path: amendPathChoices(deltas) };
}

/**
 * One line per missing or mistyped contract variable, per optional seed declared with another
 * type, and per choice-limited default outside its values; empty when the script keeps the
 * contract. `deltas` is the loop's `deltas` seed.
 */
export function contractProblems(source: string, deltas = ""): string[] {
	const declarations = readDeclarations(analyze(source).parsed);
	const problems: string[] = [];
	for (const [name, type] of Object.entries({ ...SEEDED, ...READ_BACK })) {
		const declared = declarations.get(name);
		if (declared === undefined) problems.push(`${name} is not declared; declare it as ${type}`);
		else if (declared.type !== type) problems.push(`${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	for (const [name, type] of Object.entries(OPTIONAL_SEEDED)) {
		const declared = declarations.get(name);
		if (declared === undefined || declared.type === type) continue;
		problems.push(OPTIONAL_MISTYPED[name]?.(declared.type) ?? `${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	for (const [name, values] of Object.entries(contractChoices(deltas))) {
		const declared = declarations.get(name);
		if (declared?.type === "string" && typeof declared.initial === "string" && !values.includes(declared.initial)) {
			problems.push(
				`@variables.${name} defaults to ${JSON.stringify(declared.initial)}, which is not one of ${values.map((v) => JSON.stringify(v)).join(", ")}`,
			);
		}
	}
	return problems;
}

/** Refuse a script that breaks the contract, naming every variable and its expected type. */
export function checkContract(source: string, deltas = ""): void {
	const problems = contractProblems(source, deltas);
	if (problems.length > 0) {
		throw new TaskLoopStartError(
			`the script breaks the task-script contract, so the loop was not started:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
		);
	}
}
