import { describe, expect, it } from "vitest";
import { analyze } from "../src/authoring/document.js";
import {
	RunStateError,
	SourceMismatchError,
	apply,
	next,
	run,
	start,
	type RunState,
	type StepOutcome,
} from "../src/interpreter/index.js";
import { IN_SUBSET } from "./helpers/fixtures.js";
import { recordingPort } from "./helpers/recording-port.js";

/**
 * Two model steps with deterministic logic between them, so a run has a real
 * middle to crash in: `classify` writes `severity` from a structured result,
 * `gate` is logic only, and `respond`'s prompt depends on what `gate` decided.
 */
const PIPELINE = `config:
    agent_name: "pipeline"

system:
    instructions: |
        You triage bug reports.

variables:
    report: mutable string = "it crashes"
    severity: mutable string = ""
    urgent: mutable boolean = False

subagent classify:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Classify: {!@variables.report}
            set @variables.severity = @outputs.severity

subagent gate:
    description: "Decide urgency without the model"

    reasoning:
        instructions: ->
            if @variables.severity == "high":
                set @variables.urgent = True

subagent respond:
    description: "Write the reply"

    reasoning:
        instructions: ->
            if @variables.urgent:
                | Write an urgent reply about: {!@variables.report}
            else:
                | Write a routine reply about: {!@variables.report}
`;

const ENTRIES = ["classify", "gate", "respond"];
const structured = (severity: string): StepOutcome => ({ kind: "answered", text: "", structured: { severity } });
const answered = (text: string): StepOutcome => ({ kind: "answered", text });

/** Round-trip through JSON, as a durable host's storage would. */
const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Drive the machine by hand, persisting the state between every call. */
function drive(source: string, answers: StepOutcome[], options: Parameters<typeof start>[1] = {}) {
	let state = persist(start(source, options));
	const prompts: string[] = [];
	for (let i = 0; ; i += 1) {
		const step = next(source, state);
		if (step.type === "done") return { result: step.result, prompts };
		prompts.push(step.request.prompt);
		state = persist(apply(source, persist(step.state), answers[i] ?? answered("ok")));
	}
}

describe("the pipeline fixture", () => {
	it("lints clean, so the tests below exercise the runner and not a parse recovery", () => {
		const errors = (analyze(PIPELINE).diagnostics as unknown as { severity?: number }[]).filter((d) => d.severity === 1);
		expect(errors).toEqual([]);
	});
});

describe("the step machine", () => {
	it("gives the same result as run(), with the state persisted between every call", async () => {
		const answers = [structured("high"), answered("On it.")];
		const { port } = recordingPort(...answers);
		const viaRun = await run(PIPELINE, { port, entry: ENTRIES });
		const { result } = drive(PIPELINE, answers, { entry: ENTRIES });
		expect(result).toEqual(viaRun);
		expect(result.kind).toBe("completed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "high", urgent: true });
	});

	it("runs a logic-only subagent between model steps without a request", () => {
		const { prompts, result } = drive(PIPELINE, [structured("high"), answered("ok")], { entry: ENTRIES });
		expect(prompts).toEqual(["Classify: it crashes", "Write an urgent reply about: it crashes"]);
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
	});

	it("follows the other branch when the logic decides differently", () => {
		const { prompts, result } = drive(PIPELINE, [structured("low"), answered("ok")], { entry: ENTRIES });
		expect(prompts[1]).toBe("Write a routine reply about: it crashes");
		expect(result.variables.urgent).toBe(false);
	});

	it("starts with no step awaiting and the authored values", () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		expect(state.awaiting).toBeUndefined();
		expect(state.cursor).toBe(0);
		expect(state.variables).toEqual({ report: "it crashes", severity: "", urgent: false });
	});

	it("takes starting overrides at start", () => {
		const { prompts } = drive(PIPELINE, [structured("low")], { entry: ENTRIES, variables: { report: "slow" } });
		expect(prompts[0]).toBe("Classify: slow");
	});
});

