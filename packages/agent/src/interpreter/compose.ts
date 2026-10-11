/**
 * Prompt composition and deterministic logic.
 *
 * Two kinds of line, two different meanings, and the difference is the point of
 * the language. A prompt line (`| …`) becomes text the model is asked to act on.
 * A logic line (`if …`, `set …`) is decided by the PROGRAM — evaluated here, on
 * every turn, with no model call on any path. Routing a logic line through the
 * model would give the model a vote on the gate it was supposed to be held to,
 * which is the same as not having the gate.
 *
 * Nothing in this file takes a port, and that is deliberate rather than
 * incidental: a function that cannot reach the boundary cannot accidentally
 * consult it.
 *
 * The one thing composition CANNOT settle is `set @variables.x = @output.y`. The
 * field does not exist until the step it belongs to has run, so those
 * assignments are collected as pending and applied afterwards, from the
 * structured result and from nothing else.
 */

import {
	type Node,
	type Range,
	childName,
	childValue,
	childrenOf,
	documentRoot,
	formatPosition,
	isNode,
	kindOf,
	nodeRange,
} from "./ast.js";
import {
	type ActionClauses,
	type ActionDefinition,
	actionReference,
	readActionDefinitions,
	readReasoningActions,
	runClauses,
	toolName,
} from "./actions.js";
import { STRUCTURED_RESULT_NAMESPACE } from "./subset.js";

/** The value types this runtime's variables hold. */
export type VariableValue = string | number | boolean;

/** A variable as the document declares it. */
export interface DeclaredVariable {
	readonly name: string;
	/** The declared type, in the language's own spelling (`string`, `number`, …). */
	readonly type: string;
	/** The authored value. This IS the run's starting value. */
	readonly initial: VariableValue;
	/** Where the authored value sits, so persistence can rewrite exactly it. */
	readonly valueRange: Range;
}

/** A `set` waiting on the step's structured result. */
export interface PendingAssignment {
	readonly variable: string;
	/** The field of the structured result to take, as written after `@output.`. */
	readonly field: string;
}

/** What one reasoning step's composition produced. */
export interface Composition {
	/** The prompt lines that survived their conditions, in source order. */
	readonly prompt: string;
	/** Assignments the structured result must supply, in source order. */
	readonly pending: readonly PendingAssignment[];
	/**
	 * The first `run` the walk reached, if any: the walk stops there, and its
	 * `index` (the statement's pre-order position in the procedure) is where the
	 * next walk resumes after the call's result is applied.
	 */
	readonly run?: { readonly index: number; readonly node: Node };
}

/** Raised when an instruction names a variable the document never declared. */
export class UndeclaredVariableError extends Error {
	readonly variable: string;
	readonly range: Range;

	constructor(variable: string, range: Range) {
		super(
			`the document references @variables.${variable} at ${formatPosition(range)}, but declares ` +
				"no such variable. It is not resolved to an empty value: a stage gate read from a " +
				"variable nobody declared would wave through exactly what it exists to refuse.",
		);
		this.name = "UndeclaredVariableError";
		this.variable = variable;
		this.range = range;
	}
}

/**
 * Raised when a declaration's default is one the scan admitted and this reader
 * cannot read.
 *
 * Unreachable while `SUPPORTED_DEFAULT_VALUE_KINDS` and `readLiteral` name the
 * same set — which is exactly why it is a throw and not a `continue`. Skipping
 * silently is what turned "the scan says this document is fine" into "the run
 * says you never declared `b`", and an `if (…) continue` on a path the scan has
 * already cleared generates that bug by construction.
 */
export class UnreadableDefaultError extends Error {
	constructor(name: string, kind: string | undefined) {
		super(
			`@variables.${name} has a default of kind ${kind ?? "(unparsed)"}, which the subset scan ` +
				"admitted and this reader cannot read. The two must name the same set of literal " +
				"kinds — see SUPPORTED_DEFAULT_VALUE_KINDS.",
		);
		this.name = "UnreadableDefaultError";
	}
}

/**
 * The variables the document declares, in source order.
 *
 * The authored value is the initial value, with no separate seeding step —
 * that is what makes the document the author edited and the prompt that runs one
 * object rather than two kept in step.
 *
 * Call this AFTER `scanDocument` has passed: it treats an unreadable default as
 * a contradiction between the two rather than as a variable to skip.
 */
