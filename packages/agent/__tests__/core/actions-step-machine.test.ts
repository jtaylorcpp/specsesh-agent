import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as entry from "../../src/interpreter/index.js";
import {
	RunStateError,
	apply,
	applyAction,
	next,
	run,
	start,
	type ActionResult,
	type ReasoningRequest,
	type RunResult,
	type RunState,
	type StepOutcome,
} from "../../src/interpreter/index.js";
import {
	CHECK,
	PIPELINE,
	PIPELINE_ENTRIES,
	STEP_THEN_CHECK,
	TWO_RUNS,
	persist,
	recordingHost,
	taskAgentFile,
} from "./helpers/actions.js";
import { recordingPort } from "./helpers/recording-port.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const structured = (fields: Record<string, unknown>): StepOutcome => ({ kind: "answered", text: "", structured: fields });
const answered = (text: string): StepOutcome => ({ kind: "answered", text });
const PASSED: ActionResult = { ok: true, outputs: { passed: true, output: "12 passed" } };

/** Answers in order: an outcome for each request, a result for each action call. */
type Answer = StepOutcome | ActionResult;
const isAction = (answer: Answer): answer is ActionResult => "ok" in answer;

/** Drive by hand, every state through JSON between every call, as a durable host would. */
function drive(source: string, state: RunState, answers: Answer[]) {
	let current = persist(state);
	const requests: ReasoningRequest[] = [];
	let i = 0;
	for (;;) {
		const step = next(source, current);
		if (step.type === "done") return { result: step.result, requests };
		const answer = answers[i++];
		if (answer === undefined) throw new Error("ran out of answers");
		if (step.type === "request") {
			requests.push(step.request);
			if (isAction(answer)) throw new Error("a request was answered with an action result");
			current = persist(apply(source, persist(step.state), answer));
		} else {
			if (!isAction(answer)) throw new Error("an action call was answered with a step outcome");
			current = persist(applyAction(source, persist(step.state), answer));
		}
	}
}

/** `run()` with a port and a host fed from the same ordered answers. */
async function runWith(source: string, answers: Answer[], options: Parameters<typeof start>[1] = {}): Promise<RunResult> {
	let i = 0;
	const take = () => answers[i++];
	return run(source, {
		...options,
		port: { reason: async () => take() as StepOutcome },
		actionHost: async () => take() as ActionResult,
	});
}

/** The state after `next` produced the action call, saved as JSON. */
function awaitingCheck(source = CHECK, variables: Record<string, string> = { task_id: "2.4" }) {
	const step = next(source, start(source, { variables }));
	if (step.type !== "action") throw new Error(`expected an action call, got ${step.type}`);
	return { step, saved: persist(step.state) };
}

describe("core/step-machine: Next yields a deterministic subagent's calls one at a time", () => {
	it("Scenario: A check subagent yields its call", () => {
		const source = taskAgentFile("task.agent");
		const step = next(source, start(source, { entry: "check", variables: { task_id: "2.4" } }));
		expect(step.type).toBe("action");
		if (step.type !== "action") return;
		expect(step.call).toEqual({ subagent: "check", action: "run_checks", tool: "run_checks", inputs: { task_id: "2.4" }, index: 0 });
		expect(step.state.awaiting).toMatchObject({ subagent: "check", call: step.call });
		const awaiting = step.state.awaiting as { variables?: unknown; before?: unknown };
		expect(awaiting.variables).toBeDefined();
		expect(awaiting.before).toBeDefined();
	});

	it("Scenario: Two runs in one subagent are yielded in order", () => {
		const first = next(TWO_RUNS, start(TWO_RUNS));
		if (first.type !== "action") throw new Error("expected the first call");
		expect(first.call.inputs).toEqual({ task_id: "1" });
		const second = next(TWO_RUNS, applyAction(TWO_RUNS, first.state, { ok: true, outputs: { passed: true, output: "" } }));
		if (second.type !== "action") throw new Error("expected the second call");
		expect(second.call.inputs).toEqual({ task_id: "2" });
		expect(second.call.index).toBeGreaterThan(first.call.index);
		// The logic line between the two runs ran, after the first call's outputs.
		expect(second.state.awaiting?.variables).toMatchObject({ first: true, after: "one" });
		const done = next(TWO_RUNS, applyAction(TWO_RUNS, second.state, { ok: true, outputs: { passed: false, output: "" } }));
		expect(done.type).toBe("done");
		if (done.type === "done") expect(done.result.variables).toEqual({ first: true, second: false, after: "two" });
	});
});

