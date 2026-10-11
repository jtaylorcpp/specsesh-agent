import { describe, expect, it } from "vitest";
import { run } from "../src/interpreter/index.js";
import { STRUCTURED } from "./helpers/fixtures.js";
import { recordingPort } from "./helpers/recording-port.js";

describe("platform-agentscript-interpreter: A State Update Is Structured, And Prose Is Never Parsed For One", () => {
	it("Scenario: A structured update — a structured result is requested and only that result is applied", async () => {
		const { port, requests } = recordingPort({
			kind: "answered",
			// Text that disagrees with the structured result, deliberately: only one
			// of these two may reach the variable.
			text: "On reflection the verdict is rejected.",
			structured: { verdict: "approved" },
		});

		const result = await run(STRUCTURED, { port });

		// The request said what it wanted back, derived from the `set` line itself.
		expect(requests[0]?.outputSchema).toEqual({
			type: "object",
			properties: { verdict: { type: "string" } },
			required: ["verdict"],
			additionalProperties: false,
		});
		expect(result.kind).toBe("completed");
		expect(result.variables["verdict"]).toBe("approved");
	});

	it("Scenario: No structured result — the step is a failure and no variable is set", async () => {
		const { port } = recordingPort({ kind: "answered", text: "" });

		const result = await run(STRUCTURED, { port });

		expect(result.kind).toBe("failed");
		expect(result.steps[0]?.outcome.kind).toBe("failed");
		// The authored value, untouched — the step that was meant to write it did
		// not, and a run that failed must not look like one that decided.
		expect(result.variables["verdict"]).toBe("undecided");
	});

	it("Scenario: Prose is not parsed for state — text with no structured result sets no variable", async () => {
		// Text engineered to be readable as the value by anything willing to try:
		// a bare word, a JSON object, and a labelled field.
		for (const text of [
			"approved",
			'{"verdict": "approved"}',
			"verdict: approved",
			"VERDICT = approved",
		]) {
			const { port } = recordingPort({ kind: "answered", text });

			const result = await run(STRUCTURED, { port });

			expect(result.variables["verdict"], `parsed "${text}" for state`).toBe("undecided");
			expect(result.kind).toBe("failed");
			if (result.steps[0]?.outcome.kind !== "failed") throw new Error("expected a failure");
			// The failure names what was missing rather than quietly succeeding —
			// these variables gate stages, so the wrong value is the difference
			// between refusing an artifact and waving it through.
			expect(result.steps[0].outcome.message).toContain("verdict");
			expect(result.steps[0].outcome.message).toContain("received none");
		}
	});
});
