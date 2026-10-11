import { afterEach, describe, expect, it } from "vitest";
import type { Escalation } from "../../src/openspec/index.js";
import { EscalationAnswerError, answerEscalation, waitForTaskLoop } from "../../src/task/index.js";
import { cleanTemps, context, prompts, runLoop, verdict } from "./helpers.js";

afterEach(cleanTemps);

/** A loop blocked after two iterations, escalated to the principal; its harness still open. */
async function blockedLoop() {
	const r = await runLoop([
		verdict(false, "the --json case is untested", "retry"),
		verdict(false, "the spec and the lint disagree", "amend-spec", "Amend the spec?"),
	]);
	expect(r.outcome.status).toBe("blocked");
	const escalation = (r.outcome as { escalation: Escalation }).escalation;
	expect(escalation.to).toBe("principal");
	return { ...r, escalation };
}

describe("task/agent: An answered escalation resumes the loop as a new run", () => {
	it("Scenario: The wrong recipient is rejected", async () => {
		const r = await blockedLoop();
		const answer = answerEscalation(r.harness, r.id, { escalation: r.escalation, by: "agent", decision: "go", feedback: [] }, context);
		await expect(answer).rejects.toThrow(EscalationAnswerError);
		await expect(answer).rejects.toThrow(/goes to the principal, not the agent/);
		const loops = (await r.storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context)).items;
		const still = await waitForTaskLoop(r.harness, r.id, context);
		await r.harness.close(context);
		expect(loops).toHaveLength(1);
		expect(still).toEqual(r.outcome);
	});

	it("Scenario: A principal's answer resumes the loop", async () => {
		const r = await blockedLoop();
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "Amend the spec; keep the code", feedback: [] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const original = await waitForTaskLoop(r.harness, r.id, context);
		await r.harness.close(context);

		expect(next).not.toBe(r.id);
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(r.outcome.iterations);
		const third = prompts(r.env.requests)[2];
		expect(third).toContain("Carried: Amend the spec; keep the code");
		expect(third).toContain("iteration 3");
		// The blocked run is untouched.
		expect(original).toEqual(r.outcome);
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