describe("core/step-machine: applyAction folds one action result into the state", () => {
	it("Scenario: A successful result continues the walk", () => {
		const { saved } = awaitingCheck(TWO_RUNS, {});
		const before = persist(saved);
		const after = applyAction(TWO_RUNS, saved, { ok: true, outputs: { passed: true, output: "ok" } });
		expect(saved).toEqual(before);
		expect(after.actions.at(-1)).toEqual({
			subagent: "check",
			call: saved.awaiting && "call" in saved.awaiting ? saved.awaiting.call : undefined,
			result: { ok: true, outputs: { passed: true, output: "ok" } },
		});
		const following = next(TWO_RUNS, after);
		if (following.type !== "action") throw new Error("expected the walk to continue to the next run");
		expect(following.call.inputs).toEqual({ task_id: "2" });
	});

	it("Scenario: applyAction with a step awaiting is refused", () => {
		const step = next(PIPELINE, start(PIPELINE, { entry: PIPELINE_ENTRIES }));
		expect(step.type).toBe("request");
		expect(() => applyAction(PIPELINE, step.type === "request" ? step.state : start(PIPELINE), PASSED)).toThrow(RunStateError);
		expect(() => applyAction(PIPELINE, start(PIPELINE), PASSED)).toThrow("applyAction was called with no action awaiting");
	});
});

describe("core/step-machine: A failed action stops the run and rolls back its subagent", () => {
	it("Scenario: A failed check call ends the run failed", async () => {
		const { host } = recordingHost({ ok: false, message: "interrupted and not re-run" });
		const result = await run(CHECK, { port: recordingPort().port, actionHost: host });
		expect(result.kind).toBe("failed");
		// CHECK sets stage = "checking" before its run; that is rolled back.
		expect(result.variables["stage"]).toBe("start");
		const last = result.actions.at(-1);
		expect(last?.result).toEqual({ ok: false, message: "interrupted and not re-run" });
	});
});

describe("core/step-machine: The Step Machine Is Exported From The Interpreter Entry", () => {
	it("Scenario: Every step-machine export is reachable from the entry", () => {
		for (const name of ["start", "next", "apply", "applyAction", "run", "hashSource", "SourceMismatchError", "RunStateError"]) {
			expect((entry as Record<string, unknown>)[name], name).toBeDefined();
		}
	});

	it("Scenario: A run does not touch the author's file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-file-"));
		dirs.push(dir);
		const path = join(dir, "check.agent");
		writeFileSync(path, CHECK);
		const bytes = readFileSync(path);
		const result = await run(readFileSync(path, "utf8"), { port: recordingPort().port, actionHost: recordingHost(PASSED).host });
		expect(result.variables["checks_passed"]).toBe(true);
		expect(readFileSync(path).equals(bytes)).toBe(true);
		expect("updatedSource" in result).toBe(false);
	});
});

describe("core/step-machine: A Fresh Run State Has An Exact Shape And Is Plain JSON", () => {
	it("Scenario: A state round-tripped through JSON drives the same run", async () => {
		const answers: Answer[] = [structured({ task_id: "2.4" }), PASSED, structured({ verdict: "done" })];
		const byHand = drive(STEP_THEN_CHECK, start(STEP_THEN_CHECK, { entry: ["plan", "check", "judge"] }), answers);
		const viaRun = await runWith(STEP_THEN_CHECK, answers, { entry: ["plan", "check", "judge"] });
		expect(byHand.result).toEqual(viaRun);
		expect(viaRun.actions).toHaveLength(1);
		expect(viaRun.variables).toMatchObject({ task_id: "2.4", checks_passed: true, verdict: "done" });
	});
});

describe("core/step-machine: Next Re-Dispatches An Awaiting Step Unchanged", () => {
	it("Scenario: A host that crashed after next and before apply asks again", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: PIPELINE_ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const saved = persist(first.state);
		const again = next(PIPELINE, saved);
		if (again.type !== "request") throw new Error("expected the same request");
		expect(again.request).toEqual(first.request);
		expect(again.state).toEqual(saved);
	});

	it("Scenario: A host that crashed before applying an action asks again", () => {
		const { step, saved } = awaitingCheck();
		const again = next(CHECK, saved);
		expect(again.type).toBe("action");
		if (again.type !== "action") return;
		expect(again.call).toEqual(step.call);
		expect(again.state).toEqual(saved);
	});
});