describe("replay after a crash", () => {
	it("next is pure: the same state gives the same request and state", () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		expect(next(PIPELINE, state)).toEqual(next(PIPELINE, persist(state)));
	});

	it("a host that crashed after next and before apply re-dispatches the same step", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const saved = persist(first.state);

		// The process dies here. A new one reloads `saved` and asks again.
		const again = next(PIPELINE, saved);
		if (again.type !== "request") throw new Error("expected a request");
		expect(again.request).toEqual(first.request);
		expect(again.state).toEqual(saved);
	});

	it("a host that crashed after apply carries on from the next step", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const afterClassify = persist(apply(PIPELINE, first.state, structured("high")));

		const resumed = next(PIPELINE, afterClassify);
		if (resumed.type !== "request") throw new Error("expected a request");
		expect(resumed.request.prompt).toBe("Write an urgent reply about: it crashes");
	});
});

describe("refusals", () => {
	it("refuses a state against a different source", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const edited = PIPELINE.replace("it crashes", "it hangs");
		expect(() => next(edited, first.state)).toThrow(SourceMismatchError);
		expect(() => apply(edited, first.state, structured("high"))).toThrow(SourceMismatchError);
	});

	it("refuses apply with no step awaiting", () => {
		expect(() => apply(PIPELINE, start(PIPELINE, { entry: ENTRIES }), answered("x"))).toThrow(RunStateError);
	});

	it("refuses an unknown entry at start, before anything is composed", () => {
		expect(() => start(PIPELINE, { entry: ["classify", "nope"] })).toThrow(/no subagent named "nope"/);
	});

	it("refuses a state from an unknown version", () => {
		const state = { ...start(PIPELINE, { entry: ENTRIES }), version: 2 } as unknown as RunState;
		expect(() => next(PIPELINE, state)).toThrow(SourceMismatchError);
	});
});

describe("a step that does not answer", () => {
	it("stops the run, keeps the failure, and commits nothing from that step", () => {
		const failed: StepOutcome = { kind: "failed", category: "rate_limit", message: "slow down" };
		const { result, prompts } = drive(PIPELINE, [failed], { entry: ENTRIES });
		expect(result.kind).toBe("failed");
		expect(prompts).toHaveLength(1);
		expect(result.variables.severity).toBe("");
		expect(result.steps[0]?.outcome).toEqual(failed);
	});

	it("does not commit a step's logic-line effects when the step fails", () => {
		// IN_SUBSET's `draft` sets stage = "specs" by logic, in the same step as its prompt.
		const failed: StepOutcome = { kind: "failed", category: "unknown", message: "boom" };
		const { result } = drive(IN_SUBSET, [failed]);
		expect(result.kind).toBe("failed");
		expect(result.variables.stage).toBe("proposal");
	});

	it("keeps the effects of a logic-only subagent that finished before the failing step", () => {
		// `gate` sets urgent = True by logic and finishes; `respond` then fails.
		const failed: StepOutcome = { kind: "failed", category: "unknown", message: "boom" };
		const { result } = drive(PIPELINE, [structured("high"), failed], { entry: ENTRIES });
		expect(result.kind).toBe("failed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "high", urgent: true });
	});

	it("matches run() on that, too", async () => {
		const { port } = recordingPort({ kind: "failed", category: "unknown", message: "boom" });
		const viaRun = await run(IN_SUBSET, { port });
		expect(viaRun.variables.stage).toBe("proposal");
	});

	it("reports cut-short as the run's kind", () => {
		const { result } = drive(PIPELINE, [{ kind: "cut-short", text: "half", turns: 9 }], { entry: ENTRIES });
		expect(result.kind).toBe("cut-short");
	});

	it("keeps answering done once stopped", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const stopped = apply(PIPELINE, first.state, { kind: "failed", category: "unknown", message: "x" });
		expect(next(PIPELINE, stopped).type).toBe("done");
		expect(next(PIPELINE, persist(stopped)).type).toBe("done");
	});
});
