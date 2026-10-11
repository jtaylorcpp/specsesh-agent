/**
 * The Agent Script constructs this package supports, declared in ONE place.
 *
 * Everything that needs to know the boundary reads it from here: the
 * pre-execution scan, the conformance check that runs against the pinned
 * upstream, the README, and the error a caller gets when they use something
 * outside it. A second copy of this list would be free to disagree with the
 * first, and the disagreement would surface as a construct silently ignored at
 * run time.
 *
 * It lives beside the interpreter rather than beside the authoring surface
 * because the interpreter is what the subset is a statement ABOUT — authoring
 * accepts the whole language, and only execution has a boundary. The authoring
 * entry re-exports it so a consumer that only ever imported it from there keeps
 * working.
 *
 * The declaration below is deliberately a plain array literal, closed by an
 * `as const` assertion: `scripts/check-subset-conformance.mjs` reads it out of
 * this file's TEXT so it can run without a TypeScript build step, which is what
 * lets the conformance check be the same list rather than a copy of it. (That
 * terminator is not spelled out here, character for character, on purpose — a
 * test rewrites the FIRST occurrence of it in this file to stand in for an
 * upstream bump, and a comment quoting it would swallow the rewrite.)
 */

export interface SupportedConstruct {
	/** Stable id, used in failures so a human can search for it. */
	readonly id: string;
	/** What the construct is, in the language's own terms. */
	readonly summary: string;
	/**
	 * A minimal script exercising it, used to prove upstream still parses it AND
	 * that it still produces every kind in `kinds`. The probe must therefore
	 * exercise the construct fully — a probe that omits one of its declared kinds
	 * fails the conformance check, which is what stops `kinds` becoming a wish.
	 */
	readonly probe: string;
	/**
	 * The parser node kinds this construct covers, as the pinned dialect spells
	 * them.
	 *
	 * `scan.ts` and `compose.ts` match on these strings, so an upstream RENAME
	 * (`ProcedureValue` → `Procedure`, say) breaks them outright while the
	 * document still parses clean. `scripts/check-subset-conformance.mjs` walks
	 * each probe's parse and fails naming every declared kind the pinned version
	 * no longer produces — which is the only way a bump that changes HANDLING,
	 * rather than merely stopping a parse, is visible at all.
	 *
	 * Never empty: an empty collection is a construct the check skips silently.
	 */
	readonly kinds: readonly string[];
}

export const SUPPORTED_CONSTRUCTS: readonly SupportedConstruct[] = [
	{
		id: "config",
		summary: "the config block naming the agent",
		probe: 'config:\n    agent_name: "spec-author"\n',
		kinds: ["ConfigBlock"],
	},
	{
		id: "system.instructions",
		summary: "standing instructions, as a multiline block",
		probe: "system:\n    instructions: |\n        You help the author.\n",
		kinds: ["SystemBlock", "TemplateExpression", "TemplateText"],
	},
	{
		id: "variables",
		summary: "declared variables with a type and a literal default",
		// Three declarations, because the dialect files them under two different
		// kinds: `mutable`/`linked` gives a VariableDeclaration and a bare
		// `name: type = value` gives a ParameterDeclaration. `Identifier` is how
		// the type and the modifier are spelled — `readDeclarations` reads the
		// type off one, so an upstream rename there is a real break.
		probe:
			'variables:\n    stage: mutable string = "proposal"\n    change_id: string = "OS-1"\n    approved: mutable boolean = False\n',
		kinds: [
			"VariablesBlock",
			"VariableDeclaration",
			"ParameterDeclaration",
			"Identifier",
			"StringLiteral",
			"BooleanLiteral",
		],
	},
	{
		id: "variables.description",
		summary: "a variable's description",
		probe: 'variables:\n    stage: mutable string = "proposal"\n        description: "which stage is live"\n',
		kinds: ["VariablePropertiesBlock"],
	},
	{
		id: "subagent",
		summary: "a named subagent with a description",
		probe: 'subagent draft:\n    description: "Fill the proposal"\n',
		kinds: ["Collection<SubagentBlock>", "SubagentBlock"],
	},
	{
		id: "subagent.reasoning",
		summary: "a subagent's reasoning block",
		probe: 'subagent draft:\n    description: "d"\n\n    reasoning:\n        instructions: ->\n            | Do the thing.\n',
		kinds: ["ReasoningBlock", "ProcedureValue"],
	},
	{
		id: "reasoning.prompt-line",
		summary: "a prompt line, interpreted by the model",
		probe: "subagent t:\n    reasoning:\n        instructions: ->\n            | Read the artifact.\n",
		kinds: ["Template", "TemplateText"],
	},
	{
		id: "reasoning.interpolation",
		summary: "a `{!@variables.x}` reference inside a prompt line",
		// The `!` is the dialect's, not a decoration: `{@variables.x}` is a lint
		// error ("The '!' is required for template interpolation") and is left
		// inside the surrounding TemplateText, whereas `{!@variables.x}` becomes
		// its own TemplateInterpolation part carrying the member expression. Two
		// different trees, and only this one is a document an author can save
		// clean — see README on why the interpreter follows the dialect here.
		probe:
			'variables:\n    stage: mutable string = "proposal"\n\nsubagent t:\n    reasoning:\n        instructions: ->\n            | Draft the {!@variables.stage}.\n',
		kinds: ["TemplateInterpolation"],
	},
	{
		id: "reasoning.logic-line",
		summary: "a logic line, run deterministically every turn",
		// Exercises every expression form the subset admits, because the probe is
		// what proves the kinds below still exist upstream. A probe narrower than
		// its own `kinds` list is a check that passes while half of it is fiction.
		probe:
			'variables:\n    stage: mutable string = "proposal"\n    count: mutable number = 0\n    approved: mutable boolean = False\n\nsubagent t:\n    reasoning:\n        instructions: ->\n            if not @variables.approved and @variables.count > 1:\n                | Draft it.\n            else:\n                set @variables.stage = "specs"\n',
		kinds: [
			"IfStatement",
			"SetClause",
			"MemberExpression",
			"AtIdentifier",
			"ComparisonExpression",
			"BinaryExpression",
			"UnaryExpression",
			"StringLiteral",
			"NumberLiteral",
			"BooleanLiteral",
		],
	},
	{
		id: "reasoning.structured-output",
		summary: "assigning a variable from a field of the step's structured result",
		// `@outputs`, plural — the dialect's own spelling. `@output` is refused
		// outright ("'@output' is not a recognized namespace"), so a document
		// written against the singular could never be saved clean.
		probe:
			'variables:\n    verdict: mutable string = ""\n\nsubagent t:\n    reasoning:\n        instructions: ->\n            | Judge it.\n            set @variables.verdict = @outputs.verdict\n',
		kinds: ["SetClause", "MemberExpression", "AtIdentifier"],
	},
] as const;

