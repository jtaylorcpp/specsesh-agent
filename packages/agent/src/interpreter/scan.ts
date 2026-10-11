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
	type ActionClauses,
	type ActionDefinition,
	type ActionParameter,
	actionReference,
	hasReasoningActions,
	parseTarget,
	readActionDefinitions,
	readReasoningActions,
	runClauses,
} from "./actions.js";
import {
	ACTION_PARAMETER_TYPES,
	ACTION_TARGET_SCHEME,
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
		const scope: SubagentScope = { where, actions: new Map(), procedures: [] };
		const fields = scanBlockFields(block, "SubagentBlock", where, found);
		// Definitions first, so a `run` or an entry above them in the source still
		// resolves against them.
		for (const field of fields) {
			if (childName(field) === "actions") scanActionDefinitions(block, scope, found);
		}
		for (const field of fields) {
			if (childName(field) !== "reasoning") continue;
			const reasoning = childValue(field);
			for (const inner of scanBlockFields(reasoning, "ReasoningBlock", where, found)) {
				if (childName(inner) === "actions") continue;
				scanProcedure(childValue(inner), scope, found);
			}
		}
		scanReasoningActions(block, scope, found);
		scanDeterministicRule(block, scope, found);
	}
}

/** What the scan knows about the subagent it is in: where, and the actions it defines. */
interface SubagentScope {
	readonly where: string;
	readonly actions: Map<string, ActionDefinition>;
	/** Statement lists of `reasoning.instructions`, for the deterministic-subagent rule. */
	readonly procedures: unknown[][];
}

/**
 * A subagent's `actions:` block: each definition's fields, its scalar inputs and
 * outputs (no default, no properties), and its target, which must be
 * `mcpTool://<name>` — every other scheme the dialect accepts is refused.
 */
function scanActionDefinitions(block: unknown, scope: SubagentScope, found: UnsupportedConstruct[]): void {
	const { where } = scope;
	const collection = (block as Node)["actions"];
	for (const entry of childrenOf(collection)) {
		const value = childValue(entry);
		if (kindOf(value) !== "ActionBlock") {
			found.push(report(kindOf(value) ?? childName(entry), childRange(entry), where));
		}
	}
	for (const definition of readActionDefinitions(block)) {
		scope.actions.set(definition.name, definition);
		scanBlockFields(definition.block, "ActionBlock", where, found);
		for (const parameter of [...definition.inputs, ...definition.outputs]) {
			scanActionParameter(parameter, definition.name, where, found);
		}
		if (definition.target === undefined) {
			found.push(report(`action ${definition.name} with no target string`, definition.range, where));
			continue;
		}
		const target = parseTarget(definition.target);
		if (target === undefined) {
			found.push(report(`target ${definition.target}`, nodeRange(definition.block["target"]), where));
		} else if (target.scheme !== ACTION_TARGET_SCHEME) {
			found.push(report(`target ${target.scheme}://`, nodeRange(definition.block["target"]), where));
		} else if (target.name === "") {
			found.push(report(`target ${ACTION_TARGET_SCHEME}:// with no tool name`, nodeRange(definition.block["target"]), where));
		}
	}
}

function scanActionParameter(
	parameter: ActionParameter,
	action: string,
	where: string,
	found: UnsupportedConstruct[],
): void {
	const declaration = parameter.declaration;
	if (kindOf(declaration) !== "ParameterDeclaration") {
		found.push(report(`${parameter.name} (${kindOf(declaration) ?? "an unparsed parameter"})`, parameter.range, where));
		return;
	}
	// `<name>: <type>` and nothing else: a description or any other property is refused.
	scanBlockFields(declaration, "ActionParameter", where, found);
	if (parameter.type === undefined || !ACTION_PARAMETER_TYPES.includes(parameter.type)) {
		found.push(
			report(
				`${parameter.name} (a parameter of ${action} typed ${describeType((declaration as Node)["type"])}, not string, number or boolean)`,
				parameter.range,
				where,
			),
		);
	}
	if ((declaration as Node)["defaultValue"] !== undefined) {
		found.push(report(`${parameter.name} (a parameter of ${action} with a default)`, parameter.range, where));
	}
}

