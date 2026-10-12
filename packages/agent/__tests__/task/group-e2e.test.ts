import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { GroupOutcome, LoopOutcome, check } from "../../src/openspec/index.js";
import { TASK_LOOP, groupLoopExtensions, startGroupLoop, waitForGroupLoop } from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { DELTA, PROPOSAL, cleanTemps, context, loopHarness, plan, temp, text, toolCall, verdict } from "./helpers.js";

afterEach(cleanTemps);

const TASKS = "## 1. Fixture group\n\n- [ ] 1.1 write `a.txt`\n- [ ] 1.2 write `b.txt`\n";

// The group check, outside the workspace and with no shell. Task loops run the configured
// checks themselves, so the check cannot key off the workspace alone: 1.2's own loop would see
// b.txt next to a stale a.txt and fail too. Instead it counts its calls and fails on the K-th.
// Each task loop calls it twice per iteration: the script's `run_checks` step, then the gate that
// follows a met verdict. Calls in order: 1.1 (1, 2), 1.2 (3, 4), the group's first check (5, K),
// 1.1's rework loop (6, 7), the group's second check (8). So K = 2 task loops * 2 calls + 1 = 5.
const FAILING_CALL = 5;
const CHECK = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const calls = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
writeFileSync(file, String(calls));
if (calls === ${FAILING_CALL}) {
	console.log("REGRESSION: a.txt not updated for b.txt");
	process.exit(1);
}
`;

const judgeRework = fauxAssistantMessage(
	[
		fauxToolCall(RESULT_TOOL, {
			next_action: "rework",
			rework_task: "1.1",
			feedback: "update a.txt for b.txt",
			question: "",
		}),
	],
	{ stopReason: "toolUse" },
);

/** One task.agent run's four model turns: orient, act (edit then summary), judge. */
const taskTurns = (file: string, content: string) => [
	plan(`write ${content} to ${file}`),
	toolCall("edit", { path: file, content }),
	text(`Wrote ${file}.`),
	verdict(true),
];

describe("task/group: end to end", () => {
	it("Scenario: A failed check is fixed by reworking a task", async () => {
		const aux = temp("group-e2e-aux-");
		const workspace = temp("group-e2e-ws-");
		const changeDir = join(temp("group-e2e-change-"), "fixture-group");
		mkdirSync(join(changeDir, "specs", "value", "file"), { recursive: true });
		writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
		writeFileSync(join(changeDir, "specs", "value", "file", "spec.md"), DELTA);
		writeFileSync(join(changeDir, "tasks.md"), TASKS);
		writeFileSync(join(aux, "check.mjs"), CHECK);
		const groupCheck = `${process.execPath} ${join(aux, "check.mjs")} ${join(aux, "state")}`;

		const env = setup();
		for (const extension of groupLoopExtensions({ workspace, checks: [groupCheck], allow: [] })) env.registry.install(extension);
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const responses = [
			...taskTurns("a.txt", "v1"),
			...taskTurns("b.txt", "v1"),
			judgeRework,
			...taskTurns("a.txt", "fixed"),
		];
		env.faux.setResponses(responses);

		try {
			const id = await startGroupLoop(
				harness,
				{
					change: { dir: changeDir },
					group: 1,
					workspace,
					checks: [groupCheck],
					budget: { maxReworks: 2 },
					model: env.model,
				},
				context,
			);
			harness.resume();
			const outcome = await waitForGroupLoop(harness, id, context);

			expect(outcome.status).toBe("converged");
			expect(outcome.result?.group).toBe(1);
			expect(outcome.result?.tasks.map((t) => [t.task, t.runs])).toEqual([
				["1.1", 2],
				["1.2", 1],
			]);
			expect(outcome.result?.tasks.map((t) => t.outcome.status)).toEqual(["converged", "converged"]);

			// 1.1 was unticked by the rework and ticked again when its second run converged.
			const tasks = readFileSync(join(changeDir, "tasks.md"), "utf8");
			expect(tasks).toContain("- [x] 1.1 ");
			expect(tasks).toContain("- [x] 1.2 ");
			expect(readFileSync(join(workspace, "a.txt"), "utf8")).toBe("fixed");
			expect(readFileSync(join(workspace, "b.txt"), "utf8")).toBe("v1");

			// Exactly one rework: an unmet round (code-defect, rework-task), then a met one.
			expect(outcome.iterations.map((i) => i.verdict.met)).toEqual([false, true]);
			expect(outcome.iterations[0]?.feedback).toMatchObject([
				{ from: { kind: "code-defect" }, action: "rework-task" },
			]);
			expect(outcome.iterations[1]?.feedback).toEqual([]);

			// The failing check's output reached 1.1's second run as its `carried` input.
			const children = (await storage.scanTasks({ kind: TASK_LOOP }, 50, undefined, context)).items;
			const ones = children
				.map((t) => t.input as unknown as { task: string; carried: string })
				.filter((c) => c.task === "1.1");
			expect(ones).toHaveLength(2);
			expect(ones[0]?.carried).toBe("");
			expect(ones[1]?.carried).toContain("REGRESSION: a.txt not updated for b.txt");
			expect(ones[1]?.carried).toContain(groupCheck);
			expect(ones[1]?.carried).toContain("update a.txt for b.txt");

			expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
			// Every scripted turn was consumed, and nothing more was asked.
			expect(env.requests).toHaveLength(responses.length);
			expect(env.faux.getPendingResponseCount()).toBe(0);
		} finally {
			await harness.close(context);
		}
	}, 60_000);
});
