import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject, TaskId } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoopOutcome, TaskOutcome, check } from "../../src/openspec/index.js";
import { TaskLoopStartError } from "../../src/task/index.js";
import {
	DEFAULT_MAX_REWORKS,
	GROUP_LOOP_NAME,
	GROUP_LOOP_VERSION,
	GroupLoopTask,
	decodeCheckpoint,
	encodeCheckpoint,
	initialGroupCheckpoint,
	type GroupCheckpoint,
	findGroup,
	readGroupInput,
	resolveGroupOptions,
	validateGroupStart,
	type GroupLoopOptions,
} from "../../src/task/group.js";
import { DELTA, JUDGE_ONLY, PROPOSAL } from "./helpers.js";

// Every file read, so a test can count one read per source.
const reads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
		reads.paths.push(String(path));
		return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
	}) as typeof fs.readFileSync;
	return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TASKS = [
	"## 1. Setup",
	"",
	"- [x] 1.1 first",
	"- [ ] 1.2 second",
	"  - [X] 1.3 third, indented",
	"",
	"## 2. Build",
	"",
	"- [ ] 2.1 later group",
	"",
].join("\n");

const options = (over: Partial<GroupLoopOptions> = {}): GroupLoopOptions => ({
	change: { proposal: { text: PROPOSAL }, deltas: [{ text: DELTA }], tasks: { text: TASKS } },
	group: 1,
	script: { text: JUDGE_ONLY },
	groupScript: { text: JUDGE_ONLY },
	workspace: "/tmp/ws",
	checks: ["pnpm test"],
	...over,
});

const refusal = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(TaskLoopStartError);
		return (error as Error).message;
	}
	throw new Error("expected a refusal");
};

describe("task/group: A group is found by its number in tasks.md", () => {
	it("Scenario: An unknown group lists the groups", () => {
		const message = refusal(() => validateGroupStart(options({ group: 9 })));
		expect(message).toBe("no group 9 in tasks.md; groups: 1, 2");
	});

	it("Scenario: A group needs a check", () => {
		expect(refusal(() => validateGroupStart(options({ checks: [] })))).toContain("at least one check");
		expect(refusal(() => validateGroupStart(options({ checks: undefined })))).toContain("at least one check");
	});

	it("an empty group is refused", () => {
		expect(refusal(() => findGroup("## 3. Empty\n\nnotes only\n## 4. Next\n- [ ] 4.1 x\n", 3))).toBe("group 3 has no tasks");
	});

	it("refuses in order: options, then the group, then the checks", () => {
		expect(refusal(() => validateGroupStart(options({ group: 0, checks: [] })))).toContain("group must be a positive integer");
		expect(refusal(() => validateGroupStart(options({ group: 9, checks: [] })))).toContain("no group 9");
	});

	it("ticked and unticked lines come out in file order, bounded by the next heading", () => {
		const found = findGroup(TASKS, 1);
		expect(found.title).toBe("Setup");
		expect(found.tasks).toEqual([
			{ id: "1.1", text: "first", ticked: true },
			{ id: "1.2", text: "second", ticked: false },
			{ id: "1.3", text: "third, indented", ticked: true },
		]);
		expect(findGroup(TASKS, 2).tasks.map((t) => t.id)).toEqual(["2.1"]);
	});
});

describe("task/group: Group options are the task options with a group, a judge script and a rework budget", () => {
	it("Scenario: Defaults for a group", () => {
		const { groupScript: _omit, ...rest } = options();
		const resolved = resolveGroupOptions(rest);
		expect(resolved.groupScript).toEqual({ bundled: "group" });
		expect(resolved.budget.maxReworks).toBe(DEFAULT_MAX_REWORKS);
		expect(DEFAULT_MAX_REWORKS).toBe(2);
		expect(resolved.budget.maxIterations).toBe(3);
	});

	it("rejects maxReworks 0 and a group that is not a positive integer", () => {
		expect(refusal(() => resolveGroupOptions(options({ budget: { maxReworks: 0 } })))).toContain("budget.maxReworks");
		expect(refusal(() => resolveGroupOptions(options({ group: 1.5 })))).toContain("group must be a positive integer");
		expect(refusal(() => resolveGroupOptions(options({ group: -1 })))).toContain("group");
	});

	it("reads each source once, into an input that survives JSON", () => {		const dir = mkdtempSync(join(tmpdir(), "group-"));
		temps.push(dir);
		const paths = {
			proposal: join(dir, "proposal.md"),
			delta: join(dir, "specs", "a", "spec.md"),
			tasks: join(dir, "tasks.md"),
			script: join(dir, "task.agent"),
			groupScript: join(dir, "group.agent"),
		};
		writeFileSync(paths.proposal, PROPOSAL);
		writeFileSync(paths.tasks, TASKS);
		writeFileSync(paths.script, JUDGE_ONLY);
		writeFileSync(paths.groupScript, JUDGE_ONLY);
		mkdirSync(join(dir, "specs", "a"), { recursive: true });
		writeFileSync(paths.delta, DELTA);

		reads.paths.length = 0;
		const input = readGroupInput(
			resolveGroupOptions(
				options({
					change: { proposal: { path: paths.proposal }, deltas: [{ path: paths.delta }], tasks: { path: paths.tasks } },
					script: { path: paths.script },
					groupScript: { path: paths.groupScript },
				}),
			),
		);
		for (const path of Object.values(paths)) expect(reads.paths.filter((p) => p === path)).toHaveLength(1);
		expect(input.tasksPath).toBe(paths.tasks);
		expect(input.groupTitle).toBe("Setup");
		expect(JSON.parse(JSON.stringify(input))).toEqual(input);
	});
});

