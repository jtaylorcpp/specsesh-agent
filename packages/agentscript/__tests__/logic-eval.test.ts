import { describe, expect, it } from "vitest";
import { analyze } from "../src/authoring/index.js";
import type { VariableValue } from "../src/interpreter/index.js";
import { run } from "../src/interpreter/index.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

/**
 * A logic-only document: declarations and statements, and nothing a model is
 * asked. Built from the pieces a scenario is about, so each test reads as the
 * scenario's GIVEN. Every document is asserted lint-clean before it runs — the
 * runner refuses error diagnostics, but a warning would pass it, and a fixture
 * that is merely runnable is not one an author could save.
 */
function logicDocument(declarations: readonly string[], statements: readonly string[]): string {
	return [
		"variables:",
		...declarations.map((line) => `    ${line}`),
		"",
		"subagent decide:",
		'    description: "Decide"',
		"",
		"    reasoning:",
		"        instructions: ->",
		...statements.map((line) => `            ${line}`),
		"",
	].join("\n");
}

/** Run a logic-only document and return its variables, proving no model was asked. */
async function evaluate(
	source: string,
	variables?: Readonly<Record<string, VariableValue>>,
): Promise<Readonly<Record<string, VariableValue>>> {
	expect(analyze(source).diagnostics.map((d) => d.message)).toEqual([]);
	const { port, requests } = recordingPort(answered());
	const result = await run(source, { port, ...(variables !== undefined ? { variables } : {}) });
	expect(result.kind).toBe("completed");
	expect(requests).toHaveLength(0);
	return result.variables;
}

describe("core-composition: Literals and references evaluate to their values", () => {
	it("Scenario: A set copies one variable into another", async () => {
		const source = logicDocument(
			['a: mutable string = "x"', 'b: mutable string = ""'],
			["set @variables.b = @variables.a"],
		);

		const variables = await evaluate(source);

		expect(variables["b"]).toBe("x");
		expect(variables["a"]).toBe("x");
	});
});

describe("core-composition: not, and and or combine truthiness", () => {
	it("Scenario: and, or and not combine conditions", async () => {
		const source = logicDocument(
			["approved: mutable boolean = False", "count: mutable number = 2", 'stage: mutable string = "proposal"'],
			[
				"if not @variables.approved and @variables.count > 1:",
				'    set @variables.stage = "taken"',
			],
		);

		const variables = await evaluate(source);

		expect(variables["stage"]).toBe("taken");

		// Flip one operand and the same condition fails: `and` needs both sides.
		const refused = await evaluate(source, { approved: true });
		expect(refused["stage"]).toBe("proposal");
	});

	it("Scenario: or takes either side", async () => {
		const source = logicDocument(
			["a: mutable boolean = False", "b: mutable boolean = True", 'stage: mutable string = "proposal"'],
			["if @variables.a or @variables.b:", '    set @variables.stage = "taken"'],
		);

		// The right side decides it.
		expect((await evaluate(source))["stage"]).toBe("taken");
		// And the left side decides it just as well.
		expect((await evaluate(source, { a: true, b: false }))["stage"]).toBe("taken");
		// Neither side: the body is not taken, so `or` is not simply "true".
		expect((await evaluate(source, { a: false, b: false }))["stage"]).toBe("proposal");
	});
});

describe("core-composition: Comparisons are strict", () => {
	it("Scenario: Strict equality does not coerce", async () => {
		const source = logicDocument(
			["count: mutable number = 1", 'stage: mutable string = "proposal"'],
			['if @variables.count == "1":', '    set @variables.stage = "matched"'],
		);

		const variables = await evaluate(source);

		// `1 == "1"` is false here, where JavaScript's `==` would say true.
		expect(variables["stage"]).toBe("proposal");
	});

	it("Scenario: A set stores a computed boolean", async () => {
		const source = logicDocument(
			["count: mutable number = 5", "big: mutable boolean = False"],
			["set @variables.big = @variables.count > 3"],
		);

		const variables = await evaluate(source);

		expect(variables["big"]).toBe(true);
	});
});

describe("core-composition: Truthiness is stated once", () => {
	const TRUTHINESS: readonly {
		readonly type: string;
		readonly literal: string;
		readonly value: VariableValue;
		readonly truthy: boolean;
	}[] = [
		{ type: "number", literal: "0", value: 0, truthy: false },
		{ type: "string", literal: '""', value: "", truthy: false },
		{ type: "boolean", literal: "False", value: false, truthy: false },
		{ type: "number", literal: "1", value: 1, truthy: true },
		{ type: "string", literal: '"x"', value: "x", truthy: true },
		{ type: "boolean", literal: "True", value: true, truthy: true },
	];

	it("Scenario: Truthiness per type", async () => {
		for (const { type, literal, value, truthy } of TRUTHINESS) {
			const source = logicDocument(
				[`v: mutable ${type} = ${literal}`, "taken: mutable boolean = False"],
				["if @variables.v:", "    set @variables.taken = True"],
			);

			const variables = await evaluate(source);

			expect(variables["v"], `${literal} survives the run`).toBe(value);
			expect(variables["taken"], `${literal} is ${truthy ? "truthy" : "falsy"}`).toBe(truthy);
		}
	});

	it("Scenario: A non-empty string that says False is truthy", async () => {
		const source = logicDocument(
			['flag: mutable string = "False"', 'stage: mutable string = "proposal"'],
			["if @variables.flag:", '    set @variables.stage = "taken"'],
		);

		const variables = await evaluate(source);

		expect(variables["stage"]).toBe("taken");
	});
});
