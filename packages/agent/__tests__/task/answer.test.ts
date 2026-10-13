import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Escalation } from "../../src/openspec/index.js";
import { EscalationAnswerError, answerEscalation, waitForTaskLoop, waitForTaskLoopResult } from "../../src/task/index.js";
import { JUDGE_ONLY, cleanTemps, context, prompts, runLoop, runTasks, tinyChange, verdict } from "./helpers.js";

afterEach(cleanTemps);

/** JUDGE_ONLY that also reads `amend_path` and `amend_text` back from the result. */
const JUDGE_AMENDING = JUDGE_ONLY.replace(
	"            set @variables.question = @outputs.question\n",
	"            set @variables.question = @outputs.question\n" +
		"            set @variables.amend_path = @outputs.amend_path\n" +
		"            set @variables.amend_text = @outputs.amend_text\n",
);
const HOST = "specs/durable/host/spec.md";
const QUESTION = "The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?";
const AMEND_TEXT =
	"## MODIFIED Requirements\n\n### Requirement: An undeclared variable is refused by the lint\nThe lint SHALL refuse an undeclared variable before run starts.\n";

const carriedOf = (run: { input: unknown } | undefined) =>
	(run?.input as { options: { variables: { carried: string } } }).options.variables.carried;

/**
 * A loop over a change with a `durable/host` delta (so `HOST` is an `amend_path` choice),
 * blocked after two iterations and escalated to the principal; its harness still open.
 * The second verdict is `amend-spec` with an amendment, or with `ask` a plain question.
 */
async function blockedLoop(last: "amend-spec" | "ask" = "amend-spec") {
	const dir = tinyChange({ capabilities: ["durable/host"] });
	const r = await runLoop(
		[
			verdict(false, "the --json case is untested", "retry"),
			last === "amend-spec"
				? verdict(false, "the spec and the lint disagree", "amend-spec", QUESTION, { amend_path: HOST, amend_text: AMEND_TEXT })
				: verdict(false, "two ways to do it", "ask", "Which way?"),
		],
		{ change: { dir }, script: { text: JUDGE_AMENDING } },
	);
	const { outcome } = await waitForTaskLoopResult(r.harness, r.id, context);
	expect(outcome.status).toBe("blocked");
	expect(outcome.iterations).toHaveLength(2);
	const escalation = (outcome as { escalation: Escalation }).escalation;
	expect(escalation.to).toBe("principal");
	if (last === "amend-spec") expect(escalation.amendment).toEqual({ delta: HOST, text: AMEND_TEXT });
	else expect(escalation).not.toHaveProperty("amendment");
	return { ...r, dir, escalation };
}

describe("task/agent: An answered escalation resumes the loop as a new run", () => {
	it("Scenario: The wrong recipient is rejected", async () => {
		const r = await blockedLoop();
		const before = await runTasks(r.storage);
		const answer = answerEscalation(r.harness, r.id, { escalation: r.escalation, by: "agent", decision: "go", feedback: [] }, context);
		await expect(answer).rejects.toThrow(EscalationAnswerError);
		await expect(answer).rejects.toThrow(/goes to the principal, not the agent/);
		const loops = (await r.storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context)).items;
		const after = await runTasks(r.storage);
		const still = await waitForTaskLoop(r.harness, r.id, context);
		await r.harness.close(context);
		expect(loops).toHaveLength(1);
		expect(after).toHaveLength(before.length);
		expect(after).toHaveLength(2);
		expect(still).toEqual(r.outcome);
		expect(still.status).toBe("blocked");
		expect(still.iterations).toHaveLength(2);
	});

	it("Scenario: A principal's answer resumes the loop", async () => {
		const r = await blockedLoop();
		const earlier = structuredClone(r.outcome.iterations);
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "Amend the spec; keep the code", feedback: [] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const original = await waitForTaskLoop(r.harness, r.id, context);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(next).not.toBe(r.id);
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(earlier);
		expect(runs).toHaveLength(3);
		expect(carriedOf(runs[2])).toBe("Amend the spec; keep the code");
		const third = prompts(r.env.requests)[2];
		expect(third).toContain("Carried: Amend the spec; keep the code");
		expect(third).toContain("iteration 3");
		// The blocked run is untouched.
		expect(original).toEqual(r.outcome);
	});

	it("Scenario: An applied amendment is carried", async () => {
		const r = await blockedLoop();
		const earlier = structuredClone(r.outcome.iterations);
		const delta = readFileSync(join(r.dir, HOST), "utf8");
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "amendment-applied", feedback: [] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(runs).toHaveLength(3);
		expect(carriedOf(runs[2])).toBe(`The principal applied your amendment to ${HOST}. That delta now reads:\n\n${AMEND_TEXT}`);
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(earlier);
		// Applying the amendment is the principal's job: the loop writes no delta.
		expect(readFileSync(join(r.dir, HOST), "utf8")).toBe(delta);
	});

	it("rejects an answer to a loop that is not blocked, or to another escalation", async () => {
		const done = await runLoop([verdict(true)]);
		const escalation: Escalation = { level: "task", to: "principal", reason: "r", question: "q" };
		await expect(
			answerEscalation(done.harness, done.id, { escalation, by: "principal", decision: "d", feedback: [] }, context),
		).rejects.toThrow(/ended converged, not blocked/);
		await done.harness.close(context);

		const r = await blockedLoop();
		await expect(
			answerEscalation(r.harness, r.id, { escalation: { ...r.escalation, question: "another" }, by: "principal", decision: "d", feedback: [] }, context),
		).rejects.toThrow(/another escalation/);
		await r.harness.close(context);
	});
});

describe("openspec/loops: An answered escalation resumes the loop", () => {
	it("Scenario: A blocked task loop resumes with the answer", async () => {
		const r = await blockedLoop("ask");
		const earlier = structuredClone(r.outcome.iterations);
		// A retry feedback as the loop itself records it, from the first iteration.
		const retry = earlier[0]?.feedback[0];
		expect(retry?.action).toBe("retry");
		if (retry === undefined) return;
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "Test the --json case first", feedback: [retry] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(runs).toHaveLength(3);
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(earlier);
		const carried = carriedOf(runs[2]);
		expect(carried).toContain("Test the --json case first");
		expect(carried).toContain(retry.from.message);
	});
});