describe("task/group: The group loop is a durable task over a queue", () => {
	const input = () => validateGroupStart(options({ change: { proposal: { text: PROPOSAL }, deltas: [{ text: DELTA }], tasks: { text: TASKS } } }));

	// Runs the `next` phase against a runtime that records what it commits.
	const runNext = async (checkpoint: GroupCheckpoint) => {
		const committed: unknown[] = [];
		const runtime = {
			commit: async (fn: () => unknown) => {
				committed.push(fn());
			},
		};
		const handler = GroupLoopTask.definition.phases.next as unknown as (t: unknown, r: unknown, c: unknown) => Promise<void>;
		await handler({ state: { checkpoint: encodeCheckpoint(checkpoint) }, input: input() }, runtime, undefined);
		const { status, checkpoint: out } = committed[0] as { status: string; checkpoint: JsonObject };
		return { status, checkpoint: decodeCheckpoint(out) };
	};

	it("is agentscript.group-loop, version 1", () => {
		expect(GroupLoopTask.definition.name).toBe(GROUP_LOOP_NAME);
		expect(GROUP_LOOP_NAME).toBe("agentscript.group-loop");
		expect(GroupLoopTask.definition.version).toBe(GROUP_LOOP_VERSION);
		expect(GROUP_LOOP_VERSION).toBe(1);
	});

	it("Scenario: A ticked task is not run again", () => {
		const checkpoint = initialGroupCheckpoint(input().tasks);
		expect(checkpoint.phase).toBe("next");
		expect(checkpoint.queue).toEqual(["1.2"]);
		expect(checkpoint.reworks).toBe(0);
		const ticked = checkpoint.entries.filter((e) => e.task === "1.1" || e.task === "1.3");
		expect(ticked.map((e) => [e.task, e.runs, e.outcome.status])).toEqual([
			["1.1", 0, "converged"],
			["1.3", 0, "converged"],
		]);
		expect(ticked[0]?.outcome).toEqual({ status: "converged", iterations: [], result: { task: "1.1", ticked: true } });
		expect(JSON.parse(JSON.stringify(checkpoint))).toEqual(checkpoint);
	});

	it("Scenario: The next phase pops the queue head", async () => {
		const start = { ...initialGroupCheckpoint(input().tasks), queue: ["1.1", "1.2"] };
		const { status, checkpoint } = await runNext(start);
		expect(status).toBe("running");
		expect(checkpoint).toEqual({ ...start, phase: "task", queue: ["1.2"], child: { task: "1.1" } });
	});

	it("Scenario: An empty queue goes to the check", async () => {
		const { checkpoint } = await runNext({ ...initialGroupCheckpoint(input().tasks), queue: [], child: { task: "1.2" } });
		expect(checkpoint.phase).toBe("check");
		expect(checkpoint.queue).toEqual([]);
		expect(checkpoint.child).toBeUndefined();
	});

	it("queues the unticked tasks in file order", () => {
		const cp = initialGroupCheckpoint([
			{ id: "1.1", ticked: false },
			{ id: "1.2", ticked: true },
			{ id: "1.3", ticked: false },
		]);
		expect(cp.queue).toEqual(["1.1", "1.3"]);
		expect(cp.entries.map((e) => e.task)).toEqual(["1.2"]);
	});

	it("a ticked entry is a converged outcome with no iterations", () => {
		const entry = initialGroupCheckpoint([{ id: "1.1", ticked: true }]).entries[0];
		expect(entry?.outcome).toEqual({ status: "converged", iterations: [], result: { task: "1.1", ticked: true } });
	});

	it("Scenario: A task ticked before the group loop has no runs", () => {
		const entry = initialGroupCheckpoint(input().tasks).entries.find((e) => e.task === "1.1");
		expect(entry?.runs).toBe(0);
		expect(entry?.outcome.status).toBe("converged");
	});

	it("a ticked entry's outcome passes the ontology check", () => {
		for (const entry of initialGroupCheckpoint(input().tasks).entries) {
			expect(check(LoopOutcome(TaskOutcome), entry.outcome)).toBe(true);
		}
	});

	it("round-trips through encode and decode, with no undefined values", () => {
		const cp: GroupCheckpoint = { ...initialGroupCheckpoint(input().tasks), phase: "task", carried: "note", child: { task: "1.2" } };
		const encoded = encodeCheckpoint(cp);
		expect(decodeCheckpoint(encoded)).toEqual(cp);
		expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
		const { carried: _carried, child: _child, ...bare } = cp;
		expect(Object.keys(encodeCheckpoint(bare))).toEqual(["phase", "queue", "entries", "reworks"]);
		const withId = encodeCheckpoint({ ...cp, child: { task: "1.2", id: 7 as TaskId } });
		expect(decodeCheckpoint(withId).child).toEqual({ task: "1.2", id: 7 });
	});

	it("decoding a malformed checkpoint throws", () => {
		const good = encodeCheckpoint(initialGroupCheckpoint(input().tasks));
		expect(() => decodeCheckpoint(null)).toThrow("group-loop checkpoint malformed: checkpoint");
		expect(() => decodeCheckpoint({ ...good, phase: "nope" })).toThrow("malformed: phase");
		expect(() => decodeCheckpoint({ ...good, queue: [1] })).toThrow("malformed: queue");
		expect(() => decodeCheckpoint({ ...good, entries: "x" })).toThrow("malformed: entries");
		expect(() => decodeCheckpoint({ ...good, reworks: "0" })).toThrow("malformed: reworks");
	});
});
