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
 */
export function compose(
	statements: readonly unknown[],
	variables: Map<string, VariableValue>,
): Composition {
	const lines: string[] = [];
	const pending: PendingAssignment[] = [];

	const walk = (list: readonly unknown[]): void => {
		for (const statement of list) {
			const kind = kindOf(statement);
			const node = statement as Node;
			if (kind === "Template") {
				lines.push(renderTemplate(statement, variables));
			} else if (kind === "IfStatement") {
				const taken = truthy(evaluate(node["condition"], variables));
				const branch = taken ? node["body"] : node["orelse"];
				if (Array.isArray(branch)) walk(branch);
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
			}
		}
	};

	walk(statements);
	return { prompt: lines.join("\n"), pending };
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

function jsonType(declared: string | undefined): string {
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