describe("core/step-machine: Next Runs Logic-Only Subagents Without A Request", () => {
	it("Scenario: A logic-only subagent between two model steps makes no request", () => {
		const { result, requests } = drive(PIPELINE, start(PIPELINE, { entry: PIPELINE_ENTRIES }), [
			structured({ severity: "high" }),
			answered("Escalated."),
		]);
		expect(requests).toHaveLength(2);
		expect(requests[1]?.prompt).toBe("Write an urgent reply about: it crashes");
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
	});

	it("Scenario: The logic decides the other way", () => {
		const { result, requests } = drive(PIPELINE, start(PIPELINE, { entry: PIPELINE_ENTRIES }), [
			structured({ severity: "low" }),
			answered("Queued."),
		]);
		expect(requests[1]?.prompt).toBe("Write a routine reply about: it crashes");
		expect(result.variables["urgent"]).toBe(false);
	});
});

describe("core/step-machine: Next Finishes With The Run's Result", () => {
	it("Scenario: A stopped run keeps answering done", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: PIPELINE_ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const stopped = apply(PIPELINE, first.state, { kind: "failed", category: "rate_limit", message: "slow down" });
		expect(next(PIPELINE, stopped).type).toBe("done");
		expect(next(PIPELINE, persist(stopped)).type).toBe("done");
		const done = next(PIPELINE, stopped);
		if (done.type === "done") expect(done.result.actions).toEqual([]);
	});
});

describe("core/step-machine: Apply Needs An Awaiting Step", () => {
	it("Scenario: Apply with no step awaiting is refused", () => {
		let error: unknown;
		try {
			apply(PIPELINE, start(PIPELINE), answered("x"));
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(RunStateError);
		expect((error as Error).name).toBe("RunStateError");
		expect((error as Error).message).toBe("apply was called with no step awaiting an answer");
	});

	it("Scenario: Apply with an action awaiting is refused", () => {
		const { saved } = awaitingCheck();
		expect(() => apply(CHECK, saved, answered("x"))).toThrow(RunStateError);
		expect(() => apply(CHECK, saved, answered("x"))).toThrow(
			"apply was called while an action call is awaiting; use applyAction",
		);
	});
});

describe("core/step-machine: The Run State Is All A Host Persists", () => {
	it("Scenario: Resume after either crash point produces the same result", async () => {
		const answers: Answer[] = [structured({ task_id: "2.4" }), PASSED, structured({ verdict: "done" })];
		const entries = { entry: ["plan", "check", "judge"] };
		const uninterrupted = await runWith(STEP_THEN_CHECK, answers, entries);

		// Every saved state along the way, each tagged with how many answers were folded in.
		const saved: { state: RunState; folded: number }[] = [];
		let state = persist(start(STEP_THEN_CHECK, entries));
		let folded = 0;
		for (;;) {
			const step = next(STEP_THEN_CHECK, state);
			if (step.type === "done") break;
			saved.push({ state: persist(step.state), folded }); // after a next
			const answer = answers[folded++] as Answer;
			state = persist(
				step.type === "request"
					? apply(STEP_THEN_CHECK, step.state, answer as StepOutcome)
					: applyAction(STEP_THEN_CHECK, step.state, answer as ActionResult),
			);
			saved.push({ state, folded }); // after an apply or applyAction
		}
		expect(saved.length).toBe(6);
		for (const point of saved) {
			const resumed = drive(STEP_THEN_CHECK, point.state, answers.slice(point.folded));
			expect(resumed.result).toEqual(uninterrupted);
		}
	});

	it("Scenario: Resume after an action result continues past the call", () => {
		const { saved } = awaitingCheck(TWO_RUNS, {});
		const after = persist(applyAction(TWO_RUNS, saved, { ok: true, outputs: { passed: true, output: "" } }));
		const resumed = next(TWO_RUNS, after);
		if (resumed.type !== "action") throw new Error("expected the next call");
		const first = saved.awaiting && "call" in saved.awaiting ? saved.awaiting.call : undefined;
		expect(resumed.call).not.toEqual(first);
		expect(resumed.call.inputs).toEqual({ task_id: "2" });
	});
});