export function readDeclarations(parsed: unknown): Map<string, DeclaredVariable> {
	const declarations = new Map<string, DeclaredVariable>();
	const root = documentRoot(parsed);
	if (root === undefined) return declarations;
	for (const entry of childrenOf(root["variables"])) {
		const name = childName(entry);
		const declaration = childValue(entry);
		if (!isNode(declaration)) continue;
		const value = declaration["defaultValue"];
		const literal = readLiteral(value);
		if (literal === undefined) throw new UnreadableDefaultError(name, kindOf(value));
		declarations.set(name, {
			name,
			type: identifierName(declaration["type"]) ?? "string",
			initial: literal,
			valueRange: nodeRange(value),
		});
	}
	return declarations;
}

/** The document's standing instructions, as their own channel. Never the prompt. */
export function readSystemInstructions(parsed: unknown): string {
	const root = documentRoot(parsed);
	if (root === undefined) return "";
	const system = root["system"];
	if (!isNode(system)) return "";
	return renderTemplate(system["instructions"], undefined);
}

/** Every subagent the document declares, in source order. */
export function readSubagents(parsed: unknown): Map<string, Node> {
	const subagents = new Map<string, Node>();
	const root = documentRoot(parsed);
	if (root === undefined) return subagents;
	for (const entry of childrenOf(root["subagent"])) {
		const block = childValue(entry);
		if (isNode(block)) subagents.set(childName(entry), block);
	}
	return subagents;
}

/**
 * Every `@variables.x` the document mentions that it does not declare.
 *
 * Collected across the WHOLE document rather than as each reference is reached,
 * for the same reason the subset scan is up front: a bad reference on a branch
 * nobody takes is still a bad reference, and finding it mid-run means finding it
 * after some of the state has already moved.
 */
export function collectUndeclaredReferences(
	parsed: unknown,
	declared: ReadonlySet<string>,
): readonly UndeclaredVariableError[] {
	const problems: UndeclaredVariableError[] = [];
	const note = (name: string, range: Range) => {
		if (!declared.has(name)) problems.push(new UndeclaredVariableError(name, range));
	};

	const walkExpression = (expression: unknown): void => {
		if (!isNode(expression)) return;
		const kind = kindOf(expression);
		if (kind === "MemberExpression") {
			const object = expression["object"];
			const namespace = isNode(object) ? object["name"] : undefined;
			const property = expression["property"];
			if (namespace === "variables" && typeof property === "string") {
				note(property, nodeRange(expression));
			}
			return;
		}
		walkExpression(expression["left"]);
		walkExpression(expression["right"]);
		walkExpression(expression["operand"]);
	};

	const walkStatements = (statements: unknown): void => {
		if (!Array.isArray(statements)) return;
		for (const statement of statements) {
			const kind = kindOf(statement);
			const node = statement as Node;
			if (kind === "Template") {
				// Each reference points at ITSELF, not at the line holding it: a
				// prompt line with two references and one bad name should say which.
				for (const { name, range } of interpolations(node)) note(name, range);
			} else if (kind === "IfStatement") {
				walkExpression(node["condition"]);
				walkStatements(node["body"]);
				walkStatements(node["orelse"]);
			} else if (kind === "SetClause") {
				const target = node["target"];
				const property = isNode(target) ? target["property"] : undefined;
				if (typeof property === "string") note(property, nodeRange(target));
				walkExpression(node["value"]);
			}
		}
	};

	for (const block of readSubagents(parsed).values()) {
		walkStatements(procedureStatements(block));
	}
	return problems;
}

/** The statements of a subagent's `reasoning.instructions`, or none. */
export function procedureStatements(block: Node): readonly unknown[] {
	const reasoning = block["reasoning"];
	if (!isNode(reasoning)) return [];
	const procedure = reasoning["instructions"];
	if (!isNode(procedure)) return [];
	const statements = procedure["statements"];
	return Array.isArray(statements) ? statements : [];
}

/**
 * Compose one step: prompt text out, deterministic assignments applied in place.
 *
 * `variables` is mutated as `set` lines are reached, so a later line reads what
 * an earlier one wrote — which is what `set` means in a language whose
 * instructions run top to bottom.
 *
 * A reached `run` stops the walk: the program calls the action there, and the
 * statements after it must read its outputs. `resumeAfter` continues a walk
 * that stopped at the `run` with that pre-order position: every statement up to
 * it has already run, and an `if` holding it is re-entered on the branch the
 * walk took then, without evaluating its condition again.
 */
