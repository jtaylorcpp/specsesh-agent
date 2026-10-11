/**
 * The pre-execution subset scan.
 *
 * Walks the WHOLE document against `subset.ts` before anything is dispatched. Up
 * front rather than on reach, deliberately: an unsupported block sitting on a
 * branch a run rarely takes would otherwise look like it worked for weeks and
 * then refuse mid-run, at which point half the state has already moved.
 *
 * Every refusal says the construct is unsupported by THIS RUNTIME. The
 * distinction is not politeness — the document is very likely valid Agent Script
 * that Salesforce's runtime would execute happily. What is true is that we do
 * not implement it, and a message claiming the author's script is invalid sends
 * them to fix a document that has nothing wrong with it.
 *
 * The walk reads a block's authored CHILDREN rather than its convenience
 * properties, so a field the schema files somewhere unexpected is still seen.
 * Nothing here short-circuits: every unsupported construct in the document is
 * reported, because a caller fixing them one refusal at a time is a caller
 * running the parser as a linter.
 */

import {
	type Child,
	type Node,
	type Range,
	childName,
	childRange,
	childValue,
	childrenOf,
	documentRoot,
	formatPosition,
	isNode,
	isUnreportedRange,
	kindOf,
	nodeRange,
} from "./ast.js";
import {
	ASSIGNABLE_NAMESPACES,
	READABLE_NAMESPACES,
	SUPPORTED_BINARY_OPERATORS,
	SUPPORTED_BLOCK_FIELDS,
	SUPPORTED_COMPARISON_OPERATORS,
	SUPPORTED_DEFAULT_VALUE_KINDS,
	SUPPORTED_EXPRESSION_KINDS,
	SUPPORTED_STATEMENT_KINDS,
	SUPPORTED_UNARY_OPERATORS,
	STRUCTURED_RESULT_NAMESPACE,
	renderSubsetInline,
} from "./subset.js";

/** One construct the document uses and this runtime does not implement. */
export interface UnsupportedConstruct {
	/** What was written, in the author's own vocabulary where there is one. */
	readonly construct: string;
	/** Where it sits, so a caller can point at it rather than at the file. */
	readonly range: Range;
	/** Which enclosing block it was found in, for a document with many. */
	readonly where: string;
	/** The full sentence, already worded as a runtime limit. */
	readonly message: string;
}

/**
 * Raised instead of running. Carries every finding, not the first — see the file
 * header on why one-at-a-time refusals are a worse product.
 */
export class UnsupportedConstructError extends Error {
	readonly constructs: readonly UnsupportedConstruct[];

	constructor(constructs: readonly UnsupportedConstruct[]) {
		super(
			`this runtime does not implement ${constructs.length} construct(s) used by the document:\n` +
				constructs.map((c) => `  - ${c.message}`).join("\n"),
		);
		this.name = "UnsupportedConstructError";
		this.constructs = constructs;
	}
}

/**
 * Scan a parsed document. An empty result means every construct in it is one
 * this runtime implements — it does NOT mean the document is well-formed, which
 * is the authoring surface's diagnostics to answer.
 */
export function scanDocument(parsed: unknown): readonly UnsupportedConstruct[] {
	const found: UnsupportedConstruct[] = [];
	// Accepts either the dialect's `{ value, diagnostics }` or the root itself, so
	// handing it the wrong one cannot come back as "nothing unsupported here".
	const root = documentRoot(parsed);
	if (root === undefined) return found;

	const allowed = SUPPORTED_BLOCK_FIELDS["Document"] ?? [];
	const seen = new Set<string>();
	for (const child of childrenOf(root)) {
		const key = childName(child);
		if (!allowed.includes(key)) {
			found.push(report(key, childRange(child), "the document"));
			continue;
		}
		// A collection files one root child per entry, so the same key arrives
		// repeatedly; the typed property beneath it holds all of them at once.
		if (seen.has(key)) continue;
		seen.add(key);
		scanTopLevel(key, root[key], found);
	}
	return found;
}

function scanTopLevel(key: string, value: unknown, found: UnsupportedConstruct[]): void {
	switch (key) {
		case "config":
			scanBlockFields(value, "ConfigBlock", "config", found);
			return;
		case "system":
			scanBlockFields(value, "SystemBlock", "system", found);
			return;
		case "variables":
			scanVariables(value, found);
			return;
		case "subagent":
			scanSubagents(value, found);
			return;
		default:
			// Unreachable while `Document`'s field list and this switch agree; a
			// refusal rather than a fall-through is what makes them stay agreed.
			found.push(report(key, nodeRange(value), "the document"));
	}
}

