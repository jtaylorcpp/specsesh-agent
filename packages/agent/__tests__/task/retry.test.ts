// Retrying a loop that ended failed or exhausted (#47): a new run of the same loop, seeded with why
// the last one ended, numbering on from its iterations with a fresh budget and keeping its baseline.
// A blocked loop is answered instead; a converged or running one has nothing to retry.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import type { GroupOutcome, LoopOutcome } from "../../src/openspec/index.js";
import {
	LoopRetryError,
	groupLoopExtensions,
	retryCarried,
	retryCheckpoint,
	retryGroupLoop,
	retryTaskLoop,
	startGroupLoop,
	waitForGroupLoop,
	waitForTaskLoopResult,
	type TaskLoopInput,
} from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, prompts, runLoop, temp, tinyChange, verdict } from "./helpers.js";

afterEach(cleanTemps);

/** A model step that fails, as a step at Claude Code's turn limit does. */
const stepFails = (why = "claude stopped at its turn limit") => fauxAssistantMessage([], { stopReason: "error", errorMessage: why });

const inputOf = async (harness: Awaited<ReturnType<typeof runLoop>>["harness"], id: unknown) =>
	(await harness.getTask(id as never, context))?.input as unknown as TaskLoopInput;

describe("task/retry: retryTaskLoop starts a failed loop again", () => {
	it("carries why it failed, numbers on from its iterations, and keeps its baseline", async () => {
		const r = await runLoop([stepFails()]);
		expect(r.outcome.status).toBe("failed");
		const failed = await waitForTaskLoopResult(r.harness, r.id, context);

		r.env.faux.appendResponses([verdict(true)]);
		const next = await retryTaskLoop(r.harness, r.id, context);
		const retried = await waitForTaskLoopResult(r.harness, next, context);
		const input = await inputOf(r.harness, next);
		// The failed loop keeps its outcome.
		const original = await waitForTaskLoopResult(r.harness, r.id, context);
		await r.harness.close(context);

		expect(next).not.toBe(r.id);
		expect(retried.outcome.status).toBe("converged");
		expect(retried.outcome.iterations.map((i) => i.n)).toEqual([1, 2]);
		expect(input.retries).toBe(r.id);
		expect(input.earlier).toEqual(r.outcome.iterations);
		expect(input.carried).toBe(retryCarried("failed", failed.notes));
		expect(input.carried).toContain("claude stopped at its turn limit");
		expect(input.since).toEqual(failed.since);
		expect(original.outcome.status).toBe("failed");
	});

	it("shows the agent why the last run ended", async () => {
		const r = await runLoop([stepFails("model_error: boom")]);
		r.env.faux.appendResponses([verdict(true)]);
		await waitForTaskLoopResult(r.harness, await retryTaskLoop(r.harness, r.id, context), context);
		await r.harness.close(context);
		expect(prompts(r.env.requests).at(-1)).toContain("The last run of this loop ended failed");
	});

	it("gives an exhausted loop a fresh budget", async () => {
		const r = await runLoop([verdict(false, "not yet")], { budget: { maxIterations: 1 } });
		expect(r.outcome.status).toBe("exhausted");
		r.env.faux.appendResponses([verdict(true)]);
		const retried = await waitForTaskLoopResult(r.harness, await retryTaskLoop(r.harness, r.id, context), context);
		await r.harness.close(context);
		expect(retried.outcome.status).toBe("converged");
		expect(retried.outcome.iterations).toHaveLength(2);
	});

	it("refuses a converged loop, a blocked one (answer it), and an unknown id, starting nothing", async () => {
		const converged = await runLoop([verdict(true)]);
		await expect(retryTaskLoop(converged.harness, converged.id, context)).rejects.toThrow(LoopRetryError);
		await expect(retryTaskLoop(converged.harness, converged.id, context)).rejects.toThrow(
			`task loop ${converged.id} ended converged, not failed or exhausted, so there is nothing to retry`,
		);
		await expect(retryTaskLoop(converged.harness, 999 as never, context)).rejects.toThrow("there is no task loop 999");
		await converged.harness.close(context);

		const blocked = await runLoop([verdict(false, "which?", "ask", "Which way?")]);
		expect(blocked.outcome.status).toBe("blocked");
		await expect(retryTaskLoop(blocked.harness, blocked.id, context)).rejects.toThrow("answer it instead");
		await blocked.harness.close(context);
	});
});

describe("task/retry: retryCheckpoint", () => {
	const tasks = [{ id: "1.1" }, { id: "1.2" }, { id: "1.3" }] as never;
	const entry = (task: string, status: string, runs = 1) => ({ task, outcome: { status, iterations: [] }, runs });
	const ended = (entries: object[], status = "failed") => ({ status, iterations: [], result: { group: 1, tasks: entries } }) as unknown as LoopOutcome<GroupOutcome>;

	it("reruns the task that didn't converge, then the ones not reached, with a fresh rework budget", () => {
		const cp = retryCheckpoint({ tasks }, ended([entry("1.1", "converged"), entry("1.2", "failed", 2)]), "why");
		expect(cp).toMatchObject({ phase: "next", queue: ["1.2", "1.3"], reworks: 0, carried: "why" });
		expect(cp.entries.map((e) => [e.task, e.runs])).toEqual([["1.1", 1], ["1.2", 2]]);
	});

	it("reruns the group check when every task converged", () => {
		const cp = retryCheckpoint({ tasks }, ended([entry("1.1", "converged"), entry("1.2", "converged"), entry("1.3", "converged")], "exhausted"), "why");
		expect(cp).toMatchObject({ phase: "check", queue: [], reworks: 0, decision: "why" });
	});
});

describe("task/retry: retryGroupLoop", () => {
	it("reruns the failed task and goes on, without rerunning a converged one", async () => {
		const workspace = temp("group-retry-ws-");
		writeFileSync(join(workspace, "ok.js"), "");
		const check = "node -e process.exit(0)";
		const env = setup();
		for (const extension of groupLoopExtensions({ workspace, checks: [check] })) env.registry.install(extension);
		const harness = await loopHarness(env, new MemoryStorage());
		// 1.1 converges; 1.2's first step fails, so the group fails.
		env.faux.setResponses([verdict(true), stepFails()]);
		const id = await startGroupLoop(
			harness,
			{ change: { dir: tinyChange() }, group: 1, script: { text: JUDGE_ONLY }, groupScript: { text: GROUP_JUDGE }, workspace, checks: [check], model: env.model },
			context,
		);
		harness.resume();
		const failed = await waitForGroupLoop(harness, id, context);
		expect(failed.status).toBe("failed");
		const requestsBefore = env.faux.state.callCount;

		env.faux.appendResponses([verdict(true)]);
		const next = await retryGroupLoop(harness, id, context);
		const outcome = await waitForGroupLoop(harness, next, context);
		await harness.close(context);

		expect(outcome.status).toBe("converged");
		// One model call: 1.2's verdict. 1.1 did not run again.
		expect(env.faux.state.callCount - requestsBefore).toBe(1);
		const runs = Object.fromEntries((outcome.result as unknown as GroupOutcome).tasks.map((t) => [t.task, t.runs]));
		expect(runs).toEqual({ "1.1": 1, "1.2": 2 });
	});
});