export function compose(
	statements: readonly unknown[],
	variables: Map<string, VariableValue>,
	resumeAfter?: number,
): Composition {
	const lines: string[] = [];
	const pending: PendingAssignment[] = [];
	let position = -1;
	let reached: { index: number; node: Node } | undefined;

	/** Returns true when the walk stopped at a `run`. */
	const walk = (list: readonly unknown[]): boolean => {
		for (const statement of list) {
			position += 1;
			const index = position;
			const kind = kindOf(statement);
			const node = statement as Node;
			const done = resumeAfter !== undefined && index <= resumeAfter;
			if (kind === "IfStatement") {
				const body = Array.isArray(node["body"]) ? node["body"] : [];
				const orelse = Array.isArray(node["orelse"]) ? node["orelse"] : [];
				if (done) {
					// Already decided on the walk that reached the resume point. Only the
					// branch holding that point still has statements left to run.
					const bodyEnd = index + countStatements(body);
					const end = bodyEnd + countStatements(orelse);
					if (resumeAfter > end) {
						position = end;
						continue;
					}
					if (resumeAfter <= bodyEnd) {
						if (walk(body)) return true;
						position = end;
					} else {
						position = bodyEnd;
						if (walk(orelse)) return true;
					}
					continue;
				}
				const taken = truthy(evaluate(node["condition"], variables));
				if (taken) {
					if (walk(body)) return true;
					position += countStatements(orelse);
				} else {
					position += countStatements(body);
					if (walk(orelse)) return true;
				}
				continue;
			}
			if (done) continue;
			if (kind === "Template") {
				lines.push(renderTemplate(statement, variables));
			} else if (kind === "SetClause") {
				const target = node["target"];
				const name = isNode(target) ? target["property"] : undefined;
				if (typeof name !== "string") continue;
				const value = node["value"];
				if (namespaceOf(value) === STRUCTURED_RESULT_NAMESPACE) {
					const field = isNode(value) ? value["property"] : undefined;
					if (typeof field === "string") pending.push({ variable: name, field });
					continue;
				}
				requireDeclared(name, variables, nodeRange(target));
				variables.set(name, evaluate(value, variables));
			} else if (kind === "RunStatement") {
				reached = { index, node };
				return true;
			}
		}
		return false;
	};

	walk(statements);
	return { prompt: lines.join("\n"), pending, ...(reached !== undefined ? { run: reached } : {}) };
}

/** How many statements a list holds, counting those nested inside `if`s, in pre-order. */
function countStatements(list: readonly unknown[]): number {
	let count = 0;
	for (const statement of list) {
		count += 1;
		if (kindOf(statement) === "IfStatement") {
			const node = statement as Node;
			count += countStatements(Array.isArray(node["body"]) ? node["body"] : []);
			count += countStatements(Array.isArray(node["orelse"]) ? node["orelse"] : []);
		}
	}
	return count;
}

/** The statement at a pre-order position, or undefined. */
export function statementAt(statements: readonly unknown[], index: number): Node | undefined {
	let position = -1;
	const find = (list: readonly unknown[]): Node | undefined => {
		for (const statement of list) {
			position += 1;
			if (position === index) return isNode(statement) ? statement : undefined;
			if (kindOf(statement) === "IfStatement") {
				const node = statement as Node;
				const found =
					find(Array.isArray(node["body"]) ? node["body"] : []) ??
					find(Array.isArray(node["orelse"]) ? node["orelse"] : []);
				if (found !== undefined) return found;
			}
		}
		return undefined;
	};
	return find(statements);
}

/** A `with` input whose value has the wrong type for its declaration. */
export interface InputTypeProblem {
	readonly input: string;
	readonly declared: string;
	readonly actual: string;
}

/**
 * Evaluate a `run`'s inputs against the variables as they are now, checking each
 * against its declared type. Values are never coerced: a string given to a
 * `number` input is a problem, not a number.
 */
export function evaluateRunInputs(
	run: Node,
	definition: ActionDefinition,
	variables: ReadonlyMap<string, VariableValue>,
): { inputs: Record<string, VariableValue>; problem?: InputTypeProblem } {
	const inputs: Record<string, VariableValue> = {};
	let problem: InputTypeProblem | undefined;
	for (const clause of runClauses(run).withs) {
		const value = evaluate(clause.value, variables);
		inputs[clause.param] = value;
		const declared = definition.inputs.find((input) => input.name === clause.param)?.type;
		if (problem === undefined && declared !== undefined && typeof value !== declared) {
			problem = { input: clause.param, declared, actual: typeof value };
		}
	}
	return problem === undefined ? { inputs } : { inputs, problem };
}

/** A `set … = @outputs.<field>` beneath a `run` or an entry. */
export interface OutputAssignment {
	readonly variable: string;
	readonly field: string;
}

