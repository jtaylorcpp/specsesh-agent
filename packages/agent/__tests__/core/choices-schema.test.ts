import { describe, expect, it } from "vitest";
import { next, start } from "../../src/interpreter/index.js";

const document = (variables: string[], lines: string[]): string => `config:
    agent_name: "chooser"

system:
    instructions: |
        You choose.

variables:
${variables.map((line) => `    ${line}`).join("\n")}

subagent chooser:
    description: "Chooser"

    reasoning:
        instructions: ->
${lines.map((line) => `            ${line}`).join("\n")}
`;

const ACTION = document(
	['next_action: mutable string = "retry"'],
	["| Choose.", "set @variables.next_action = @outputs.next_action"],
);

const TWO = document(
	['a: mutable string = "x"', 'b: mutable string = "y"'],
	["| Choose.", "set @variables.a = @outputs.v", "set @variables.b = @outputs.v"],
);

const REVERSED = document(
	['a: mutable string = "x"', 'b: mutable string = "y"'],
	["| Choose.", "set @variables.b = @outputs.v", "set @variables.a = @outputs.v"],
);

const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function schemaOf(source: string, choices?: Record<string, string[]>, roundTrip = false): Record<string, unknown> {
	const state = start(source, choices !== undefined ? { choices } : {});
	const step = next(source, roundTrip ? persist(state) : state);
	if (step.type !== "request") throw new Error(`expected a request, got ${step.type}`);
	return step.request.outputSchema as Record<string, unknown>;
}

describe("core-composition: choices in the result schema", () => {
	it("Scenario: A chosen variable's field carries its values", () => {
		const values = ["retry", "amend-spec", "ask"];
		const schema = schemaOf(ACTION, { next_action: values });
		expect(schema["properties"]).toEqual({ next_action: { type: "string", enum: ["retry", "amend-spec", "ask"] } });
		expect(schema["required"]).toEqual(["next_action"]);
		const field = (schema["properties"] as Record<string, { enum: string[] }>)["next_action"];
		expect(field?.enum).not.toBe(values);
	});

	it("takes the enum of the later variable, as for type: chosen then not chosen", () => {
		const schema = schemaOf(TWO, { a: ["x", "p"] });
		expect(schema["properties"]).toEqual({ v: { type: "string" } });
		expect(schema["required"]).toEqual(["v"]);
	});

	it("takes the enum of the later variable, as for type: not chosen then chosen", () => {
		const schema = schemaOf(TWO, { b: ["y", "q"] });
		expect(schema["properties"]).toEqual({ v: { type: "string", enum: ["y", "q"] } });
		expect(schema["required"]).toEqual(["v"]);
		// Reversed, `a` is assigned last and has no choice: `b`'s values do not leak in.
		const reversed = schemaOf(REVERSED, { b: ["y", "q"] });
		expect(reversed["properties"]).toEqual({ v: { type: "string" } });
		expect(reversed["required"]).toEqual(["v"]);
	});

	it("adds no enum key without choices", () => {
		expect(schemaOf(ACTION)["properties"]).toEqual({ next_action: { type: "string" } });
		expect("enum" in ((schemaOf(ACTION)["properties"] as Record<string, object>)["next_action"] ?? {})).toBe(false);
	});

	it("gives the same schema from a state round-tripped through JSON", () => {
		const choices = { next_action: ["retry", "amend-spec", "ask"] };
		expect(schemaOf(ACTION, choices, true)).toEqual(schemaOf(ACTION, choices));
	});
});
