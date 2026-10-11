import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { GroupOutcome, LoopOutcome, check } from "../../src/openspec/index.js";
import * as task from "../../src/task/index.js";
import {
	EscalationAnswerError,
	GroupLoop,
	TaskLoopStartError,
	answerGroupEscalation,
	groupLoopExtensions,
	startGroupLoop,
	taskLoopExtensions,
	waitForGroupLoop,
	type GroupLoopOptions,
} from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, temp, tinyChange, verdict } from "./helpers.js";

afterEach(cleanTemps);

const PASSING = "node -e process.exit(0)";

function groupEnv() {
	const workspace = temp("group-ws-");
	const env = setup();
	for (const extension of groupLoopExtensions({ workspace, checks: [PASSING] })) env.registry.install(extension);
	const options = (over: Partial<GroupLoopOptions> = {}): GroupLoopOptions => ({
		change: { dir: tinyChange() },
		group: 1,
		script: { text: JUDGE_ONLY },
		groupScript: { text: GROUP_JUDGE },
		workspace,
		checks: [PASSING],
		model: env.model,
		...over,
	});
	return { env, workspace, options };
}

const groupLoops = async (storage: MemoryStorage) =>
	(await storage.scanTasks({ kind: "agentscript.group-loop" }, 10, undefined, context)).items;

describe("task/group: The task entry exports the group loop", () => {
	it("exports the five values", () => {
		for (const name of ["startGroupLoop", "waitForGroupLoop", "answerGroupEscalation", "groupLoopExtensions"] as const) {
			expect(typeof task[name]).toBe("function");
		}
		expect(typeof task.GroupLoop).toBe("object");
	});

	it("groupLoopExtensions is GroupLoop plus taskLoopExtensions", () => {
		const opts = { workspace: "/tmp/ws", checks: [PASSING] };
		const extensions = groupLoopExtensions(opts);
		expect(extensions).toHaveLength(4);
		expect(extensions[0]).toBe(GroupLoop);
		expect(extensions.slice(1).map((e) => e.name)).toEqual(taskLoopExtensions(opts).map((e) => e.name));
	});

	it("Scenario: A host starts and awaits a group loop", async () => {
		const { env, options } = groupEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		env.faux.setResponses([verdict(true), verdict(true)]);
		const id = await startGroupLoop(harness, options(), context);
		harness.resume();
		const outcome = await waitForGroupLoop(harness, id, context);
		await harness.close(context);

		expect(outcome.status).toBe("converged");
		expect(outcome.result?.group).toBe(1);
		expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
	});
});

describe("task/group: refusals create nothing", () => {
	it("Scenario: An unknown group lists the groups", async () => {
		const { env, options } = groupEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const start = startGroupLoop(harness, options({ group: 9 }), context);
		await expect(start).rejects.toThrow(TaskLoopStartError);
		await expect(start).rejects.toThrow(/group 9.*groups: 1/);
		const loops = await groupLoops(storage);
		await harness.close(context);
		expect(loops).toHaveLength(0);
	});

	it("Scenario: A group needs a check", async () => {
		const { env, options } = groupEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		await expect(startGroupLoop(harness, options({ checks: [] }), context)).rejects.toThrow(/at least one check/);
		const loops = await groupLoops(storage);
		await harness.close(context);
		expect(loops).toHaveLength(0);
	});

	it("Scenario: A script without rework_task is refused", async () => {
		const { env, options } = groupEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const groupScript = { text: GROUP_JUDGE.replace('    rework_task: mutable string = ""\n', "") };
		await expect(startGroupLoop(harness, options({ groupScript }), context)).rejects.toThrow(/rework_task/);
		const loops = await groupLoops(storage);
		await harness.close(context);
		expect(loops).toHaveLength(0);
	});
});

describe("task/group: answerGroupEscalation", () => {
	it("rejects an answer to a loop that is not blocked", async () => {
		const { env, options } = groupEnv();
		const harness = await loopHarness(env, new MemoryStorage());
		env.faux.setResponses([verdict(true), verdict(true)]);
		const id = await startGroupLoop(harness, options(), context);
		harness.resume();
		await waitForGroupLoop(harness, id, context);
		const escalation = { level: "group", to: "principal", reason: "r", question: "q" } as const;
		const answer = answerGroupEscalation(harness, id, { escalation, by: "principal", decision: "d", feedback: [] }, context);
		await expect(answer).rejects.toThrow(EscalationAnswerError);
		await expect(answer).rejects.toThrow(/ended converged, not blocked/);
		await harness.close(context);
	});
});
