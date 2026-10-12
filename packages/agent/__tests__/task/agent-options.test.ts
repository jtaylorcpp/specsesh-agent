import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { startTaskLoop, type TaskLoopInput } from "../../src/task/index.js";
import { JUDGE_ONLY, SCRIPTS, cleanTemps, context, loopEnv, loopHarness, tinyChange } from "./helpers.js";

afterEach(() => cleanTemps());

describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("Scenario: The delegate configuration is stored with the loop", async () => {
		const delegates = { claude_code: { runner: "claude-code", model: "opus" } };
		const { env, workspace } = loopEnv({ delegates });
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const id = await startTaskLoop(
			harness,
			{
				change: { dir: tinyChange() },
				task: "1.1",
				script: { text: JUDGE_ONLY },
				workspace,
				model: env.model,
				delegates,
				worktree: { path: "/w", branch: "task/c/1.1" },
			},
			context,
		);
		const record = await harness.getTask(id, context);
		const input = record?.input as unknown as TaskLoopInput;
		expect(input.delegates).toEqual(delegates);
		expect(input.worktree).toEqual({ path: "/w", branch: "task/c/1.1" });
		await harness.close(context);
	});

	it("a loop started without them stores none", async () => {
		const { env, workspace } = loopEnv();
		const harness = await loopHarness(env);
		const id = await startTaskLoop(harness, { change: { dir: tinyChange() }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, model: env.model }, context);
		const input = (await harness.getTask(id, context))?.input as unknown as TaskLoopInput;
		expect("delegates" in input || "worktree" in input).toBe(false);
		await harness.close(context);
	});

	it("Scenario: A delegating script without a grant is refused at start", async () => {
		const { env, workspace } = loopEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const started = startTaskLoop(
			harness,
			{ change: { dir: tinyChange() }, task: "1.1", script: { path: join(SCRIPTS, "task-delegate.agent") }, workspace, model: env.model },
			context,
		);
		await expect(started).rejects.toThrow(/delegate\/claude_code[\s\S]*no delegates are granted/);
		const page = await storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context);
		expect(page.items).toHaveLength(0);
		await harness.close(context);
	});
});
