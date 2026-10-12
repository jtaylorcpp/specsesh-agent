import { describe, expect, it } from "vitest";
import { type RunState, apply, next, start } from "../../src/interpreter/index.js";

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

const CHOICES = { next_action: ["retry", "amend-spec", "ask"] };
const PROSE = { met: false, next_action: "retry. Both questions can be settled" };

const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function awaitingState(choices?: Record<string, string[]>): RunState {
	const step = next(JUDGE, start(JUDGE, choices === undefined ? {} : { choices }));
	if (step.type !== "request") throw new Error("expected a request");
	return step.state;
}

function answer(state: RunState, structured: Record<string, unknown>): RunState {
	return apply(JUDGE, state, { kind: "answered", text: "", structured } as never);
}

describe("core-composition: A result outside a variable's choices sets nothing", () => {
	it("Scenario: Prose in a chosen field fails the step", () => {
		const done = answer(awaitingState(CHOICES), PROSE);
		const outcome = done.steps.at(-1)?.outcome;
		expect(outcome?.kind).toBe("failed");
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(outcome.category).toBe("unknown");
		for (const part of ["next_action", "@variables.next_action", '"retry"', '"amend-spec"', '"ask"', "No variable was set"]) {
			expect(outcome.message).toContain(part);
		}
		expect(done.stopped).toBe("failed");
		expect(done.variables["met"]).toBe(false);
		expect(done.variables["next_action"]).toBe("retry");
	});

	it("leaves a valid sibling field unset when another field is refused", () => {
		const done = answer(awaitingState(CHOICES), { met: true, next_action: "nope" });
		expect(done.stopped).toBe("failed");
		expect(done.variables["met"]).toBe(false);
	});

	it("applies a value in the choices normally", () => {
		const done = answer(awaitingState(CHOICES), { met: true, next_action: "ask" });
		expect(done.stopped).toBeUndefined();
		expect(done.variables["met"]).toBe(true);
		expect(done.variables["next_action"]).toBe("ask");
	});

	it("still refuses prose after the state round-trips through JSON", () => {
		const done = answer(persist(awaitingState(CHOICES)), PROSE);
		expect(done.steps.at(-1)?.outcome.kind).toBe("failed");
		expect(done.variables["next_action"]).toBe("retry");
	});

	it("takes any string when the run has no choices", () => {
		const done = answer(awaitingState(), PROSE);
		expect(done.stopped).toBeUndefined();
		expect(done.variables["next_action"]).toBe(PROSE.next_action);
	});
});
