import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { startTaskLoop, type TaskLoopInput } from "../../src/task/index.js";
import { JUDGE_ONLY, cleanTemps, context, loopEnv, loopHarness, tinyChange } from "./helpers.js";

afterEach(() => cleanTemps());

describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("Scenario: The delegate configuration is stored with the loop", async () => {
		const { env, workspace } = loopEnv({ delegateModel: "sonnet", delegateContext: ["CLAUDE.md"] });
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
				delegateModel: "sonnet",
				delegateContext: ["CLAUDE.md"],
				worktree: { path: "/w", branch: "task/c/1.1" },
			},
			context,
		);
		const record = await harness.getTask(id, context);
		const input = record?.input as unknown as TaskLoopInput;
		expect(input.delegateModel).toBe("sonnet");
		expect(input.delegateContext).toEqual(["CLAUDE.md"]);
		expect(input.worktree).toEqual({ path: "/w", branch: "task/c/1.1" });
		await harness.close(context);
	});

	it("a loop started without them stores none", async () => {
		const { env, workspace } = loopEnv();
		const harness = await loopHarness(env);
		const id = await startTaskLoop(harness, { change: { dir: tinyChange() }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, model: env.model }, context);
		const input = (await harness.getTask(id, context))?.input as unknown as TaskLoopInput;
		expect("delegateModel" in input || "delegateContext" in input || "worktree" in input).toBe(false);
		await harness.close(context);
	});
});