/** Check a block's authored fields against the one declaration of what it may carry. */
function scanBlockFields(
	value: unknown,
	blockKind: string,
	where: string,
	found: UnsupportedConstruct[],
): readonly Child[] {
	const allowed = SUPPORTED_BLOCK_FIELDS[blockKind] ?? [];
	const kept: Child[] = [];
	for (const child of childrenOf(value)) {
		const key = childName(child);
		if (!allowed.includes(key)) {
			found.push(report(key, childRange(child), where));
			continue;
		}
		kept.push(child);
	}
	return kept;
}

function scanVariables(value: unknown, found: UnsupportedConstruct[]): void {
	for (const entry of childrenOf(value)) {
		const name = childName(entry);
		const declaration = childValue(entry);
		const kind = kindOf(declaration);
		if (kind !== "VariableDeclaration" && kind !== "ParameterDeclaration") {
			found.push(report(kind ?? name, nodeRange(declaration), `variable "${name}"`));
			continue;
		}
		scanBlockFields(declaration, kind, `variable "${name}"`, found);
		if (isNode(declaration)) {
			const properties = declaration["properties"];
			if (properties !== undefined) {
				scanBlockFields(properties, "VariablePropertiesBlock", `variable "${name}"`, found);
			}
			// A declaration with no default has nothing to seed the run's state
			// with, and inventing one is the empty value this capability refuses.
			const initial = declaration["defaultValue"];
			if (initial === undefined) {
				found.push(
					report(
						`${name} (a variable with no declared value)`,
						nodeRange(declaration),
						`variable "${name}"`,
					),
				);
			} else {
				scanDefaultValue(initial, `variable "${name}"`, found);
			}
		}
	}
}

function scanSubagents(value: unknown, found: UnsupportedConstruct[]): void {
	for (const entry of childrenOf(value)) {
		const name = childName(entry);
		const block = childValue(entry);
		const where = `subagent "${name}"`;
		if (kindOf(block) !== "SubagentBlock") {
			found.push(report(kindOf(block) ?? name, nodeRange(block), where));
			continue;
		}
		for (const field of scanBlockFields(block, "SubagentBlock", where, found)) {
			if (childName(field) !== "reasoning") continue;
			const reasoning = childValue(field);
			for (const inner of scanBlockFields(reasoning, "ReasoningBlock", where, found)) {
				scanProcedure(childValue(inner), where, found);
			}
		}
	}
}

function scanProcedure(procedure: unknown, where: string, found: UnsupportedConstruct[]): void {
	if (kindOf(procedure) !== "ProcedureValue") {
		found.push(report(kindOf(procedure) ?? "instructions", nodeRange(procedure), where));
		return;
	}
	scanStatements((procedure as Node)["statements"], where, found);
}

function scanStatements(statements: unknown, where: string, found: UnsupportedConstruct[]): void {
	if (!Array.isArray(statements)) return;
	for (const statement of statements) {
		const kind = kindOf(statement);
		if (kind === undefined || !SUPPORTED_STATEMENT_KINDS.includes(kind)) {
			found.push(report(kind ?? "an unparsed instruction", nodeRange(statement), where));
			continue;
		}
		const node = statement as Node;
		if (kind === "Template") {
			scanTemplateParts(node["parts"], where, found);
		} else if (kind === "IfStatement") {
			scanValueExpression(node["condition"], where, found);
			scanStatements(node["body"], where, found);
			scanStatements(node["orelse"], where, found);
		} else if (kind === "SetClause") {
			scanAssignmentTarget(node["target"], where, found);
			// The one position `@output` is legal in — see STRUCTURED_RESULT_NAMESPACE.
			if (namespaceOf(node["value"]) !== STRUCTURED_RESULT_NAMESPACE) {
				scanValueExpression(node["value"], where, found);
			}
		}
	}
}

function scanTemplateParts(parts: unknown, where: string, found: UnsupportedConstruct[]): void {
	if (!Array.isArray(parts)) return;
	for (const part of parts) {
		const kind = kindOf(part);
		// Literal text, and `{!@variables.x}` references. The dialect splits the
		// latter into its own part carrying a member expression, which is scanned
		// like any other read — so `{!@context.x}` is refused by name here rather
		// than composed into a prompt with nothing behind it. Any OTHER part is a
		// template feature we would render without knowing what it means.
		if (kind === "TemplateText") continue;
		if (kind === "TemplateInterpolation") {
			scanValueExpression((part as Node)["expression"], where, found);
			continue;
		}
		found.push(report(kind ?? "a template part", nodeRange(part), where));
	}
}

