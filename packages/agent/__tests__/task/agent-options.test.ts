import { afterEach, describe, expect, it } from "vitest";
import { type TaskLoopInput, startTaskLoop } from "../../src/task/index.js";
import { JUDGE_ONLY, cleanTemps, context, loopEnv, loopHarness, tinyChange } from "./helpers.js";

afterEach(() => cleanTemps());

// The delegate scenarios live in delegation-loop.test.ts.
describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("a loop started without them stores none", async () => {
		const { env, workspace } = loopEnv();
		const harness = await loopHarness(env);
		const id = await startTaskLoop(harness, { change: { dir: tinyChange() }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, model: env.model }, context);
		const input = (await harness.getTask(id, context))?.input as unknown as TaskLoopInput;
		expect("delegates" in input || "worktree" in input).toBe(false);
		await harness.close(context);
	});
});
