import { describe, expect, it } from "vitest";
import {
	EmptyPromptError,
	NoEntrySubagentError,
	UnparsedDocumentError,
	run,
	type StepOutcome,
} from "../src/interpreter/index.js";
import {
	IN_SUBSET,
	NO_SUBAGENT,
	STRUCTURED_WITHOUT_PROMPT,
	UNTERMINATED_STRING,
} from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

/** Run and hand back whatever came out, thrown or returned. */
async function attempt(source: string, options: Record<string, unknown> = {}) {
	const { port, requests } = recordingPort(answered());
	const outcome = await run(source, { port, ...options }).then(
		(result) => ({ result, error: undefined }),
		(error: unknown) => ({ result: undefined, error }),
	);
	return { ...outcome, requests };
}

describe("platform-agentscript-interpreter: A Half-Written Document Is Refused, Not Run", () => {
	it("Scenario: An unterminated string — refused before execution, naming the diagnostic and its position", async () => {
		// The parser is error-TOLERANT: it recovers, swallows the rest of the line
		// and hands back a tree. The subset scan walks that recovered tree and finds
		// nothing wrong with it, because what went wrong is no longer in it. So the
		// diagnostics were the only thing that could refuse this document — and
		// `run()` read `analyze(source).parsed` and dropped `.diagnostics` on the
		// floor. The run reported `completed`, with `stage` holding "unterminated",
		// a value the author never wrote and the recovery invented.
		const { result, error, requests } = await attempt(UNTERMINATED_STRING);

		expect(result, "the document ran").toBeUndefined();
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect(requests, "a step was dispatched before the refusal").toHaveLength(0);

		const refusal = error as UnparsedDocumentError;
		expect(refusal.diagnostics.map((d) => d.message)).toEqual(['Missing "']);
		// Named WITH its position, so a caller can point at it rather than at the
		// file: the unterminated string is on source line 10.
		expect(refusal.message).toContain('Missing "');
		expect(refusal.message).toMatch(/Missing " at 10:\d+/);
		// And the invented value is nowhere in it.
		expect(refusal.message).not.toContain("unterminated");
	});

	it("Scenario: A warning is not a refusal — only error severity stops a run", async () => {
		// The other direction, so the gate is not just "refuse everything". A
		// document that lints clean runs, and a document carrying only hints would
		// too: refusing on a deprecation notice would make the runner unusable.
		const { result, error } = await attempt(IN_SUBSET);
		expect(error).toBeUndefined();
		expect(result?.kind).toBe("completed");
	});
});

describe("platform-agentscript-interpreter: A Run That Would Dispatch Nothing Is Refused", () => {
	it("Scenario: A document with no subagent — refused, not reported completed", async () => {
		// `UnreadableDocumentError` exists because "a run that dispatches nothing,
		// reports completed and looks exactly like a document with no work in it"
		// is unacceptable. This was that, one branch over: `{kind:"completed",
		// steps:[], variables:{}}`.
		const { result, error } = await attempt(NO_SUBAGENT);

		expect(result).toBeUndefined();
		expect(error).toBeInstanceOf(NoEntrySubagentError);
		expect((error as Error).message).toContain("(none)");
	});

	it("Scenario: An explicitly empty entry list — refused the same way", async () => {
		const { result, error } = await attempt(IN_SUBSET, { entry: [] });

		expect(result).toBeUndefined();
		expect(error).toBeInstanceOf(NoEntrySubagentError);
		// It names what the document DID declare, so the caller can see the typo.
		expect((error as Error).message).toContain("draft");
	});

	it("Scenario: An empty prompt with a structured result — refused rather than dispatched", async () => {
		// The empty-prompt skip only fired when there was ALSO nothing pending, so
		// a subagent whose prompt line sat behind a condition that did not hold
		// still dispatched `{ systemInstructions: "", prompt: "" }` WITH a schema —
		// asking the model literally nothing and paying for the answer, which is
		// the exact cost the skip exists to avoid.
		const { result, error, requests } = await attempt(STRUCTURED_WITHOUT_PROMPT);

		expect(result).toBeUndefined();
		expect(error).toBeInstanceOf(EmptyPromptError);
		expect(requests, "the model was asked nothing, and billed for it").toHaveLength(0);
		// It names the field the step was waiting on, which is what tells the
		// author which `set` line is stranded.
		expect((error as Error).message).toContain("verdict");
	});
});

describe("platform-agentscript-interpreter: A Step Ends Answered, Cut Short, Or Failed, And Says Which", () => {
	/**
	 * Drive one reported outcome through the runner and hand back what settled.
	 *
	 * Deliberately NOT `recordingPort`: its `answer ?? { kind: "answered" }`
	 * substitutes a valid outcome for a null one, which is the very case here.
	 * A helper that repairs the input cannot test what happens to bad input.
	 */
	async function settle(reported: unknown) {
		const requests: unknown[] = [];
		const port = {
			async reason(request: unknown) {
				requests.push(request);
				return reported as StepOutcome;
			},
		};
		const result = await run(IN_SUBSET, { port });
		return { result, outcome: result.steps[0]?.outcome, requests };
	}

	it("Scenario: A kind the set does not name — a failure that says so, not a fourth run kind", async () => {
		// `normalise` guarded `category` and left `kind` — the DISCRIMINANT —
		// untouched, so a port answering `{kind:"exploded"}` produced
		// `RunResult.kind === "exploded"` against a type declaring three strings.
		// A caller switching on it falls through every arm.
		const { result, outcome } = await settle({ kind: "exploded", text: "?" });

		expect(["completed", "cut-short", "failed"]).toContain(result.kind);
		expect(result.kind).toBe("failed");
		expect(outcome?.kind).toBe("failed");
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		// Named, and carrying what was reported — not folded into a category.
		expect(outcome.message).toContain("exploded");
		expect(outcome.category).toBe("unknown");
	});

	it("Scenario: A port that answers nothing at all — a failure, not a TypeError out of the runner", async () => {
		// `null` threw `Cannot read properties of null (reading 'kind')` from inside
		// the runner, which reaches a caller as a crash rather than as a step that
		// failed.
		const { result, outcome } = await settle(null);

		expect(result.kind).toBe("failed");
		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(outcome.message).toContain("null");
		expect(outcome.category).toBe("unknown");
	});

	it("Scenario: A failure with no message — still a failure, and still says something", async () => {
		const { outcome } = await settle({ kind: "failed", category: "rate_limit" });

		if (outcome?.kind !== "failed") throw new Error("expected a failure");
		expect(outcome.category).toBe("rate_limit");
		expect(outcome.message).toBe("the port reported a failure with no message");
	});
});