function describeType(type: unknown): string {
	if (kindOf(type) === "Identifier") return String((type as Node)["name"]);
	if (kindOf(type) === "SubscriptExpression") {
		const node = type as Node;
		return `${describeType(node["object"])}[${describeType(node["index"])}]`;
	}
	return kindOf(type) ?? "nothing";
}

/** The action an `@actions.<name>` names, refused unless this subagent defines it. */
function resolveAction(
	reference: unknown,
	scope: SubagentScope,
	found: UnsupportedConstruct[],
): ActionDefinition | undefined {
	const name = actionReference(reference);
	if (name === undefined) {
		found.push(report(describeExpression(reference), nodeRange(reference), scope.where));
		return undefined;
	}
	const definition = scope.actions.get(name);
	if (definition === undefined) {
		found.push(report(`@actions.${name} (not an action this subagent defines)`, nodeRange(reference), scope.where));
	}
	return definition;
}

/**
 * The clauses beneath a `run` or an entry: every declared input given exactly
 * once, `set`s writing `@variables` from a declared output, nothing else.
 * `allowEllipsis` is true only for a reasoning-action entry, where the model
 * fills an input; nothing in a `run` is filled by a model.
 */
function scanActionClauses(
	clauses: ActionClauses,
	definition: ActionDefinition | undefined,
	allowEllipsis: boolean,
	scope: SubagentScope,
	range: Range,
	found: UnsupportedConstruct[],
): void {
	const { where } = scope;
	for (const statement of clauses.other) {
		found.push(report(kindOf(statement) ?? "an unparsed clause", nodeRange(statement), where));
	}
	const given = new Map<string, number>();
	for (const clause of clauses.withs) {
		given.set(clause.param, (given.get(clause.param) ?? 0) + 1);
		if (definition !== undefined && !definition.inputs.some((input) => input.name === clause.param)) {
			found.push(report(`with ${clause.param} (not an input of ${definition.name})`, clause.range, where));
		}
		if (kindOf(clause.value) === "Ellipsis") {
			if (!allowEllipsis) found.push(report("Ellipsis", nodeRange(clause.value), where));
			continue;
		}
		scanValueExpression(clause.value, where, found);
	}
	for (const [param, count] of given) {
		if (count > 1) found.push(report(`with ${param} (given ${count} times)`, range, where));
	}
	if (definition !== undefined) {
		for (const input of definition.inputs) {
			if (!given.has(input.name)) {
				found.push(report(`${input.name} (an input of ${definition.name} with no with clause)`, range, where));
			}
		}
	}
	for (const set of clauses.sets) {
		scanAssignmentTarget(set.target, where, found);
		if (namespaceOf(set.value) !== STRUCTURED_RESULT_NAMESPACE) {
			found.push(report(`${describeExpression(set.value)} (a set beneath an action takes @outputs only)`, nodeRange(set.value), where));
			continue;
		}
		const field = (set.value as Node)["property"];
		if (definition !== undefined && !definition.outputs.some((output) => output.name === field)) {
			found.push(report(`@outputs.${String(field)} (not an output of ${definition.name})`, nodeRange(set.value), where));
		}
	}
}

