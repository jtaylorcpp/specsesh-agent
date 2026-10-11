/**
 * Documents the interpreter tests run against.
 *
 * Written in the pinned dialect's vocabulary, which means `subagent` and not
 * `topic` — the dialect deprecates the latter ("'topic' is deprecated: Replace
 * topic with subagent.") — and it means every OTHER spelling the dialect
 * insists on too:
 *
 *   - `True` / `False`, not `true` / `false` ("'false' is not a valid value in
 *     AgentScript. Did you mean 'False' (capitalized)?").
 *   - `{!@variables.x}`, not `{@variables.x}` ("The '!' is required for
 *     template interpolation.").
 *   - `@outputs`, not `@output` ("'@output' is not a recognized namespace").
 *   - a `description:` on every subagent ("Missing required field
 *     'description'").
 *
 * ## Why this file has a registry
 *
 * These fixtures were never once compared against the authoring surface's own
 * lint, and every one of the spellings above was wrong as a result: the
 * interpreter had been built to run whatever the fixtures happened to say. The
 * fixture labelled "Every construct in the subset, and nothing else" was itself
 * a document its own linter rejected, and nine tests ran it.
 *
 * `FIXTURES` below is what closes that. Every fixture declares what the lint
 * must say about it — `"clean"` for the great majority, or the exact
 * diagnostics for the few that are deliberately broken because being broken IS
 * the scenario. `fixtures-lint.test.ts` asserts each one, and asserts that
 * every exported document in this file appears in the registry, so a fixture
 * added later cannot skip the check by being added later.
 */

/** What the authoring surface must say about a fixture. */
export type ExpectedLint = "clean" | readonly string[];

/** Every construct in the subset, and nothing else. */
export const IN_SUBSET = `config:
    agent_name: "spec-author"

system:
    instructions: |
        You walk the author through one OpenSpec change.

variables:
    stage: mutable string = "proposal"
        description: "proposal | specs | design | tasks"
    approved: mutable boolean = False

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the current artifact.
            if @variables.approved:
                | Draft the specs.
            else:
                | Ask the author to approve first.
            set @variables.stage = "specs"
`;

/**
 * A valid Agent Script block this runtime does not implement, in a document
 * whose supported parts would otherwise run.
 *
 * `model_config:` is deliberate: it parses AND lints clean against the pinned
 * dialect with no diagnostic at all, so a refusal here can only come from OUR
 * subset scan, not from upstream disliking it.
 *
 * (It used to be `actions:`, which does NOT lint clean — it is allowed only
 * under `agent_type: "GoalBasedAgent"`, and a GoalBasedAgent script may not
 * carry a `subagent` at all, so the fixture could not have both. The comment
 * claiming it produced "no diagnostic at all" had never been checked.)
 */
export const UNSUPPORTED_BLOCK = `config:
    agent_name: "spec-author"

model_config:
    model: "model://sfdc_ai__DefaultGPT4"

subagent draft:
    description: "the one that would run"

    reasoning:
        instructions: ->
            | Read the current artifact.
`;

/**
 * The unsupported construct sits in the SECOND subagent. A run entering only the
 * first would never reach it, which is the whole point of the scenario.
 */
export const UNSUPPORTED_ON_UNREACHED_BRANCH = `subagent draft:
    description: "the one the run enters"

    reasoning:
        instructions: ->
            | Read the current artifact.

subagent review:
    description: "never entered"

    reasoning:
        instructions: ->
            set @context.mode = "review"
`;

/**
 * Two unsupported constructs and three supported instructions around them, so a
 * scan that stopped at the first finding would leave the second undiagnosed and
 * a scan that ran the document would execute three lines it should not.
 */
export const TWO_UNSUPPORTED = `config:
    agent_name: "spec-author"

model_config:
    model: "model://sfdc_ai__DefaultGPT4"

variables:
    stage: mutable string = "proposal"

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the current artifact.
            | Summarise it.
            set @context.mode = "draft"
            set @variables.stage = "specs"
`;

/**
 * A variable defaulted from another variable rather than from a literal.
 *
 * Lints clean, so it is a document an author can save — and the scan must
 * refuse it by name. It used to pass the scan and then be dropped by the
 * reader, after which the run accused the document of never declaring `b`.
 */
export const EXPRESSION_DEFAULT = `variables:
    a: mutable string = "proposal"
    b: mutable string = @variables.a

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Draft the {!@variables.b}.
`;

/** A step that writes a variable from a field of its structured result. */
export const STRUCTURED = `system:
    instructions: |
        You judge one artifact.

variables:
    verdict: mutable string = "undecided"

subagent judge:
    description: "Decide"

    reasoning:
        instructions: ->
            | Judge the artifact.
            set @variables.verdict = @outputs.verdict
`;

/**
 * A step that asks for a structured result and composes NO prompt, because its
 * only prompt line sits behind a condition that does not hold.
 *
 * Dispatching this asks the model nothing and pays for the answer.
 */
export const STRUCTURED_WITHOUT_PROMPT = `variables:
    verdict: mutable string = "undecided"
    ready: mutable boolean = False

subagent judge:
    description: "Decide"

    reasoning:
        instructions: ->
            if @variables.ready:
                | Judge the artifact.
            set @variables.verdict = @outputs.verdict
`;