/** Every supported construct id, for a caller that only needs the names. */
export const SUPPORTED_CONSTRUCT_IDS: readonly string[] = SUPPORTED_CONSTRUCTS.map((c) => c.id);

/**
 * Which fields a supported block may carry.
 *
 * Kinds alone are not enough, and the gap is not theoretical: a subagent may
 * declare its OWN `system:` block, whose node kind is `SystemBlock` — the same
 * kind the document-level one has, and therefore one a kind-only check would
 * wave through and the interpreter would then ignore. Naming the fields per
 * block is what turns that into a refusal.
 *
 * `Document` is not a real node kind; it is the root object the dialect returns.
 */
export const SUPPORTED_BLOCK_FIELDS: Readonly<Record<string, readonly string[]>> = {
	Document: ["config", "system", "variables", "subagent"],
	/**
	 * The dialect REQUIRES one of `agent_name` / `developer_name` — a config with
	 * neither is a diagnostic, so refusing them here would refuse every valid
	 * document. `agent_type` is accepted but constrained to the dialect's own
	 * enumeration, and nothing in this runtime reads any of them: config is
	 * identity carried for the author and whatever executes the script elsewhere.
	 *
	 * (`agent_name` was briefly absent from this list. It came from a finding made
	 * against the BASE dialect, where the field genuinely does not exist, before
	 * this package moved to the Agentforce dialect — where it is required. The
	 * scan then correctly refused every real document. Left recorded because the
	 * two dialects disagree about this field and the mistake is easy to repeat.)
	 */
	ConfigBlock: ["agent_name", "developer_name", "agent_type", "description"],
	SystemBlock: ["instructions"],
	// The dialect files a variable's `description:` under a synthetic
	// `properties` field, so the declaration's own child list carries that one
	// name rather than the name the author typed.
	VariableDeclaration: ["properties"],
	ParameterDeclaration: ["properties"],
	VariablePropertiesBlock: ["description"],
	SubagentBlock: ["description", "reasoning"],
	ReasoningBlock: ["instructions"],
};

/** The statements an `instructions: ->` procedure may contain. */
export const SUPPORTED_STATEMENT_KINDS: readonly string[] = ["Template", "IfStatement", "SetClause"];

