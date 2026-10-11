import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import type { StepOutcome } from "../../src/interpreter/index.js";
import { run } from "../../src/interpreter/index.js";
import { IN_SUBSET, TWO_STEPS } from "./helpers/fixtures.js";
import { recordingPort } from "./helpers/recording-port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir = join(PKG_DIR, "src")): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

/** Run the standard document against one reported outcome and hand back the settled one. */
async function settle(reported: StepOutcome) {
	const { port, requests } = recordingPort(reported);
	const result = await run(IN_SUBSET, { port });
	return { result, outcome: result.steps[0]?.outcome, requests };
}

/**
 * A document of `count` identical subagents, run end to end.
 *
 * Built rather than fixtured because the point is the COUNT: whatever number is
 * chosen, no bound is reached, because there is no bound here to reach.
 */
async function manySteps(count: number) {
	const names = Array.from({ length: count }, (_, i) => `step_${i}`);
	const source = names
		.map(
			(name) =>
				`subagent ${name}:\n    description: "one of many"\n\n    reasoning:\n        instructions: ->\n            | Do the thing.\n`,
		)
		.join("\n");
	// The document is one an author could save, like every other fixture here.
	expect(analyze(source).diagnostics.map((d) => d.message)).toEqual([]);
	const { port, requests } = recordingPort({ kind: "answered", text: "ok" });
	const result = await run(source, { port, entry: names });
	return { result, requests };
}

describe("platform-agentscript-interpreter: A Step Ends Answered, Cut Short, Or Failed, And Says Which", () => {
	it("Scenario: The implementation reports a step stopped at its bound — the step settles as cut short", async () => {
		const { result, outcome } = await settle({
			kind: "cut-short",
			text: "I got as far as the outline",
			turns: 7,
		});

		// Carried through unchanged: the partial text and the implementation's own
		// count, neither re-derived here.
		expect(outcome).toEqual({ kind: "cut-short", text: "I got as far as the outline", turns: 7 });
		// And the run says so. A partial answer presented as a finished one is the
		// failure this codebase keeps finding in other guises.
		expect(result.kind).toBe("cut-short");
		expect(outcome?.kind).not.toBe("answered");
	});

	it("Scenario: The interpreter imposes no bound of its own — it passes none and counts none", async () => {
		const { requests } = await settle({ kind: "answered", text: "done" });

		// The dispatched request carries no bound field, under any spelling.
		const request = requests[0] as unknown as Record<string, unknown>;
		expect(Object.keys(request)).toEqual(["systemInstructions", "prompt"]);
		for (const key of Object.keys(request)) {
			expect(key).not.toMatch(/round|bound|limit|max|turn|budget|attempt/i);
		}

		// Nor does it count. The BEHAVIOURAL half, because the grep below is a
		// spelling check and a counter spelled `let n = 0; n += 1` walks past it:
		// drive many steps through one run and assert nothing accumulates — no
		// bound is ever reached, every step still answers, and the run stays
		// `completed` however many steps it takes.
		const many = await manySteps(12);
		expect(many.result.steps).toHaveLength(12);
		expect(many.result.kind).toBe("completed");
		expect(many.requests).toHaveLength(12);
		for (const request of many.requests) {
			expect(Object.keys(request)).toEqual(["systemInstructions", "prompt"]);
		}
		// And the twelfth step's request is byte-identical to the first's: nothing
		// the runner holds grew as steps accumulated, which is what "imposes no
		// bound of its own" means operationally.
		expect(many.requests.at(-1)).toEqual(many.requests[0]);

		// The spelling check stays as a cheap second signal, not as the assertion.
		for (const file of sourceFiles()) {
			const code = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			expect(code, `${file} counts turns`).not.toMatch(/\b(turnCount|roundCount|turns\s*\+\+)/);
		}

		// Proof of the same fact from the other side: a step that answered stays
		// answered no matter how long its text is or what shape the answer takes.
		const long = await settle({ kind: "answered", text: "x".repeat(50_000) });
		expect(long.outcome?.kind).toBe("answered");
	});

	it("Scenario: An exhausted rate limit — the outcome carries the rate-limit category", async () => {
		const { outcome } = await settle({
			kind: "failed",
			category: "rate_limit",
			message: "usage limit reached; resets at 4pm",
		});

		expect(outcome).toEqual({
			kind: "failed",
			category: "rate_limit",
			message: "usage limit reached; resets at 4pm",
		});

		// Distinguishable without reading the message: today an exhausted window
		// reaches a caller as an opaque string and nothing downstream can tell it
		// apart from a bad prompt.
		const generation = await settle({
			kind: "failed",
			category: "billing_error",
			message: "usage limit reached; resets at 4pm",
		});
		expect(generation.outcome).not.toEqual(outcome);
		if (outcome?.kind !== "failed" || generation.outcome?.kind !== "failed") {
			throw new Error("both outcomes should be failures");
		}
		expect(outcome.category).not.toBe(generation.outcome.category);
		expect(outcome.message).toBe(generation.outcome.message);
	});

	it("Scenario: A category the set does not name — unrecognised, carrying the original message", async () => {
		// A foreign implementation is not bound by our union at run time.
		const { outcome } = await settle({
			kind: "failed",
			category: "quota_exceeded" as never,
			message: "the workspace quota is spent",
		});

		expect(outcome).toEqual({
			kind: "failed",
			category: "unrecognised",
			message: "the workspace quota is spent",
		});
		// Not mapped to the nearest known one: "probably a rate limit" is how a
		// billing failure gets retried forever.
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(outcome.category).not.toBe("rate_limit");
	});

	it("Scenario: No category is reported — unknown, and not defaulted to a named one", async () => {
		const { outcome } = await settle({
			kind: "failed",
			message: "something went wrong",
		} as StepOutcome);

		expect(outcome).toEqual({
			kind: "failed",
			category: "unknown",
			message: "something went wrong",
		});
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(["authentication_failed", "oauth_org_not_allowed", "billing_error", "rate_limit"]).not.toContain(
			outcome.category,
		);
		// `unknown` and `unrecognised` are different facts: one says nobody named a
		// category, the other says someone named one we do not know.
		expect(outcome.category).not.toBe("unrecognised");
	});
	it("Regression: a port's own `unknown` stays `unknown`, not `layer_unknown`", async () => {
		// The port is typed to report OUR category. `run()` used to pass it through
		// `toFailureCategory` again, which renames the layer's "unknown" — so a port
		// saying "nobody named a category" came out as "the layer said unknown".
		const { outcome } = await settle({ kind: "failed", category: "unknown", message: "boom" });
		expect(outcome).toEqual({ kind: "failed", category: "unknown", message: "boom" });
	});

	it("Regression: every one of our categories survives the runner unchanged", async () => {
		for (const category of ["layer_unknown", "unrecognised", "unknown", "rate_limit", "max_output_tokens"] as const) {
			const { outcome } = await settle({ kind: "failed", category, message: "m" });
			expect(outcome, category).toEqual({ kind: "failed", category, message: "m" });
		}
	});
});

