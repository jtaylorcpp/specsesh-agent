import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { BUNDLED_SCRIPTS, TaskLoopStartError, prepareTaskLoop, startTaskLoop } from "../../src/task/index.js";
import {
	DELTA,
	JUDGE_ONLY,
	PROPOSAL,
	baselineDir,
	cleanTemps,
	context,
	loopEnv,
	loopHarness,
	runLoop,
	runTasks,
	tinyChange,
	verdict,
} from "./helpers.js";

// Every file read, so a test can show the loop read none.
const reads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
		reads.paths.push(String(path));
		return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
	}) as typeof fs.readFileSync;
	return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

afterEach(cleanTemps);

const BASELINE = () => baselineDir();

describe("task/agent: Options name the change, the task, the script and the workspace", () => {
	it("Scenario: A change given as texts", async () => {
		const { env, workspace } = loopEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		reads.paths.length = 0;
		const id = await startTaskLoop(
			harness,
			{
				change: { proposal: { text: PROPOSAL }, deltas: [{ text: DELTA }], tasks: { text: "- [ ] 1.1 do it\n" } },
				task: "1.1",
				script: { text: JUDGE_ONLY },
				workspace,
			},
			context,
		);
		const started = [...reads.paths];
		const record = await harness.getTask(id, context);
		await harness.close(context);

		expect(started).toEqual([]);
		expect(record?.input).toMatchObject({ proposal: PROPOSAL, taskText: "do it", design: "" });
		// The recorder does see reads: the same start from a directory reads its proposal.md.
		prepareTaskLoop({ change: { dir: tinyChange() }, task: "1.1", script: { text: JUDGE_ONLY }, workspace });
		expect(reads.paths.some((path) => path.endsWith("proposal.md"))).toBe(true);
		expect("tasksPath" in (record?.input as object)).toBe(false);
	});

	it("Scenario: A change given by directory", () => {
		const dir = BASELINE();
		const input = prepareTaskLoop({ change: { dir }, task: "2.4", script: { text: JUDGE_ONLY }, workspace: dir });
		expect(input.proposal).toBe(readFileSync(join(dir, "proposal.md"), "utf8"));
		expect(input.design).toBe(readFileSync(join(dir, "design.md"), "utf8"));
		expect(input.tasksPath).toBe(join(dir, "tasks.md"));
		for (const capability of ["core/authoring", "core/step-machine", "durable/cli", "durable/run-task"]) {
			expect(input.deltas).toContain(`## ${capability}\n${readFileSync(join(dir, "specs", capability, "spec.md"), "utf8")}`);
		}
	});
});

describe("task/agent: Defaults for optional options", () => {
	it("escalateTo is the principal, checks and allow are empty, and the script is the bundled task.agent", () => {
		const dir = tinyChange();
		const input = prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir });
		expect(input.budget).toEqual({ maxIterations: 8 });
		expect(input.escalateTo).toBe("principal");
		expect(input.checks).toEqual([]);
		expect(input.allow).toEqual([]);
		expect(input.script).toBe(readFileSync(BUNDLED_SCRIPTS.task, "utf8"));
		expect("model" in input).toBe(false);
	});

	it("refuses a budget that is not a positive integer", () => {
		const dir = tinyChange();
		expect(() =>
			prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir, script: { text: JUDGE_ONLY }, budget: { maxIterations: 0 } }),
		).toThrow(/maxIterations must be a positive integer, got 0/);
	});
});

describe("task/agent: A change directory resolves to its artifacts", () => {
	it("Scenario: design.md is optional", async () => {
		const r = await runLoop([verdict(true)], { change: { dir: tinyChange() } });
		const [run] = await runTasks(r.storage);
		await r.harness.close(context);
		expect((run?.input as { options: { variables: Record<string, unknown> } }).options.variables["design"]).toBe("");
	});

	it("Scenario: A missing tasks.md refuses the start", async () => {
		const dir = tinyChange();
		rmSync(join(dir, "tasks.md"));
		const { env, workspace } = loopEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		await expect(
			startTaskLoop(harness, { change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace }, context),
		).rejects.toThrow(join(dir, "tasks.md"));
		const page = await storage.scanTasks({}, 10, undefined, context);
		await harness.close(context);
		expect(page.items).toEqual([]);
	});

	it("refuses a missing proposal.md and a change with no delta, naming the path", () => {
		const noProposal = tinyChange();
		rmSync(join(noProposal, "proposal.md"));
		expect(() => prepareTaskLoop({ change: { dir: noProposal }, task: "1.1", workspace: noProposal })).toThrow(
			join(noProposal, "proposal.md"),
		);
		const noDelta = tinyChange();
		rmSync(join(noDelta, "specs"), { recursive: true });
		expect(() => prepareTaskLoop({ change: { dir: noDelta }, task: "1.1", workspace: noDelta })).toThrow(
			join(noDelta, "specs"),
		);
	});
});

describe("task/agent: Sources are read once, at start, into the durable input", () => {
	it("Scenario: An unreadable path is named", async () => {
		const { env, workspace } = loopEnv();
		const harness = await loopHarness(env);
		const start = startTaskLoop(
			harness,
			{ change: { dir: tinyChange() }, task: "1.1", script: { path: "missing.agent" }, workspace },
			context,
		);
		await expect(start).rejects.toThrow(TaskLoopStartError);
		await expect(start).rejects.toThrow(/missing\.agent/);
		await harness.close(context);
	});
});

describe("task/agent: The task is found by id in today's tasks.md format", () => {
	it("Scenario: Task 2.4 is found", () => {
		const dir = BASELINE();
		const input = prepareTaskLoop({ change: { dir }, task: "2.4", script: { text: JUDGE_ONLY }, workspace: dir });
		expect(input.taskText.startsWith("`packages/agentscript-durable/__tests__/cli.test.ts`")).toBe(true);
		expect(input.taskText).not.toMatch(/^- \[/);
	});

	it("Scenario: An unknown id lists the ids that exist", () => {
		const dir = BASELINE();
		let message = "";
		try {
			prepareTaskLoop({ change: { dir }, task: "9.9", script: { text: JUDGE_ONLY }, workspace: dir });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("9.9");
		const ids = [...Array.from({ length: 11 }, (_, i) => `1.${i + 1}`), "2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.2"];
		expect(message).toContain(ids.join(", "));
	});

	it("refuses a task id that is not one", () => {
		const dir = tinyChange();
		expect(() => prepareTaskLoop({ change: { dir }, task: "two", workspace: dir })).toThrow(/"two" is not a task id/);
	});
});