/**
 * The expression forms a condition or an assigned value may be built from.
 *
 * `Identifier` is deliberately ABSENT. The dialect parses `True`/`False` as
 * `BooleanLiteral`, and every OTHER bare name is a reference to something this
 * runtime cannot resolve — resolving it to nothing is the silent skip this
 * package refuses. (`true`/`false` lower-case were once accepted here as
 * `Identifier`s: the dialect rejects that spelling outright — "'true' is not a
 * valid value in AgentScript. Did you mean 'True' (capitalized)?" — so the only
 * boolean the interpreter ran was one no author could save clean.)
 */
export const SUPPORTED_EXPRESSION_KINDS: readonly string[] = [
	"MemberExpression",
	"AtIdentifier",
	"ComparisonExpression",
	"BinaryExpression",
	"UnaryExpression",
	"StringLiteral",
	"NumberLiteral",
	"BooleanLiteral",
];

/**
 * The expression forms a variable's DEFAULT may be built from.
 *
 * Narrower than the list above, and the narrowing is the point: the run's
 * opening state is read by `readDeclarations`, which reads literals and only
 * literals. Admitting `b: mutable string = @variables.a` here would let the
 * scan hand a clean bill of health to a declaration the reader then drops —
 * after which the run accuses the document of never declaring `b`.
 */
export const SUPPORTED_DEFAULT_VALUE_KINDS: readonly string[] = [
	"StringLiteral",
	"NumberLiteral",
	"BooleanLiteral",
];

/**
 * The `@` namespaces an expression may READ.
 *
 * `@variables` is the run's own state, and it is the only one — everything else
 * Agent Script offers (`@context`, `@user`, …) is a Salesforce-runtime surface
 * we have nothing to resolve against, and resolving it to nothing is the silent
 * skip this package exists to refuse.
 */
export const READABLE_NAMESPACES: readonly string[] = ["variables"];

/**
 * The namespace naming a field of the step's STRUCTURED result.
 *
 * Supported in exactly one position: the whole value of a `set`. That is not a
 * simplification, it is the semantics — the field does not exist until the step
 * has run, so `if @outputs.x:` would be asking a condition about a value that
 * cannot have one yet. Reading it only as an assignment is what makes the
 * structured result the ONLY thing that writes a variable from the model, per
 * `A State Update Is Structured, And Prose Is Never Parsed For One`.
 *
 * PLURAL. `@output` is not a namespace the dialect knows ("'@output' is not a
 * recognized namespace"), so every document written against the singular was a
 * document that could not be saved clean — the interpreter ran a spelling the
 * authoring surface rejects.
 */
export const STRUCTURED_RESULT_NAMESPACE = "outputs";

/** The `@` namespaces a `set` may WRITE. State is the interpreter's, and only that. */
export const ASSIGNABLE_NAMESPACES: readonly string[] = ["variables"];

/** The comparisons a condition may make. */
export const SUPPORTED_COMPARISON_OPERATORS: readonly string[] = ["==", "!=", "<", "<=", ">", ">="];

/** The ways two conditions may be joined. */
export const SUPPORTED_BINARY_OPERATORS: readonly string[] = ["and", "or"];

/** The ways one condition may be negated. */
export const SUPPORTED_UNARY_OPERATORS: readonly string[] = ["not"];

/**
 * How this runtime spells a boolean when it writes one back into a document.
 *
 * `persistVariables` splices these into the author's source, so they must be
 * the spelling the dialect ACCEPTS: writing JavaScript's `true` would rewrite a
 * clean document into one whose own linter rejects it.
 */
export const BOOLEAN_LITERALS: Readonly<Record<"true" | "false", string>> = {
	true: "True",
	false: "False",
};

/**
 * Every node kind any supported construct claims, flattened.
 *
 * Read by `__tests__/subset-single-source.test.ts`, which asserts the
 * statement and expression lists the scan matches on are a SUBSET of what the
 * constructs declare. Without that tie the two could name different kinds and
 * the conformance check — which walks probes against `kinds` — would be
 * proving something about a list the scan does not use.
 */
export const SUPPORTED_NODE_KINDS: readonly string[] = [
	...new Set([
		...SUPPORTED_CONSTRUCTS.flatMap((c) => c.kinds),
		...SUPPORTED_STATEMENT_KINDS,
		...SUPPORTED_EXPRESSION_KINDS,
	]),
];

/**
 * The subset as prose, rendered from the declaration above.
 *
 * The README and the refusal message both call this rather than restating the
 * list, which is the whole point of the requirement: three restatements drift
 * into three different subsets and the one that matters is the one nobody reads.
 */
export function renderSubsetMarkdown(): string {
	return SUPPORTED_CONSTRUCTS.map((c) => `- \`${c.id}\` — ${c.summary}`).join("\n");
}

/** The same list on one line, for an error message that has no room for prose. */
export function renderSubsetInline(): string {
	return SUPPORTED_CONSTRUCT_IDS.join(", ");
}