describe("platform-agentscript-interpreter: A run's kind comes from its last step", () => {
	it("Scenario: A failed step ends the run", async () => {
		const failure: StepOutcome = { kind: "failed", category: "billing_error", message: "out of credit" };
		const { port, requests } = recordingPort(failure, { kind: "answered", text: "never asked" });
		const result = await run(TWO_STEPS, { port, entry: ["first", "second"] });

		expect(result.kind).toBe("failed");
		expect(requests).toHaveLength(1);
		expect(requests[0]?.prompt).toBe("Draft the proposal.");
		expect(result.steps.map((s) => s.subagent)).toEqual(["first"]);
		expect(result.steps[0]?.outcome).toEqual(failure);
		// `first` set stage by logic in the same step; the failure rolled it back.
		expect(result.variables.stage).toBe("proposal");
	});
});

describe("platform-agentscript-interpreter: A reported failure keeps our category and its message", () => {
	it("Scenario: A foreign category is normalised", async () => {
		const { outcome } = await settle({ kind: "failed", category: "quota_exceeded" as never, message: "m" });
		expect(outcome).toEqual({ kind: "failed", category: "unrecognised", message: "m" });
	});
});

describe("platform-agentscript-interpreter: A port's return value is never trusted to be well-formed", () => {
	it("Scenario: A port that answers a string", async () => {
		const port = { reason: async () => "ok" as unknown as StepOutcome };
		const result = await run(IN_SUBSET, { port });

		expect(result.kind).toBe("failed");
		expect(result.steps).toHaveLength(1);
		const outcome = result.steps[0]?.outcome;
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(outcome.category).toBe("unknown");
		expect(outcome.message.startsWith("the port returned string")).toBe(true);
		expect(outcome.message).toContain("rather than an outcome");
	});
});
