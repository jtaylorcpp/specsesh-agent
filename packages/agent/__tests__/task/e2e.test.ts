import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTaskLoop, waitForTaskLoopResult } from "../../src/task/index.js";
import { TASKS, cleanTemps, context, loopEnv, loopHarness, plan, text, tinyChange, toolCall, verdict } from "./helpers.js";

afterEach(cleanTemps);

// The workspace's check: exits 0 only when src/value.txt says 2.
const CHECK = `const fs = require("node:fs");
const value = fs.existsSync("src/value.txt") ? fs.readFileSync("src/value.txt", "utf8").trim() : "(missing)";
console.log("value is " + value);
process.exit(value === "2" ? 0 : 1);
`;

describe("task/agent: end to end", () => {
	it("the bundled task.agent fails its check on iteration 1, fixes it on iteration 2, converges and ticks", async () => {
		const check = `${process.execPath} check.cjs`;
		const { env, workspace } = loopEnv({ checks: [check] });
		writeFileSync(join(workspace, "check.cjs"), CHECK);
		const dir = tinyChange();
		env.faux.setResponses([
			plan("write 1 to src/value.txt"),
			toolCall("edit", { path: "src/value.txt", content: "1" }),
			text("Wrote 1."),
			verdict(false, "the check wants 2, the file says 1", "retry"),
			plan("write 2 to src/value.txt"),
			toolCall("edit", { path: "src/value.txt", content: "2" }),
			text("Wrote 2."),
			verdict(true),
		]);
		const harness = await loopHarness(env);
		const id = await startTaskLoop(
			harness,
			{ change: { dir }, task: "1.1", workspace, checks: [check], model: env.model },
			context,
		);
		harness.resume();
		const { outcome, notes } = await waitForTaskLoopResult(harness, id, context);
		await harness.close(context);

		expect(notes).toEqual([]);
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations.map((i) => i.verdict.met)).toEqual([false, true]);
		expect(outcome.status === "converged" && outcome.result).toEqual({ task: "1.1", ticked: true });
		expect(readFileSync(join(workspace, "src/value.txt"), "utf8")).toBe("2");
		expect(readFileSync(join(dir, "tasks.md"), "utf8")).toBe(TASKS.replace("- [ ] 1.1", "- [x] 1.1"));

		const [first, second] = outcome.iterations;
		// Iteration 1: the edit and the failing check, carried into iteration 2's prompt.
		expect(first?.plan).toBe("write 1 to src/value.txt");
		expect(first?.actions.map((a) => a.kind)).toEqual(["edit", "command"]);
		expect(first?.evidence).toContainEqual({ kind: "diff", files: [{ path: "src/value.txt", change: "added" }] });
		expect(first?.evidence).toContainEqual(expect.objectContaining({ kind: "check", command: check, exitCode: 1 }));
		expect(second?.evidence).toContainEqual(expect.objectContaining({ kind: "check", command: check, exitCode: 0 }));
		const orient2 = JSON.stringify(env.requests[4]);
		expect(orient2).toContain("This is iteration 2. Still unmet from before: the check wants 2, the file says 1");
	}, 60_000);
});