/**
 * A variable's default. Literals only — see `SUPPORTED_DEFAULT_VALUE_KINDS`.
 *
 * The scan and `readDeclarations` must admit exactly the same set. When they
 * disagree the scan passes a declaration the reader then drops, and the run
 * goes on to accuse the document of never declaring it.
 */
function scanDefaultValue(
	expression: unknown,
	where: string,
	found: UnsupportedConstruct[],
): void {
	const kind = kindOf(expression);
	if (kind !== undefined && SUPPORTED_DEFAULT_VALUE_KINDS.includes(kind)) return;
	found.push(
		report(
			`${describeExpression(expression)} as a variable's default`,
			nodeRange(expression),
			where,
		),
	);
}

function scanAssignmentTarget(target: unknown, where: string, found: UnsupportedConstruct[]): void {
	const namespace = namespaceOf(target);
	if (namespace === undefined || !ASSIGNABLE_NAMESPACES.includes(namespace)) {
		found.push(
			report(
				namespace === undefined ? (kindOf(target) ?? "an assignment target") : `set @${namespace}`,
				nodeRange(target),
				where,
			),
		);
	}
}

/** The `@namespace` a member expression reads, or undefined if it is not one. */
function namespaceOf(expression: unknown): string | undefined {
	if (kindOf(expression) !== "MemberExpression") return undefined;
	const object = (expression as Node)["object"];
	if (kindOf(object) !== "AtIdentifier") return undefined;
	const name = (object as Node)["name"];
	return typeof name === "string" ? name : undefined;
}

function scanValueExpression(
	expression: unknown,
	where: string,
	found: UnsupportedConstruct[],
): void {
	const kind = kindOf(expression);
	if (kind === undefined || !SUPPORTED_EXPRESSION_KINDS.includes(kind)) {
		found.push(report(describeExpression(expression), nodeRange(expression), where));
		return;
	}
	const node = expression as Node;
	switch (kind) {
		case "MemberExpression": {
			const namespace = namespaceOf(expression);
			if (namespace === undefined || !READABLE_NAMESPACES.includes(namespace)) {
				found.push(
					report(namespace === undefined ? kind : `@${namespace}`, nodeRange(expression), where),
				);
			}
			return;
		}
		case "ComparisonExpression":
			checkOperator(node["operator"], SUPPORTED_COMPARISON_OPERATORS, expression, where, found);
			scanValueExpression(node["left"], where, found);
			scanValueExpression(node["right"], where, found);
			return;
		case "BinaryExpression":
			checkOperator(node["operator"], SUPPORTED_BINARY_OPERATORS, expression, where, found);
			scanValueExpression(node["left"], where, found);
			scanValueExpression(node["right"], where, found);
			return;
		case "UnaryExpression":
			checkOperator(node["operator"], SUPPORTED_UNARY_OPERATORS, expression, where, found);
			scanValueExpression(node["operand"], where, found);
			return;
		case "AtIdentifier":
			// A namespace with no field after it. Reached only when one appears
			// outside a member expression, where there is nothing to resolve.
			found.push(report(`@${String(node["name"])}`, nodeRange(expression), where));
			return;
		default:
			// StringLiteral, NumberLiteral, BooleanLiteral: values with nothing
			// beneath them.
			return;
	}
}

/**
 * What to call an expression in a refusal, in the author's own vocabulary.
 *
 * A bare name gets named as one — `True`/`False` are `BooleanLiteral`s, so
 * every remaining `Identifier` in a value position is a reference to something
 * this runtime has nothing to resolve against, and "Identifier at 4:9" sends an
 * author looking for a construct they never typed.
 */
function describeExpression(expression: unknown): string {
	const kind = kindOf(expression);
	if (kind === undefined) return "an unparsed expression";
	if (kind !== "Identifier") return kind;
	return `the bare name ${String((expression as Node)["name"])}`;
}

function checkOperator(
	operator: unknown,
	allowed: readonly string[],
	expression: unknown,
	where: string,
	found: UnsupportedConstruct[],
): void {
	if (typeof operator !== "string" || !allowed.includes(operator)) {
		found.push(report(`the operator ${String(operator)}`, nodeRange(expression), where));
	}
}

function report(construct: string, range: Range, where: string): UnsupportedConstruct {
	// "at 1:1" when the parser reported no position at all is a lie an author
	// acts on — they go to line 1 and find nothing wrong with it.
	const at = isUnreportedRange(range)
		? "at a position the parser did not report"
		: `at ${formatPosition(range)}`;
	return {
		construct,
		range,
		where,
		message:
			`${construct} ${at}, in ${where}, is unsupported by this runtime. ` +
			"It may well be valid Agent Script — @coopcli/agentscript implements an enumerated " +
			`subset and does not execute this construct. Supported: ${renderSubsetInline()}.`,
	};
}
