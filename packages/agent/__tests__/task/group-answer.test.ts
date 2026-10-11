import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { GroupOutcome, LoopOutcome, check, type Escalation } from "../../src/openspec/index.js";
import {
	EscalationAnswerError,
	answerGroupEscalation,
	groupLoopExtensions,
	startGroupLoop,
	startTaskLoop,
	waitForGroupLoop,
} from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, prompts, temp, tinyChange, verdict } from "./helpers.js";

afterEach(cleanTemps);

const GroupLoopOutcome = LoopOutcome(GroupOutcome);
const PASSING = "node -e process.exit(0)";
/** Passes once `flag` exists in the workspace. */
const FLAGGED = "node check.js";

const judgeAsk = (question: string) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { next_action: "ask", rework_task: "", feedback: "", question })], {
		stopReason: "toolUse",
	});

async function groupEnv(check: string, responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0]) {
	const workspace = temp("group-answer-ws-");
	writeFileSync(join(workspace, "check.js"), "process.exit(require('fs').existsSync('flag') ? 0 : 1);\n");
	const env = setup();
	for (const extension of groupLoopExtensions({ workspace, checks: [check] })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await loopHarness(env, storage);
	env.faux.setResponses(responses);
	const options = {
		change: { dir: tinyChange() },
		group: 1,
		script: { text: JUDGE_ONLY },
		groupScript: { text: GROUP_JUDGE },
		workspace,
		checks: [check],
		model: env.model,
	};
	const id = await startGroupLoop(harness, options, context);
	harness.resume();
	const outcome = await waitForGroupLoop(harness, id, context);
	return { env, storage, harness, workspace, options, id, outcome };
}

/** Group 1 (tasks 1.1, 1.2) whose first task asks the principal; 1.2 has not run. */
const blockedAtTask = () => groupEnv(PASSING, [verdict(false, "which API?", "amend-spec", "Which API?")]);
/** Group 1 whose tasks converge and whose check fails, the judge asking the principal. */
const blockedAtJudge = () => groupEnv(FLAGGED, [verdict(true), verdict(true), judgeAsk("Drop scenario X?")]);

const escalationOf = (outcome: LoopOutcome<GroupOutcome>) => (outcome as { escalation: Escalation }).escalation;
const answerOf = (outcome: LoopOutcome<GroupOutcome>, decision: string, by: "principal" | "agent" = "principal") => ({
	escalation: escalationOf(outcome),
	by,
	decision,
	feedback: [],
});

describe("task/group: An answered escalation resumes the group as a new run", () => {
	it("Scenario: Answering a blocked task resumes the group", async () => {
		const r = await blockedAtTask();
		expect(r.outcome.status).toBe("blocked");
		expect(escalationOf(r.outcome)).toMatchObject({ level: "group", to: "principal", question: "Which API?" });

		r.env.faux.appendResponses([verdict(true), verdict(true)]);
		const next = await answerGroupEscalation(r.harness, r.id, answerOf(r.outcome, "Use the v2 API"), context);
		const outcome = await waitForGroupLoop(r.harness, next, context);
		const original = await waitForGroupLoop(r.harness, r.id, context);
		await r.harness.close(context);

		expect(next).not.toBe(r.id);
		expect(outcome.status).toBe("converged");
		expect(outcome.result?.tasks.map((t) => [t.task, t.runs, t.outcome.status])).toEqual([
			["1.1", 2, "converged"],
			["1.2", 1, "converged"],
		]);
		const asked = prompts(r.env.requests);
		expect(asked[1]).toContain("Carried: Use the v2 API");
		expect(asked[2]).toContain("Task 1.2");
		expect(asked[2]).not.toContain("Use the v2 API");
		expect(check(GroupLoopOutcome, outcome)).toBe(true);
		// The blocked run is untouched.
		expect(original).toEqual(r.outcome);
	});

	it("Scenario: A judge block reruns the check, then the judge with the decision appended", async () => {
		const r = await blockedAtJudge();
		expect(r.outcome).toMatchObject({ status: "blocked", escalation: { level: "group", question: "Drop scenario X?" } });

		// The check still fails, so the judge runs again, and sees the answer in check_output.
		r.env.faux.appendResponses([judgeAsk("Still failing")]);
		const next = await answerGroupEscalation(r.harness, r.id, answerOf(r.outcome, "Drop it"), context);
		const outcome = await waitForGroupLoop(r.harness, next, context);
		await r.harness.close(context);

		expect(outcome).toMatchObject({ status: "blocked", escalation: { question: "Still failing" } });
		const judged = prompts(r.env.requests).at(-1) ?? "";
		expect(judged).toContain("Answer to the escalation: Drop it");
		expect(judged).toContain("exit 1");
		// No task reran, and the earlier round is kept ahead of this one.
		expect(outcome.result?.tasks.map((t) => t.runs)).toEqual([1, 1]);
		expect(outcome.iterations).toHaveLength(2);
		expect(outcome.iterations[0]).toEqual(r.outcome.iterations[0]);
		expect(check(GroupLoopOutcome, outcome)).toBe(true);
	});

	it("a judge block whose check now passes converges without calling the judge", async () => {
		const r = await blockedAtJudge();
		writeFileSync(join(r.workspace, "flag"), "");
		const requests = r.env.requests.length;
		const next = await answerGroupEscalation(r.harness, r.id, answerOf(r.outcome, "Fixed by hand"), context);
		const outcome = await waitForGroupLoop(r.harness, next, context);
		await r.harness.close(context);

		expect(outcome.status).toBe("converged");
		expect(r.env.requests).toHaveLength(requests);
		expect(outcome.iterations).toHaveLength(2);
		expect(check(GroupLoopOutcome, outcome)).toBe(true);
	});
});

describe("task/group: answerGroupEscalation rejects what it must, changing nothing", () => {
	const groupLoops = async (storage: MemoryStorage) =>
		(await storage.scanTasks({ kind: "agentscript.group-loop" }, 10, undefined, context)).items;

	it("Scenario: The wrong recipient is rejected", async () => {
		const r = await blockedAtTask();
		const answer = answerGroupEscalation(r.harness, r.id, answerOf(r.outcome, "go", "agent"), context);
		await expect(answer).rejects.toThrow(EscalationAnswerError);
		await expect(answer).rejects.toThrow(/goes to the principal, not the agent/);
		const loops = await groupLoops(r.storage);
		const still = await waitForGroupLoop(r.harness, r.id, context);
		await r.harness.close(context);
		expect(loops).toHaveLength(1);
		expect(still).toEqual(r.outcome);
	});

	it("rejects another escalation than the one the loop ended with", async () => {
		const r = await blockedAtTask();
		const other = { ...answerOf(r.outcome, "go"), escalation: { ...escalationOf(r.outcome), question: "another" } };
		await expect(answerGroupEscalation(r.harness, r.id, other, context)).rejects.toThrow(/another escalation/);
		expect(await groupLoops(r.storage)).toHaveLength(1);
		await r.harness.close(context);
	});

	it("rejects a loop that is not blocked", async () => {
		const r = await groupEnv(PASSING, [verdict(true), verdict(true)]);
		expect(r.outcome.status).toBe("converged");
		const escalation: Escalation = { level: "group", to: "principal", reason: "r", question: "q" };
		await expect(
			answerGroupEscalation(r.harness, r.id, { escalation, by: "principal", decision: "d", feedback: [] }, context),
		).rejects.toThrow(/ended converged, not blocked/);
		expect(await groupLoops(r.storage)).toHaveLength(1);
		await r.harness.close(context);
	});

	it("rejects the id of a task loop, and an unknown id", async () => {
		const r = await groupEnv(PASSING, [verdict(true), verdict(true), verdict(true)]);
		const taskId = await startTaskLoop(
			r.harness,
			{ change: { dir: tinyChange() }, task: "1.1", script: { text: JUDGE_ONLY }, workspace: r.workspace, model: r.env.model },
			context,
		);
		const escalation: Escalation = { level: "group", to: "principal", reason: "r", question: "q" };
		const answer = { escalation, by: "principal" as const, decision: "d", feedback: [] };
		await expect(answerGroupEscalation(r.harness, taskId as never, answer, context)).rejects.toThrow(/there is no group loop/);
		await expect(answerGroupEscalation(r.harness, 99999 as never, answer, context)).rejects.toThrow(/there is no group loop/);
		expect(await groupLoops(r.storage)).toHaveLength(1);
		await r.harness.close(context);
	});
});
