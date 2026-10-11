/**
 * Reading actions off the parse: the definitions a subagent's `actions:` block
 * holds, the clauses beneath a `run`, and the entries of `reasoning.actions`.
 *
 * Shared by the scan, which checks them, and by composition, which evaluates
 * them, so the two read the same tree the same way. Like `ast.ts`, these are
 * structural reads of the pinned dialect's shape and nothing more.
 */

import {
	type Node,
	type Range,
	childName,
	childRange,
	childValue,
	childrenOf,
	isNode,
	kindOf,
	nodeRange,
} from "./ast.js";
import { ACTION_TARGET_SCHEME } from "./subset.js";

/** One declared input or output: its name and its type as written. */
export interface ActionParameter {
	readonly name: string;
	/** The type's name (`string`, …), or undefined when it is not a bare name (`list[string]`). */
	readonly type: string | undefined;
	readonly declaration: unknown;
	readonly range: Range;
}

/** An action as its subagent defines it. */
export interface ActionDefinition {
	readonly name: string;
	readonly block: Node;
	readonly description: string;
	readonly inputs: readonly ActionParameter[];
	readonly outputs: readonly ActionParameter[];
	/** The target string as written, or undefined when absent or not a string. */
	readonly target: string | undefined;
	readonly range: Range;
}

/** A `with <param> = <value>` clause. `value` is an `Ellipsis` when the model fills it. */
export interface WithClause {
	readonly param: string;
	readonly value: unknown;
	readonly range: Range;
}

/** A `set @variables.<variable> = <value>` clause beneath a `run` or an entry. */
export interface ActionSet {
	readonly node: Node;
	readonly target: unknown;
	readonly value: unknown;
}

/** The clauses beneath a `run` or a reasoning-action entry, plus anything else found there. */
export interface ActionClauses {
	readonly withs: readonly WithClause[];
	readonly sets: readonly ActionSet[];
	/** Statements that are neither, for the scan to refuse. */
	readonly other: readonly unknown[];
}

/** One `reasoning.actions` entry: `<tool>: @actions.<name>` and its clauses. */
export interface ReasoningActionEntry extends ActionClauses {
	readonly tool: string;
	/** The entry's value, normally `@actions.<name>`. */
	readonly reference: unknown;
	readonly node: unknown;
	readonly range: Range;
}

/** Every action a subagent defines, in source order. */
export function readActionDefinitions(block: unknown): readonly ActionDefinition[] {
	if (!isNode(block)) return [];
	const definitions: ActionDefinition[] = [];
	for (const entry of childrenOf(block["actions"])) {
		const value = childValue(entry);
		if (!isNode(value)) continue;
		const target = value["target"];
		const description = value["description"];
		definitions.push({
			name: childName(entry),
			block: value,
			description: kindOf(description) === "StringLiteral" ? String((description as Node)["value"] ?? "") : "",
			inputs: readParameters(value["inputs"]),
			outputs: readParameters(value["outputs"]),
			target:
				kindOf(target) === "StringLiteral" && typeof (target as Node)["value"] === "string"
					? ((target as Node)["value"] as string)
					: undefined,
			range: childRange(entry),
		});
	}
	return definitions;
}

function readParameters(block: unknown): readonly ActionParameter[] {
	return childrenOf(block).map((entry) => {
		const declaration = childValue(entry);
		const type = isNode(declaration) ? declaration["type"] : undefined;
		const name = kindOf(type) === "Identifier" && isNode(type) ? type["name"] : undefined;
		return {
			name: childName(entry),
			type: typeof name === "string" ? name : undefined,
			declaration,
			range: childRange(entry),
		};
	});
}

/** The scheme and name of a target string, e.g. `mcpTool` and `run_checks`; undefined without `://`. */
export function parseTarget(target: string): { scheme: string; name: string } | undefined {
	const match = /^([^:/]+):\/\/(.*)$/.exec(target);
	return match === null ? undefined : { scheme: match[1] as string, name: match[2] as string };
}

/** The host tool an `mcpTool://<name>` target names, or undefined for any other target. */
export function toolName(definition: ActionDefinition): string | undefined {
	const parsed = definition.target === undefined ? undefined : parseTarget(definition.target);
	if (parsed === undefined || parsed.scheme !== ACTION_TARGET_SCHEME || parsed.name === "") return undefined;
	return parsed.name;
}

/** The action name an `@actions.<name>` expression references, or undefined. */
export function actionReference(expression: unknown): string | undefined {
	if (kindOf(expression) !== "MemberExpression") return undefined;
	const object = (expression as Node)["object"];
	if (kindOf(object) !== "AtIdentifier" || (object as Node)["name"] !== "actions") return undefined;
	const property = (expression as Node)["property"];
	return typeof property === "string" ? property : undefined;
}

/** Sort a list of clause statements into `with`s, `set`s and the rest. */
export function readClauses(statements: readonly unknown[]): ActionClauses {
	const withs: WithClause[] = [];
	const sets: ActionSet[] = [];
	const other: unknown[] = [];
	for (const statement of statements) {
		const kind = kindOf(statement);
		const node = statement as Node;
		if (kind === "WithClause" && typeof node["param"] === "string") {
			withs.push({ param: node["param"], value: node["value"], range: nodeRange(statement) });
		} else if (kind === "SetClause") {
			sets.push({ node, target: node["target"], value: node["value"] });
		} else {
			other.push(statement);
		}
	}
	return { withs, sets, other };
}

/** The clauses beneath a `run` statement. */
export function runClauses(run: unknown): ActionClauses {
	const body = isNode(run) ? run["body"] : undefined;
	return readClauses(Array.isArray(body) ? body : []);
}

/** The `reasoning.actions` entries of a subagent, in source order. */
export function readReasoningActions(block: unknown): readonly ReasoningActionEntry[] {
	if (!isNode(block)) return [];
	const reasoning = block["reasoning"];
	if (!isNode(reasoning)) return [];
	return childrenOf(reasoning["actions"]).map((entry) => {
		const node = childValue(entry);
		let reference: unknown;
		const statements: unknown[] = [];
		for (const child of childrenOf(node)) {
			if (child.__type === "value") reference = childValue(child);
			else statements.push(childValue(child));
		}
		return { tool: childName(entry), reference, node, range: childRange(entry), ...readClauses(statements) };
	});
}

/** True when a `reasoning.actions` block is present at all, even an empty one. */
export function hasReasoningActions(block: unknown): boolean {
	if (!isNode(block)) return false;
	const reasoning = block["reasoning"];
	return isNode(reasoning) && reasoning["actions"] !== undefined;
}
