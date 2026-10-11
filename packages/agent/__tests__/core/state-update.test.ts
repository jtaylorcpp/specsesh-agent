import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { run } from "../../src/interpreter/index.js";
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

/** One subagent over the given declarations and instruction lines. */
function stepDocument(declarations: readonly string[], statements: readonly string[]): string {
	return [
		"variables:",
		...declarations.map((line) => `    ${line}`),
		"",
		"subagent judge:",
		'    description: "Decide"',
		"",
		"    reasoning:",
		"        instructions: ->",
		...statements.map((line) => `            ${line}`),
		"",
	].join("\n");
}

function lintMessages(source: string): string[] {
	return analyze(source).diagnostics.map((d) => d.message);
}

describe("core-composition: The result schema is derived from the pending assignments", () => {
	it("Scenario: Schema for a string and a boolean field", async () => {
		const source = stepDocument(
			['verdict: mutable string = ""', "approved: mutable boolean = False"],
			["| Judge the artifact.", "set @variables.verdict = @outputs.verdict", "set @variables.approved = @outputs.ok"],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port, requests } = recordingPort({ kind: "answered", text: "", structured: { verdict: "v", ok: true } });

		await run(source, { port });

		expect(requests[0]?.outputSchema).toEqual({
			type: "object",
			properties: { verdict: { type: "string" }, ok: { type: "boolean" } },
			required: ["verdict", "ok"],
			additionalProperties: false,
		});
	});

	it("Scenario: Type drives the result schema", async () => {
		// The dialect accepts the type name `integer` but reports a warning for its
		// only possible default, a number literal ("declared as 'integer' but
		// default value is 'number'"). The warning is not an error, so the runner
		// proceeds; it is pinned here so the fixture's one imperfection is stated.
		const source = stepDocument(
			["count: mutable integer = 0"],
			["| Count the artifacts.", "set @variables.count = @outputs.n"],
		);
		expect(lintMessages(source)).toEqual([
			"Type mismatch: variable 'count' is declared as 'integer' but default value is 'number'",
		]);
		const { port, requests } = recordingPort({ kind: "answered", text: "", structured: { n: 4 } });

		const result = await run(source, { port });

		expect(requests[0]?.outputSchema).toEqual({
			type: "object",
			properties: { n: { type: "number" } },
			required: ["n"],
			additionalProperties: false,
		});
		expect(result.variables["count"]).toBe(4);
	});

	it("Scenario: One field feeding two variables is required once", async () => {
		const source = stepDocument(
			['a: mutable string = ""', "b: mutable number = 0"],
			["| Judge the artifact.", "set @variables.a = @outputs.v", "set @variables.b = @outputs.v"],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port, requests } = recordingPort({ kind: "answered", text: "", structured: { v: 7 } });

		const result = await run(source, { port });

		const schema = requests[0]?.outputSchema as { required: string[]; properties: Record<string, unknown> };
		expect(schema.required).toEqual(["v"]);
		// `a` is a string and `b` a number: the later assignment, `b`, names the type.
		expect(schema.properties["v"]).toEqual({ type: "number" });
		expect(Object.keys(schema.properties)).toEqual(["v"]);
		expect(result.variables["a"]).toBe(7);
		expect(result.variables["b"]).toBe(7);
	});

	it("Scenario: A text-only step carries no schema", async () => {
		const source = stepDocument(['stage: mutable string = "proposal"'], ["| Read the {!@variables.stage}.", "| Summarise it."]);
		expect(lintMessages(source)).toEqual([]);
		const { port, requests } = recordingPort({ kind: "answered", text: "done" });

		await run(source, { port });

		expect(requests).toHaveLength(1);
		// Absent, not `undefined`: the key itself is not on the request.
		expect(Object.keys(requests[0] ?? {})).toEqual(["systemInstructions", "prompt"]);
		expect("outputSchema" in (requests[0] ?? {})).toBe(false);
	});
});

describe("core-composition: Assignments from the structured result wait for the answer", () => {
	it("Scenario: A pending set on an untaken branch asks for nothing", async () => {
		const source = stepDocument(
			['verdict: mutable string = "undecided"', "approved: mutable boolean = False"],
			["| Judge the artifact.", "if @variables.approved:", "    set @variables.verdict = @outputs.verdict"],
		);
		expect(lintMessages(source)).toEqual([]);
		const { port, requests } = recordingPort({ kind: "answered", text: "fine" });

		const result = await run(source, { port });

		expect(requests).toHaveLength(1);
		expect("outputSchema" in (requests[0] ?? {})).toBe(false);
		// Nothing was asked for, so an answer with no structured result is not a failure.
		expect(result.kind).toBe("completed");
		expect(result.variables["verdict"]).toBe("undecided");

		// Taken, the same set does ask: the branch is what decided it, not the document.
		const taken = recordingPort({ kind: "answered", text: "", structured: { verdict: "approved" } });
		const takenResult = await run(source, { port: taken.port, variables: { approved: true } });
		expect(taken.requests[0]?.outputSchema).toBeDefined();
		expect(takenResult.variables["verdict"]).toBe("approved");
	});
});

describe("core-composition: A partial or malformed result sets nothing", () => {
	const THREE_FIELDS = stepDocument(
		['a: mutable string = "a0"', 'b: mutable string = "b0"', 'c: mutable string = "c0"'],
		["| Judge the artifact.", "set @variables.a = @outputs.a", "set @variables.b = @outputs.b", "set @variables.c = @outputs.c"],
	);

	it("Scenario: A partial result leaves no variable half-written", async () => {
		expect(lintMessages(THREE_FIELDS)).toEqual([]);
		const { port } = recordingPort({ kind: "answered", text: "", structured: { a: "a1", b: "b1" } });

		const result = await run(THREE_FIELDS, { port });

		expect(result.kind).toBe("failed");
		const outcome = result.steps[0]?.outcome;
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(outcome.category).toBe("unknown");
		expect(outcome.message).toContain('"c"');
		expect(outcome.message).toContain("@variables.c");
		expect(outcome.message).toContain("No variable was set");
		// `a` and `b` arrived and were valid, and they are not written either.
		expect(result.variables).toEqual({ a: "a0", b: "b0", c: "c0" });
	});

	it("Scenario: A value of the wrong JSON shape is refused", async () => {
		for (const wrong of [null, {}]) {
			const { port } = recordingPort({ kind: "answered", text: "", structured: { a: "a1", b: "b1", c: wrong } });

			const result = await run(THREE_FIELDS, { port });

			expect(result.kind, `c = ${JSON.stringify(wrong)}`).toBe("failed");
			const outcome = result.steps[0]?.outcome;
			if (outcome?.kind !== "failed") throw new Error("expected a failure");
			expect(outcome.message).toContain('"c"');
			expect(outcome.message).toContain("No variable was set");
			expect(result.variables).toEqual({ a: "a0", b: "b0", c: "c0" });
		}
	});
});
