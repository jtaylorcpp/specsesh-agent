import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { UnsupportedConstructError, run, scanDocument } from "../../src/interpreter/index.js";
import { renderSubsetInline } from "../../src/interpreter/subset.js";
import {
	EXPRESSION_DEFAULT,
	TWO_UNSUPPORTED,
	UNSUPPORTED_BLOCK,
	UNSUPPORTED_ON_UNREACHED_BRANCH,
} from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

/** Assert the refusal and hand it back, so each scenario can look at its own detail. */
async function refusal(source: string, entry?: string): Promise<UnsupportedConstructError> {
	const { port, requests } = recordingPort(answered());
	const error = await run(source, entry === undefined ? { port } : { port, entry }).then(
		() => undefined,
		(err: unknown) => err,
	);
	expect(error, "the run was not refused").toBeInstanceOf(UnsupportedConstructError);
	// Before execution, in every scenario: a refusal that arrives after a turn has
	// been dispatched is not the refusal this requirement asks for.
	expect(requests, "a step was dispatched before the refusal").toHaveLength(0);
	return error as UnsupportedConstructError;
}

describe("platform-agentscript-interpreter: A Construct Outside The Subset Fails By Name, Before Execution", () => {
	it("Scenario: An unsupported block — refused before execution, naming the block and its position", async () => {
		// `model_config:` is valid Agent Script that lints CLEAN against the pinned
		// dialect (asserted in fixtures-lint.test.ts), so the refusal below can only
		// come from our own subset scan.
		const error = await refusal(UNSUPPORTED_BLOCK);

		const block = error.constructs.find((c) => c.construct === "model_config");
		expect(block, "the model_config block was not named").toBeDefined();
		// `model_config:` starts on source line 4, column 1 — reported 1-based, as
		// an editor numbers them.
		expect(block?.range.start).toEqual({ line: 3, character: 0 });
		expect(block?.message).toContain("4:1");

		// The wording is the requirement, not decoration: `model_config:` is
		// perfectly valid Agent Script that Salesforce's runtime would execute.
		// Telling the author their document is invalid sends them to fix nothing.
		expect(block?.message).toContain("unsupported by this runtime");
		expect(block?.message).not.toMatch(/invalid Agent Script/i);
		expect(block?.message).toContain("may well be valid Agent Script");
	});

	it("Scenario: A variable defaulted from an expression — refused by name, not dropped in silence", async () => {
		// The scan and the reader must admit the same set. When they did not, this
		// document passed the scan with a clean bill of health, `b` was dropped by
		// `readDeclarations` without a word, and the run then accused the document
		// of never declaring the variable it declares on the line above:
		//
		//   UndeclaredVariableError: the document references @variables.b at 8:13,
		//   but declares no such variable.
		//
		// A false accusation, from the one error message in the package whose text
		// promises the opposite. And with nothing referencing `b`, the run reported
		// `completed` and the variable simply did not exist.
		const error = await refusal(EXPRESSION_DEFAULT);

		const finding = error.constructs.find((c) => c.where === 'variable "b"');
		expect(finding, "the expression default was not named").toBeDefined();
		expect(finding?.construct).toBe("MemberExpression as a variable's default");
		expect(finding?.message).toContain("unsupported by this runtime");
		// Where the author wrote it, not the top of the file.
		expect(finding?.range.start.line).toBe(2);

		// And the reader is never reached with something it cannot read: the two
		// now agree, which is what makes `readLiteral` total rather than partial.
		expect(error.constructs).toHaveLength(1);
	});

	it("Scenario: Every refusal carries a real position, or says it has none", async () => {
		// Positions were asserted on two hand-picked findings and nowhere else. The
		// scan falls back to the origin whenever the parser reported no span, and
		// the message rendered that as "1:1" — indistinguishable from a real
		// position at the top of the file, and it sends an author to a line with
		// nothing wrong on it.
		//
		// Both halves are asserted. First, every refusal a real document produces:
		for (const source of [UNSUPPORTED_BLOCK, UNSUPPORTED_ON_UNREACHED_BRANCH, TWO_UNSUPPORTED]) {
			const error = await refusal(
				source,
				source === UNSUPPORTED_ON_UNREACHED_BRANCH ? "draft" : undefined,
			);
			expect(error.constructs.length).toBeGreaterThan(0);
			for (const found of error.constructs) {
				// Against the pinned dialect every one of these HAS a position, which
				// is worth pinning in itself.
				expect(found.range.start.line + found.range.start.character).toBeGreaterThan(0);
				expect(found.message).toContain(
					`${found.range.start.line + 1}:${found.range.start.character + 1}`,
				);
			}
		}

		// And then the fallback itself, driven directly — a node the parser gave no
		// `__cst` at all. Not reachable from the pinned dialect today, which is
		// exactly why it needs asserting: it is reached the day upstream stops
		// attaching a span to something, and a refusal is the last place that
		// should quietly invent a fact.
		const unpositioned = scanDocument({
			__children: [{ key: "mystery_block", value: {} }],
			mystery_block: {},
		});
		expect(unpositioned).toHaveLength(1);
		expect(unpositioned[0]?.range.start).toEqual({ line: 0, character: 0 });
		expect(unpositioned[0]?.message).toContain("a position the parser did not report");
		expect(unpositioned[0]?.message).not.toContain("at 1:1");
	});

	it("Scenario: An unsupported construct on an unreached branch — still refused up front", async () => {
		// The run enters "draft" and would never reach "review". The refusal comes
		// anyway, because a document that refuses in week three mid-run is worse
		// than one that refuses now.
		const error = await refusal(UNSUPPORTED_ON_UNREACHED_BRANCH, "draft");

		const finding = error.constructs.find((c) => c.where === 'subagent "review"');
		expect(finding, "the unreached subagent was not scanned").toBeDefined();
		expect(finding?.construct).toBe("set @context");
		expect(finding?.message).toContain("unsupported by this runtime");
	});

	it("Scenario: Nothing is silently skipped — no partial execution, a diagnostic per dropped instruction", async () => {
		const error = await refusal(TWO_UNSUPPORTED);

		// Both, not the first: a caller fixing them one refusal at a time is a
		// caller running the parser as a linter.
		expect(error.constructs.map((c) => c.construct).sort()).toEqual([
			"model_config",
			"set @context",
		]);
		for (const found of error.constructs) {
			expect(found.message).toContain("unsupported by this runtime");
		}

		// And nothing ran: the three supported instructions in this document — two
		// prompt lines and a `set` — were not partially executed on the way to the
		// refusal. `refusal()` has already asserted zero dispatches; this asserts
		// the run produced no result at all to have executed into.
		const { port, requests } = recordingPort(answered());
		await expect(run(TWO_UNSUPPORTED, { port })).rejects.toThrow(UnsupportedConstructError);
		expect(requests).toHaveLength(0);
	});
});

