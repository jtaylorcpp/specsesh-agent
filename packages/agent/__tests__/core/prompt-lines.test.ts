import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { compose, procedureStatements, readSubagents } from "../../src/interpreter/compose.js";
import type { VariableValue } from "../../src/interpreter/index.js";
import { UnparsedDocumentError, run } from "../../src/interpreter/index.js";
import { CONDITIONAL, LOGIC_ONLY } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

// `CONDITIONAL` lives in helpers/fixtures.ts rather than inline here, so that
// `fixtures-lint.test.ts` asserts it is a document an author could save. It was
// inline, and it was written `approved: mutable boolean = false` — a spelling
// the dialect reports as an error and the interpreter nonetheless ran.

describe("platform-agentscript-interpreter: A Prompt Line And A Logic Line Have Different Semantics, And Both Are Honoured", () => {
	it("Scenario: Prompt lines compose — in order, into the text sent to the reasoning step", async () => {
		const { port, requests } = recordingPort(answered());

		await run(CONDITIONAL, { port, variables: { approved: true } });

		// Source order, not set order and not sorted: the author wrote a sequence.
		expect(requests[0]?.prompt).toBe("First line.\nOnly when approved.\nLast line.");
	});

	it("Scenario: A conditional prompt line — absent from the composed prompt when the condition does not hold", async () => {
		const { port, requests } = recordingPort(answered());

		await run(CONDITIONAL, { port });

		expect(requests[0]?.prompt).toBe("First line.\nLast line.");
		expect(requests[0]?.prompt).not.toContain("Only when approved.");
	});

	it("Scenario: Logic never consults the model — no model turn is made for a logic line", async () => {
		const { port, requests } = recordingPort(answered());

		// Directly: composition is where conditionals are decided and `set` lines
		// applied, and it takes no port at all — there is no argument through which
		// it could reach one.
		const parsed = analyze(LOGIC_ONLY).parsed;
		const gate = readSubagents(parsed).get("gate");
		const variables = new Map<string, VariableValue>([
			["stage", "proposal"],
			["approved", true],
		]);
		const composed = compose(procedureStatements(gate!), variables);

		expect(requests).toHaveLength(0);
		expect(variables.get("stage")).toBe("specs");
		expect(composed.prompt).toBe("");

		// And through the whole runner: a subagent whose every line is logic
		// produces a decided outcome and not one dispatch. Routing that `if`
		// through the model would give the model a vote on the gate it is held to.
		const result = await run(LOGIC_ONLY, { port });
		expect(requests).toHaveLength(0);
		expect(result.kind).toBe("completed");
		expect(result.variables["stage"]).toBe("specs");
	});
});

/**
 * One subagent over the given declarations and instruction lines. Asserted
 * lint-clean wherever it is used, for the reason `CONDITIONAL` lives in the
 * fixtures: a document the dialect rejects proves nothing about the dialect's
 * language.
 */
function promptDocument(declarations: readonly string[], statements: readonly string[]): string {
	return [
		"variables:",
		...declarations.map((line) => `    ${line}`),
		"",
		"subagent draft:",
		'    description: "Draft it"',
		"",
		"    reasoning:",
		"        instructions: ->",
		...statements.map((line) => `            ${line}`),
		"",
	].join("\n");
}

async function promptOf(
	source: string,
	variables?: Readonly<Record<string, VariableValue>>,
): Promise<string | undefined> {
	expect(analyze(source).diagnostics.map((d) => d.message)).toEqual([]);
	const { port, requests } = recordingPort(answered());
	await run(source, { port, ...(variables !== undefined ? { variables } : {}) });
	expect(requests).toHaveLength(1);
	return requests[0]?.prompt;
}

describe("core-composition: An unreached prompt line leaves no trace", () => {
	it("Scenario: The else branch supplies the prompt line", async () => {
		const source = promptDocument(
			["excited: mutable boolean = False"],
			[
				"if @variables.excited:",
				"    | Wave goodbye with great enthusiasm!",
				"else:",
				"    | Say a calm goodbye.",
			],
		);

		const prompt = await promptOf(source);

		expect(prompt).toBe("Say a calm goodbye.");
		expect(prompt).not.toContain("enthusiasm");
		// And the other way round, so the else is not simply always chosen.
		expect(await promptOf(source, { excited: true })).toBe("Wave goodbye with great enthusiasm!");
	});
});

describe("core-composition: Statements run top to bottom and branch on truthiness", () => {
	const NESTED = promptDocument(
		["a: mutable boolean = True", "b: mutable boolean = False"],
		["if @variables.a:", "    if @variables.b:", "        | Both.", "| Always."],
	);

	it("Scenario: A set feeds a later condition", async () => {
		const source = promptDocument(
			["count: mutable number = 0"],
			["set @variables.count = 2", "if @variables.count > 1:", "    | Many."],
		);

		// `count` is authored as 0 and the condition would fail on it: only the
		// `set` above the `if` makes the body reachable.
		expect(await promptOf(source)).toBe("Many.");
	});

	it("Scenario: A nested if is refused before running", async () => {
		const { port, requests } = recordingPort(answered());
		const refusal = await run(NESTED, { port }).then(
			() => undefined,
			(error: unknown) => error,
		);

		expect(refusal).toBeInstanceOf(UnparsedDocumentError);
		const messages = (refusal as UnparsedDocumentError).diagnostics.map((d) => d.message);
		expect(messages.some((m) => m.includes("does not support nested 'if' statements"))).toBe(true);
		expect(requests).toHaveLength(0);
	});
});

describe("core-composition: An interpolation reads the value at the moment it is reached", () => {
	it("Scenario: A later prompt line sees an earlier set", async () => {
		const source = promptDocument(
			['stage: mutable string = "proposal"'],
			["| Review the {!@variables.stage}.", 'set @variables.stage = "specs"', "| Draft the {!@variables.stage}."],
		);

		// The first line was reached before the `set`, the second after it.
		expect(await promptOf(source)).toBe("Review the proposal.\nDraft the specs.");
	});
});

describe("core-composition: Interpolation is read from the parse", () => {
	it("Scenario: Numbers and booleans render in JavaScript's spelling", async () => {
		const source = promptDocument(
			["count: mutable number = 3", "approved: mutable boolean = False"],
			["| Count {!@variables.count}, approved {!@variables.approved}."],
		);

		const prompt = await promptOf(source);

		// `false`, not the dialect's `False`: a rendered value is `String(value)`.
		expect(prompt).toBe("Count 3, approved false.");
		expect(prompt).not.toContain("False");
	});
});