/** `reasoning.actions`: each entry offers one of this subagent's actions to the model. */
function scanReasoningActions(block: unknown, scope: SubagentScope, found: UnsupportedConstruct[]): void {
	const reasoning = (block as Node)["reasoning"];
	const collection = isNode(reasoning) ? reasoning["actions"] : undefined;
	if (collection === undefined) return;
	for (const entry of childrenOf(collection)) {
		if (kindOf(childValue(entry)) !== "ReasoningActionBlock") {
			found.push(report(kindOf(childValue(entry)) ?? childName(entry), childRange(entry), scope.where));
		}
	}
	for (const entry of readReasoningActions(block)) {
		if (kindOf(entry.node) !== "ReasoningActionBlock") continue;
		const definition = resolveAction(entry.reference, scope, found);
		scanActionClauses(entry, definition, true, scope, entry.range, found);
	}
	// The model is offered tools only alongside something to do with them.
	if (!scope.procedures.some((statements) => containsKind(statements, "Template"))) {
		found.push(report("reasoning actions with no prompt line", nodeRange(collection), scope.where));
	}
}

/**
 * A subagent that runs an action is a program, not a model step: only logic
 * lines and `run` statements, no prompt line, no `set` from `@outputs` outside a
 * `run`, no `reasoning.actions`.
 */
function scanDeterministicRule(block: unknown, scope: SubagentScope, found: UnsupportedConstruct[]): void {
	const statements = scope.procedures.flat();
	if (!containsKind(statements, "RunStatement")) return;
	const walk = (list: readonly unknown[]): void => {
		for (const statement of list) {
			const kind = kindOf(statement);
			const node = statement as Node;
			if (kind === "Template") {
				found.push(report("a prompt line beside a run statement", nodeRange(statement), scope.where));
			} else if (kind === "SetClause" && namespaceOf(node["value"]) === STRUCTURED_RESULT_NAMESPACE) {
				found.push(report("a set from @outputs outside a run, beside a run statement", nodeRange(statement), scope.where));
			} else if (kind === "IfStatement") {
				walk(Array.isArray(node["body"]) ? node["body"] : []);
				walk(Array.isArray(node["orelse"]) ? node["orelse"] : []);
			}
		}
	};
	walk(statements);
	if (hasReasoningActions(block)) {
		const reasoning = (block as Node)["reasoning"] as Node;
		found.push(report("reasoning actions beside a run statement", nodeRange(reasoning["actions"]), scope.where));
	}
}

/** True when a statement of `kind` sits anywhere in the list, including inside an `if`. */
function containsKind(list: readonly unknown[], kind: string): boolean {
	return list.some((statement) => {
		if (kindOf(statement) === kind) return true;
		if (kindOf(statement) !== "IfStatement") return false;
		const node = statement as Node;
		return (
			containsKind(Array.isArray(node["body"]) ? node["body"] : [], kind) ||
			containsKind(Array.isArray(node["orelse"]) ? node["orelse"] : [], kind)
		);
	});
}

function scanProcedure(procedure: unknown, scope: SubagentScope, found: UnsupportedConstruct[]): void {
	if (kindOf(procedure) !== "ProcedureValue") {
		found.push(report(kindOf(procedure) ?? "instructions", nodeRange(procedure), scope.where));
		return;
	}
	const statements = (procedure as Node)["statements"];
	if (Array.isArray(statements)) scope.procedures.push(statements);
	scanStatements(statements, scope, found);
}

function scanStatements(statements: unknown, scope: SubagentScope, found: UnsupportedConstruct[]): void {
	const { where } = scope;
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
			scanStatements(node["body"], scope, found);
			scanStatements(node["orelse"], scope, found);
		} else if (kind === "SetClause") {
			scanAssignmentTarget(node["target"], where, found);
			// The one position `@output` is legal in — see STRUCTURED_RESULT_NAMESPACE.
			if (namespaceOf(node["value"]) !== STRUCTURED_RESULT_NAMESPACE) {
				scanValueExpression(node["value"], where, found);
			}
		} else if (kind === "RunStatement") {
			const definition = resolveAction(node["target"], scope, found);
			scanActionClauses(runClauses(statement), definition, false, scope, nodeRange(statement), found);
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
			"It may well be valid Agent Script — @specsesh/agent implements an enumerated " +
			`subset and does not execute this construct. Supported: ${renderSubsetInline()}.`,
	};
}
