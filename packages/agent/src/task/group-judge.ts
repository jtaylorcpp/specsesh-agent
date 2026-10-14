/**
 * The group-judge script contract: the variables the group loop seeds before the judge
 * runs and the ones it reads back. Checked at start, on the parsed declarations, so a
 * script that drops one is refused by name and type before any loop or model request.
 */

import { analyze } from "../authoring/index.js";
import { readDeclarations } from "../interpreter/compose.js";
import type { VariableValue } from "../interpreter/index.js";
import type { Amendment } from "../openspec/index.js";
import type { ContractType } from "./contract.js";
import { TaskLoopStartError } from "./errors.js";
import type { CheckRun } from "./checks.js";
import { formatCheckOutput } from "./group.js";

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

/** The amendment variables: declared by every judge script, read back only on `amend-spec`. */
export const GROUP_AMEND: Readonly<Record<string, ContractType>> = {
	amend_path: "string",
	amend_text: "string",
};

/** The `next_action` values the group loop acts on. */
export const GROUP_NEXT_ACTIONS = ["rework", "ask", "amend-spec"] as const;

/** What the group loop knows when the judge runs. */
export interface GroupJudgeInput {
	readonly group: number;
	readonly title: string;
	/** Each task of the group with its last status, e.g. `converged`. */
	readonly tasks: readonly { id: string; text: string; status: string }[];
	readonly proposal: string;
	readonly deltas: string;
	/** Every check's result; only the failing ones are shown to the judge. */
	readonly checks: readonly CheckRun[];
	readonly reworks: number;
}

/** The judge's seeded variables, one per `GROUP_SEEDED` name. */
export type GroupJudgeSeed = Record<string, VariableValue>;

/** The seeded variables for the judge run. */
export function seedGroupJudge(input: GroupJudgeInput): GroupJudgeSeed {
	return {
		group_number: input.group,
		group_title: input.title,
		tasks: input.tasks.map((t) => `${t.id} ${t.text} — ${t.status}`).join("\n"),
		proposal: input.proposal,
		deltas: input.deltas,
		check_output: formatCheckOutput(input.checks),
		rework_count: input.reworks,
	};
}

/** What the judge said, not what the loop does about it. */
export type GroupVerdict =
	| { kind: "rework"; task: string; feedback: string }
	| { kind: "ask"; question: string }
	/** `amendment` when both variables are set, otherwise `amendmentNote` says which was empty. */
	| { kind: "amend-spec"; question: string; amendment?: Amendment; amendmentNote?: string }
	| { kind: "contract-broken"; reason: string };

/** Read the judge's four variables, and the amendment ones on `amend-spec`; an empty string reads as absent. */
export function readGroupVerdict(vars: Readonly<Record<string, VariableValue>>, groupTaskIds: readonly string[]): GroupVerdict {
	for (const name of Object.keys(GROUP_READ_BACK)) {
		const value = vars[name];
		if (typeof value !== "string") {
			return { kind: "contract-broken", reason: `${name} is ${JSON.stringify(value) ?? "unset"}, not a string` };
		}
	}
	const action = vars["next_action"] as string;
	if (action === "ask") return { kind: action, question: vars["question"] as string };
	if (action === "amend-spec") return { kind: action, question: vars["question"] as string, ...readAmendment(vars) };
	if (action === "rework") {
		const task = vars["rework_task"] as string;
		if (!groupTaskIds.includes(task)) {
			return { kind: "contract-broken", reason: `rework_task ${JSON.stringify(task)} is not a task of the group (${groupTaskIds.join(", ")})` };
		}
		return { kind: "rework", task, feedback: vars["feedback"] as string };
	}
	return {
		kind: "contract-broken",
		reason: `next_action is ${JSON.stringify(action)}, not one of ${GROUP_NEXT_ACTIONS.map((a) => JSON.stringify(a)).join(", ")}`,
	};
}

/**
 * The amendment, unchanged, or the note saying why it was dropped. The path is checked before
 * the text, so one note at most, worded as the task loop's (`judge.ts`).
 */
function readAmendment(vars: Readonly<Record<string, VariableValue>>): { amendment: Amendment } | { amendmentNote: string } {
	const path = typeof vars["amend_path"] === "string" ? vars["amend_path"] : "";
	const text = typeof vars["amend_text"] === "string" ? vars["amend_text"] : "";
	if (path === "") return { amendmentNote: "amendment dropped: amend_path is empty" };
	if (text.trim() === "") return { amendmentNote: "amendment dropped: amend_text is empty" };
	return { amendment: { delta: path, text } };
}

/** One line per missing or mistyped judge variable; empty when the script keeps the contract. */
export function groupContractProblems(source: string): string[] {
	const declarations = readDeclarations(analyze(source).parsed);
	const problems: string[] = [];
	for (const [name, type] of Object.entries({ ...GROUP_SEEDED, ...GROUP_READ_BACK, ...GROUP_AMEND })) {
		const declared = declarations.get(name);
		if (declared === undefined) problems.push(`${name} is not declared; declare it as ${type}`);
		else if (declared.type !== type) problems.push(`${name} is declared ${declared.type}; the contract needs ${type}`);
	}
	const action = declarations.get("next_action");
	if (action?.type === "string" && !(GROUP_NEXT_ACTIONS as readonly string[]).includes(action.initial as string)) {
		problems.push(
			`next_action defaults to ${JSON.stringify(action.initial)}; the default must be one of ${GROUP_NEXT_ACTIONS.map((a) => JSON.stringify(a)).join(", ")}`,
		);
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