/** The output assignments beneath a `run` or an entry, in source order. */
export function outputAssignments(clauses: ActionClauses): readonly OutputAssignment[] {
	const assignments: OutputAssignment[] = [];
	for (const set of clauses.sets) {
		const variable = isNode(set.target) ? set.target["property"] : undefined;
		const field = isNode(set.value) ? set.value["property"] : undefined;
		if (typeof variable === "string" && typeof field === "string") assignments.push({ variable, field });
	}
	return assignments;
}

/** A tool offered to the model for one reasoning-action entry. Declarations only. */
export interface ToolOffer {
	/** The entry's key: the name the model calls. */
	readonly name: string;
	readonly description: string;
	/** JSON Schema of the inputs the model fills: each typed as declared, all required. */
	readonly inputSchema: Record<string, unknown>;
	/** The host tool the action's `mcpTool://` target names. */
	readonly action: string;
	/** Inputs bound by an expression, evaluated when the step was composed. */
	readonly bound: Readonly<Record<string, VariableValue>>;
}

/** A reasoning-action `set`, waiting on the last call to its tool. */
export interface ToolAssignment extends OutputAssignment {
	readonly tool: string;
}

/**
 * The tool offers of a subagent's `reasoning.actions`, in source order, and the
 * `set`s waiting on their calls. Bound inputs read `variables` as composition
 * left them.
 */
export function composeToolOffers(
	block: Node,
	variables: ReadonlyMap<string, VariableValue>,
): { offers: readonly ToolOffer[]; assignments: readonly ToolAssignment[] } {
	const definitions = new Map(readActionDefinitions(block).map((d) => [d.name, d]));
	const offers: ToolOffer[] = [];
	const assignments: ToolAssignment[] = [];
	for (const entry of readReasoningActions(block)) {
		const name = actionReference(entry.reference);
		const definition = name === undefined ? undefined : definitions.get(name);
		if (definition === undefined) continue;
		const properties: Record<string, unknown> = {};
		const required: string[] = [];
		const bound: Record<string, VariableValue> = {};
		for (const clause of entry.withs) {
			if (kindOf(clause.value) === "Ellipsis") {
				const declared = definition.inputs.find((input) => input.name === clause.param)?.type;
				properties[clause.param] = { type: jsonType(declared) };
				required.push(clause.param);
			} else {
				bound[clause.param] = evaluate(clause.value, variables);
			}
		}
		offers.push({
			name: entry.tool,
			description: definition.description,
			inputSchema: { type: "object", properties, required, additionalProperties: false },
			action: toolName(definition) ?? definition.name,
			bound,
		});
		for (const assignment of outputAssignments(entry)) assignments.push({ ...assignment, tool: entry.tool });
	}
	return { offers, assignments };
}

/**
 * The JSON schema for a step's structured result, derived from the assignments
 * the step is waiting on and the declared type of each variable they write.
 *
 * Derived rather than authored: the document already says what it wants back, in
 * the `set` lines themselves, and a second place to say it is a second place to
 * say it differently.
 */
export function outputSchemaFor(
	pending: readonly PendingAssignment[],
	declarations: ReadonlyMap<string, DeclaredVariable>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	for (const assignment of pending) {
		const declared = declarations.get(assignment.variable);
		properties[assignment.field] = { type: jsonType(declared?.type) };
	}
	return {
		type: "object",
		properties,
		required: [...new Set(pending.map((p) => p.field))],
		additionalProperties: false,
	};
}

export function jsonType(declared: string | undefined): string {
	if (declared === "number" || declared === "integer") return "number";
	if (declared === "boolean") return "boolean";
	return "string";
}

/**
 * Evaluate a logic expression. Deterministic on every path — there is no branch
 * of this function that can reach a model, because it takes nothing that could.
 */
export function evaluate(
	expression: unknown,
	variables: ReadonlyMap<string, VariableValue>,
): VariableValue {
	if (!isNode(expression)) return "";
	switch (kindOf(expression)) {
		case "StringLiteral":
			return String(expression["value"] ?? "");
		case "NumberLiteral":
			return Number(expression["value"] ?? 0);
		case "BooleanLiteral":
			// `True` / `False`, as the dialect spells and parses them.
			return expression["value"] === true;
		case "MemberExpression": {
			const property = expression["property"];
			if (typeof property !== "string") return "";
			return requireDeclared(property, variables, nodeRange(expression));
		}
		case "UnaryExpression":
			return !truthy(evaluate(expression["operand"], variables));
		case "BinaryExpression": {
			const left = truthy(evaluate(expression["left"], variables));
			if (expression["operator"] === "and") {
				// Both sides are evaluated regardless, so an undeclared variable on
				// the right is refused even when the left already decided the answer.
				const right = truthy(evaluate(expression["right"], variables));
				return left && right;
			}
			return left || truthy(evaluate(expression["right"], variables));
		}
		case "ComparisonExpression": {
			const left = evaluate(expression["left"], variables);
			const right = evaluate(expression["right"], variables);
			return compare(String(expression["operator"]), left, right);
		}
		default:
			return "";
	}
}

