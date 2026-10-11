import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskLoopStartError } from "../../src/task/index.js";
import {
	DEFAULT_MAX_REWORKS,
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

	it("reads each source once, into an input that survives JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "group-"));
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
