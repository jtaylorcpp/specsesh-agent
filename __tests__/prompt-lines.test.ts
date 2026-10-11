import { describe, expect, it } from "vitest";
import { analyze } from "../src/authoring/index.js";
import { compose, procedureStatements, readSubagents } from "../src/interpreter/compose.js";
import type { VariableValue } from "../src/interpreter/index.js";
import { run } from "../src/interpreter/index.js";
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