/** Two subagents, each with its own prompt line, run as two steps of one run. */
export const TWO_STEPS = `system:
    instructions: |
        You walk the author through one OpenSpec change.

variables:
    stage: mutable string = "proposal"

subagent first:
    description: "Draft it"

    reasoning:
        instructions: ->
            | Draft the {!@variables.stage}.
            set @variables.stage = "specs"

subagent second:
    description: "Review it"

    reasoning:
        instructions: ->
            | Review the {!@variables.stage}.
`;

/** Nothing but logic. There is nothing here to ask a model. */
export const LOGIC_ONLY = `variables:
    stage: mutable string = "proposal"
    approved: mutable boolean = True

subagent gate:
    description: "Decide the stage"

    reasoning:
        instructions: ->
            if @variables.approved:
                set @variables.stage = "specs"
            else:
                set @variables.stage = "blocked"
`;

/** Three prompt lines, one of them behind a condition that will not hold. */
export const CONDITIONAL = `variables:
    approved: mutable boolean = False

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | First line.
            if @variables.approved:
                | Only when approved.
            | Last line.
`;

/**
 * A boolean literal in an EXPRESSION position, not only as a default.
 *
 * The two positions are scanned by different lists —
 * `SUPPORTED_DEFAULT_VALUE_KINDS` and `SUPPORTED_EXPRESSION_KINDS` — so a
 * fixture that only ever writes `= False` leaves half the boolean support
 * untested. `IN_SUBSET` is exactly that fixture, which is why this one exists.
 */
export const BOOLEAN_COMPARISON = `variables:
    approved: mutable boolean = False
    stage: mutable string = "proposal"

subagent gate:
    description: "Decide the stage"

    reasoning:
        instructions: ->
            if @variables.approved == False:
                set @variables.stage = "blocked"
            else:
                set @variables.stage = "specs"
`;

/** A boolean the run flips, so persistence has a boolean to write back. */
export const PERSISTED_BOOLEAN = `variables:
    approved: mutable boolean = False

subagent gate:
    description: "Approve it"

    reasoning:
        instructions: ->
            if not @variables.approved:
                set @variables.approved = True
`;

/**
 * A document with no subagent at all: a run would dispatch nothing.
 *
 * Carries no variables either — with no subagent there is nothing to read one,
 * and the dialect reports an unread variable, which would make this fixture
 * dirty for a reason that has nothing to do with the scenario.
 */
export const NO_SUBAGENT = `config:
    agent_name: "spec-author"

system:
    instructions: |
        You walk the author through one OpenSpec change.
`;

/**
 * References a variable the document never declares.
 *
 * DELIBERATELY not lint-clean — the undeclared reference IS the scenario, and
 * the dialect's own `undefined-reference` pass reports it at error severity.
 */
export const UNDECLARED_REFERENCE = `variables:
    stage: mutable string = "proposal"

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the {!@variables.stage}.
            if @variables.approved:
                | Draft it.
`;

/**
 * A hard syntax error: the string on the `set` line is never closed.
 *
 * The parser RECOVERS from this rather than throwing — it swallows the rest of
 * the line and hands back a tree in which `stage` is set to `"unterminated"`, a
 * value the author never wrote. The subset scan walks that recovered tree and
 * finds nothing wrong, so the diagnostics are the only thing that can refuse
 * it. DELIBERATELY not lint-clean.
 */
export const UNTERMINATED_STRING = `variables:
    stage: mutable string = "proposal"

subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the artifact.
            set @variables.stage = "unterminated
            | Summarise it.
`;

/**
 * Every fixture above, and what the authoring surface must say about it.
 *
 * The deliberately-broken few pin their diagnostics EXACTLY rather than merely
 * asserting "some diagnostic": a fixture that acquires a second, unintended
 * problem would otherwise keep passing while testing something else.
 */
export const FIXTURES: Readonly<Record<string, { source: string; lint: ExpectedLint }>> = {
	IN_SUBSET: { source: IN_SUBSET, lint: "clean" },
	UNSUPPORTED_BLOCK: { source: UNSUPPORTED_BLOCK, lint: "clean" },
	UNSUPPORTED_ON_UNREACHED_BRANCH: { source: UNSUPPORTED_ON_UNREACHED_BRANCH, lint: "clean" },
	TWO_UNSUPPORTED: { source: TWO_UNSUPPORTED, lint: "clean" },
	EXPRESSION_DEFAULT: { source: EXPRESSION_DEFAULT, lint: "clean" },
	STRUCTURED: { source: STRUCTURED, lint: "clean" },
	STRUCTURED_WITHOUT_PROMPT: { source: STRUCTURED_WITHOUT_PROMPT, lint: "clean" },
	TWO_STEPS: { source: TWO_STEPS, lint: "clean" },
	LOGIC_ONLY: { source: LOGIC_ONLY, lint: "clean" },
	CONDITIONAL: { source: CONDITIONAL, lint: "clean" },
	BOOLEAN_COMPARISON: { source: BOOLEAN_COMPARISON, lint: "clean" },
	PERSISTED_BOOLEAN: { source: PERSISTED_BOOLEAN, lint: "clean" },
	NO_SUBAGENT: { source: NO_SUBAGENT, lint: "clean" },
	UNDECLARED_REFERENCE: {
		source: UNDECLARED_REFERENCE,
		lint: ["'approved' is not defined in variables"],
	},
	UNTERMINATED_STRING: { source: UNTERMINATED_STRING, lint: ['Missing "'] },
};