/** Scan a source the way `run` does: through the authoring surface's parse. */
const scan = (source: string) => scanDocument(analyze(source).parsed);

/** A document with a `variables` block declaring what the procedure under test reads. */
function procedure(body: string, variables = "") {
	return `${variables}subagent t:
    description: "d"

    reasoning:
        instructions: ->
${body
	.split("\n")
	.map((line) => `            ${line}`)
	.join("\n")}
`;
}

const VARS = `variables:
    approved: mutable boolean = False
    count: mutable number = 0
    stage: mutable string = "proposal"
    verdict: mutable string = ""

`;

describe("platform-agentscript-interpreter: Supported block fields are named per block", () => {
	it("Scenario: A config with agent_name is accepted", () => {
		expect(scan('config:\n    agent_name: "spec-author"\n')).toEqual([]);
	});

	it("Scenario: A subagent-level system block is refused", () => {
		const found = scan(
			`subagent t:
    description: "d"

    system:
        instructions: |
            Be careful.
`,
		);
		const finding = found.find((c) => c.construct === "system");
		expect(finding, "the subagent-level system block was not named").toBeDefined();
		expect(finding?.where).toBe('subagent "t"');
	});

	it("Scenario: An unknown top-level block is refused", () => {
		const found = scan(UNSUPPORTED_BLOCK);
		const finding = found.find((c) => c.construct === "model_config");
		expect(finding?.where).toBe("the document");
	});

	it("Scenario: An unknown field in a supported block is refused", () => {
		// `actions:` is a subagent field now (add-agentscript-actions); `label:` is not.
		const found = scan(
			`subagent t:
    description: "d"
    label: "x"
`,
		);
		const finding = found.find((c) => c.construct === "label");
		expect(finding, "the unknown subagent field was not named").toBeDefined();
		expect(finding?.where).toBe('subagent "t"');
	});
});