function compare(operator: string, left: VariableValue, right: VariableValue): boolean {
	switch (operator) {
		case "==":
			return left === right;
		case "!=":
			return left !== right;
		case "<":
			return left < right;
		case "<=":
			return left <= right;
		case ">":
			return left > right;
		case ">=":
			return left >= right;
		default:
			return false;
	}
}

/** Agent Script's truthiness, stated once rather than left to JavaScript's. */
export function truthy(value: VariableValue): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	return value.length > 0;
}

function requireDeclared(
	name: string,
	variables: ReadonlyMap<string, VariableValue>,
	range: Range,
): VariableValue {
	const value = variables.get(name);
	if (value === undefined) throw new UndeclaredVariableError(name, range);
	return value;
}

/**
 * Render a template node's text, substituting `{!@variables.x}` where a
 * variable table is supplied.
 *
 * Read off the PARSE, part by part: the dialect splits `{!@variables.x}` into
 * its own `TemplateInterpolation` carrying the member expression, and it is the
 * only thing that knows the difference between an interpolation and a brace the
 * author typed. A regex over the joined text cannot — it substituted anything
 * brace-shaped, and it matched the wrong spelling anyway (`{@variables.x}`, the
 * form the dialect reports as an error).
 *
 * With no variable table (system instructions, which are their own channel and
 * are not composed against run state) an interpolation renders back as the
 * source form rather than as an empty string: a standing instruction with a
 * hole in it is the silent skip this package exists to refuse.
 */
export function renderTemplate(
	template: unknown,
	variables: ReadonlyMap<string, VariableValue> | undefined,
): string {
	if (!isNode(template)) return "";
	const parts = template["parts"];
	if (!Array.isArray(parts)) return "";
	return parts
		.map((part) => {
			if (!isNode(part)) return "";
			if (kindOf(part) !== "TemplateInterpolation") return String(part["value"] ?? "");
			const name = interpolatedName(part);
			if (name === undefined) return "";
			if (variables === undefined) return `{!@variables.${name}}`;
			return String(requireDeclared(name, variables, nodeRange(part)));
		})
		.join("");
}

/** The `@variables.x` names a prompt line interpolates, with each one's range. */
function interpolations(template: Node): readonly { name: string; range: Range }[] {
	const parts = template["parts"];
	if (!Array.isArray(parts)) return [];
	const found: { name: string; range: Range }[] = [];
	for (const part of parts) {
		if (!isNode(part) || kindOf(part) !== "TemplateInterpolation") continue;
		const name = interpolatedName(part);
		if (name !== undefined) found.push({ name, range: nodeRange(part) });
	}
	return found;
}

/** The variable an interpolation reads, or undefined when it reads something else. */
function interpolatedName(part: Node): string | undefined {
	const expression = part["expression"];
	if (!isNode(expression) || kindOf(expression) !== "MemberExpression") return undefined;
	if (namespaceOf(expression) !== "variables") return undefined;
	const property = expression["property"];
	return typeof property === "string" ? property : undefined;
}

function namespaceOf(expression: unknown): string | undefined {
	if (!isNode(expression) || kindOf(expression) !== "MemberExpression") return undefined;
	const object = expression["object"];
	if (!isNode(object)) return undefined;
	const name = object["name"];
	return typeof name === "string" ? name : undefined;
}

function identifierName(node: unknown): string | undefined {
	if (!isNode(node)) return undefined;
	const name = node["name"];
	return typeof name === "string" ? name : undefined;
}

/**
 * A literal value, or undefined when the node is not one.
 *
 * The kinds here and `SUPPORTED_DEFAULT_VALUE_KINDS` are one set said twice, in
 * two vocabularies (a reader and a scan). `__tests__/subset-single-source.test.ts`
 * asserts they agree, so the pair cannot drift into the gap F4 lived in.
 */
function readLiteral(node: unknown): VariableValue | undefined {
	if (!isNode(node)) return undefined;
	switch (kindOf(node)) {
		case "StringLiteral":
			return String(node["value"] ?? "");
		case "NumberLiteral":
			return Number(node["value"] ?? 0);
		case "BooleanLiteral":
			return node["value"] === true;
		default:
			return undefined;
	}
}
