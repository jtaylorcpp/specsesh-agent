import { describe, expect, it } from "vitest";
import {
	InvalidChoicesError,
	UndeclaredOverrideError,
	next,
	run,
	start,
} from "../../src/interpreter/index.js";
import { recordingPort } from "./helpers/recording-port.js";

const JUDGE = `config:
    agent_name: "judge"

system:
    instructions: |
        You judge progress.

variables:
    met: mutable boolean = False
    next_action: mutable string = "retry"

subagent judge:
    description: "Judge"

    reasoning:
        instructions: ->
            | Judge the work.
            set @variables.met = @outputs.met
            set @variables.next_action = @outputs.next_action
`;

const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function refusal(call: () => unknown): InvalidChoicesError {
	try {
		call();
	} catch (error) {
		expect(error).toBeInstanceOf(InvalidChoicesError);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).name).toBe("InvalidChoicesError");
		return error as InvalidChoicesError;
	}
	throw new Error("start did not throw");
}

describe("core-composition: A host constrains string variables with choices", () => {
	it("Scenario: A choice on an undeclared variable is refused", () => {
		expect(refusal(() => start(JUDGE, { choices: { nope: ["a"] } })).message).toContain("nope");
	});

	it("Scenario: A choice on a boolean is refused", () => {
		const { message } = refusal(() => start(JUDGE, { choices: { met: ["yes"] } }));
		expect(message).toContain("met");
		expect(message).toContain("not a string");
	});

	it("Scenario: Choices must include the opening value", () => {
		const { message } = refusal(() => start(JUDGE, { choices: { next_action: ["ask"] } }));
		expect(message).toContain("next_action");
		expect(message).toContain('"retry"');
	});

	it("Scenario: An empty choice list is refused", () => {
		expect(refusal(() => start(JUDGE, { choices: { next_action: [] } })).message).toContain("next_action");
	});

	it("checks the opening value after an override, which takes precedence over the authored default", () => {
		const state = start(JUDGE, { variables: { next_action: "ask" }, choices: { next_action: ["ask"] } });
		expect(state.variables["next_action"]).toBe("ask");
		refusal(() => start(JUDGE, { variables: { next_action: "ask" }, choices: { next_action: ["retry"] } }));
	});

	it("refuses an undeclared override before it looks at the choices", () => {
		expect(() => start(JUDGE, { variables: { nope: "x" }, choices: { next_action: [] } })).toThrow(
			UndeclaredOverrideError,
		);
	});
});

describe("platform-agentscript-step-machine: choices in the run state", () => {
	it("Scenario: A choices refusal is identifiable by class and name", () => {
		refusal(() => start(JUDGE, { choices: { nope: ["a"] } }));
	});

	it("Scenario: Choices travel in the state", () => {
		const choices = { next_action: ["retry", "ask"] };
		const state = start(JUDGE, { choices });
		expect(state.choices).toEqual(choices);
		expect(state.choices).not.toBe(choices);
		expect(state.choices?.["next_action"]).not.toBe(choices.next_action);
		expect(persist(state)).toEqual(state);
		expect("choices" in start(JUDGE)).toBe(false);
		// Persisted through JSON, the choices still shape the request.
		const step = next(JUDGE, persist(state));
		if (step.type !== "request") throw new Error("expected a request");
		const properties = (step.request.outputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
		expect(properties["next_action"]?.enum).toEqual(["retry", "ask"]);
	});

	it("keeps the choices in the state next() hands on", () => {
		const step = next(JUDGE, start(JUDGE, { choices: { next_action: ["retry", "ask"] } }));
		if (step.type !== "request") throw new Error("expected a request");
		expect(step.state.choices).toEqual({ next_action: ["retry", "ask"] });
	});

	it("Scenario: run passes choices to start", async () => {
		const { port, requests } = recordingPort({ kind: "answered", text: "", structured: { met: true, next_action: "ask" } });
		const result = await run(JUDGE, { port, choices: { next_action: ["retry", "ask"] } });
		expect(result.kind).toBe("completed");
		expect(requests).toHaveLength(1);
		const properties = (requests[0]?.outputSchema as { properties: Record<string, { type?: string; enum?: string[] }> })
			.properties;
		expect(properties["next_action"]?.enum).toEqual(["retry", "ask"]);
		expect(properties["next_action"]?.type).toBe("string");
	});

	it("rejects a choices refusal from run() before any port call", async () => {
		const { port, requests } = recordingPort();
		await expect(run(JUDGE, { port, choices: { next_action: ["ask"] } })).rejects.toBeInstanceOf(InvalidChoicesError);
		expect(requests).toEqual([]);
	});
});