describe("platform-agentscript-interpreter: Statements, expressions and defaults are limited to declared kinds", () => {
	it("Scenario: A variable with no default is refused", () => {
		const found = scan("variables:\n    v: mutable string\n");
		const finding = found.find((c) => c.construct === "v (a variable with no declared value)");
		expect(finding, "the default-less variable was not named").toBeDefined();
		expect(finding?.where).toBe('variable "v"');
	});

	it("Scenario: A bare name in a value position is refused in the author's words", () => {
		const inCondition = scan(procedure("if foo:\n    | Go.", VARS));
		expect(inCondition.map((c) => c.construct)).toEqual(["the bare name foo"]);

		const inSet = scan(procedure("set @variables.stage = foo", VARS));
		expect(inSet.map((c) => c.construct)).toEqual(["the bare name foo"]);
		for (const found of [...inCondition, ...inSet]) expect(found.construct).not.toBe("Identifier");
	});

	it("Scenario: A non-procedure instructions value is refused", () => {
		const found = scan(
			`subagent t:
    description: "d"

    reasoning:
        instructions: "just a string"
`,
		);
		// Named by the kind the parser gave the value — never the supported procedure's.
		expect(found.map((c) => [c.construct, c.where])).toEqual([["UnknownStatement", 'subagent "t"']]);
	});

	it("Scenario: An unknown statement kind is refused", () => {
		// `run` is a supported statement now (add-agentscript-actions); `transition` is not.
		const found = scan(procedure("transition to @subagent.t", VARS));
		expect(found.map((c) => [c.construct, c.where])).toEqual([["TransitionStatement", 'subagent "t"']]);
	});
});

describe("platform-agentscript-interpreter: Only @variables may be read or written, and @outputs only as a set's whole value", () => {
	it("Scenario: Reading another namespace in an interpolation is refused", () => {
		const found = scan(procedure("| Hello {!@context.x}.", VARS));
		expect(found.map((c) => c.construct)).toEqual(["@context"]);
	});

	it("Scenario: @outputs as a set's value is accepted", () => {
		expect(scan(procedure("| Judge it.\nset @variables.verdict = @outputs.verdict", VARS))).toEqual(
			[],
		);
	});

	it("Scenario: @outputs inside a condition is refused", () => {
		const found = scan(procedure('if @outputs.verdict == "ok":\n    | Fine.', VARS));
		expect(found.map((c) => c.construct)).toEqual(["@outputs"]);
	});

	it("Scenario: A set target that is not a member expression is refused", () => {
		const found = scan(procedure("set foo = 1", VARS));
		// Named by the target's kind, never as a `set @<ns>`.
		expect(found.map((c) => [c.construct, c.where])).toEqual([["Identifier", 'subagent "t"']]);
	});
});

describe("platform-agentscript-interpreter: Operators are limited to the declared sets", () => {
	it("Scenario: Supported operators pass", () => {
		const found = scan(
			procedure("if not @variables.approved and @variables.count > 1:\n    | Draft it.", VARS),
		);
		expect(found).toEqual([]);
	});

	it("Scenario: An unknown operator is refused by name", () => {
		const found = scan(procedure("if @variables.count + 1:\n    | Draft it.", VARS));
		expect(found.map((c) => c.construct)).toEqual(["the operator +"]);
	});
});

describe("platform-agentscript-interpreter: Booleans are spelled the dialect's way when written back", () => {
	it("Scenario: Lower-case true is not a boolean", () => {
		const found = scan(procedure("if @variables.approved == true:\n    | Go.", VARS));
		expect(found.map((c) => c.construct)).toEqual(["the bare name true"]);
	});
});

describe("platform-agentscript-interpreter: The scan walks the whole document up front and reports every finding", () => {
	it("Scenario: The wrapper and the root give the same answer", () => {
		const parsed = analyze(UNSUPPORTED_BLOCK).parsed as { value: unknown };
		expect(parsed.value, "no root inside the wrapper").toBeDefined();

		const viaWrapper = scanDocument(parsed);
		const viaRoot = scanDocument(parsed.value);
		expect(viaWrapper.map((c) => c.construct)).toContain("model_config");
		expect(viaRoot).toEqual(viaWrapper);
	});

	it("Scenario: No root means no findings", () => {
		expect(scanDocument(null)).toEqual([]);
		expect(scanDocument(undefined)).toEqual([]);
	});
});

describe("platform-agentscript-interpreter: A refusal says the construct is unsupported by this runtime, where and in which block", () => {
	it("Scenario: The exact message and error shape", () => {
		const [finding] = scan(UNSUPPORTED_BLOCK);
		expect(finding?.construct).toBe("model_config");
		expect(finding?.message).toBe(
			"model_config at 4:1, in the document, is unsupported by this runtime. " +
				"It may well be valid Agent Script — @specsesh/agent implements an enumerated " +
				"subset and does not execute this construct. " +
				`Supported: ${renderSubsetInline()}.`,
		);
	});

	it("Scenario: The error aggregates its findings", () => {
		const findings = scan(TWO_UNSUPPORTED);
		expect(findings).toHaveLength(2);

		const error = new UnsupportedConstructError(findings);
		expect(error.name).toBe("UnsupportedConstructError");
		expect(error.constructs).toEqual(findings);
		expect(
			error.message.startsWith("this runtime does not implement 2 construct(s) used by the document:\n"),
		).toBe(true);
		for (const finding of findings) expect(error.message).toContain(`  - ${finding.message}`);
	});
});
