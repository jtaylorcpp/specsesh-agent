import { describe, expect, it } from "vitest";
import {
	type CapabilityPath,
	Change,
	DEFAULT_SIZE_BUDGET,
	type Delta,
	type Proposal,
	type Requirement,
	SizeBudget,
	Task,
	type TaskList,
	changeSize,
	check,
	proposalSizeIssues,
	sizeIssues,
	strictlyValid,
	taskIssues,
} from "../../src/openspec/index.js";
import { demoChange, task, threeRef } from "./fixtures.js";

const A: CapabilityPath = ["demo", "a"];
const B: CapabilityPath = ["demo", "b"];

const requirement = (name: string, scenarios: number): Requirement => ({
	name,
	text: `${name} SHALL hold.`,
	scenarios: Array.from({ length: scenarios }, (_, i) => ({
		name: `${name} case ${i + 1}`,
		clauses: [
			{ keyword: "WHEN", text: `case ${i + 1}` },
			{ keyword: "THEN", text: "it holds" },
		],
	})),
});

const added = (capability: CapabilityPath, name: string, scenarios: number): Delta => ({
	op: "ADDED",
	capability,
	requirement: requirement(name, scenarios),
});

/** One group per entry, numbered from 1, holding that many tasks. */
const taskList = (...sizes: number[]): TaskList => ({
	groups: sizes.map((size, g) => ({
		number: g + 1,
		title: `Group ${g + 1}`,
		tasks: Array.from({ length: size }, (_, t) => task(`${g + 1}.${t + 1}`)),
	})),
});

/** `demoChange`, with `new` and `modified` capabilities, these deltas and this task list. */
const sized = (capabilities: { new: CapabilityPath[]; modified: CapabilityPath[] }, deltas: Delta[], tasks?: TaskList): Change => {
	const base = demoChange(tasks);
	const change: Change = { ...base, proposal: { ...base.proposal, capabilities }, deltas };
	expect(check(Change, change)).toBe(true);
	return change;
};

describe("A size budget has fixed limits with defaults", () => {
	it("Scenario: The default budget", () => {
		expect(DEFAULT_SIZE_BUDGET).toEqual({
			capabilities: 2,
			requirements: 6,
			scenarios: 16,
			groups: 4,
			tasks: 12,
			taskFiles: 1,
			taskChars: 240,
			testScenarios: 4,
		});
		expect(check(SizeBudget, DEFAULT_SIZE_BUDGET)).toBe(true);
	});

	it("Scenario: An oversized change fails strict validation", () => {
		const deltas = Array.from({ length: 7 }, (_, i) => added(A, `Requirement ${i + 1}`, 1));
		const change = sized({ new: [A], modified: [] }, deltas);
		expect(changeSize(change).requirements).toBe(7);
		expect(strictlyValid(sizeIssues(change))).toBe(false);
	});
});

describe("A change's size counts its capabilities, deltas and tasks", () => {
	it("Scenario: Counting a change", () => {
		const change = sized(
			{ new: [A], modified: [B] },
			[
				added(A, "First", 2),
				added(A, "Second", 2),
				added(B, "Third", 2),
				{ op: "REMOVED", capability: B, name: "Old", reason: "Replaced by Third", migration: "Use Third" },
			],
			taskList(3, 2),
		);
		expect(changeSize(change)).toEqual({ capabilities: 2, requirements: 4, scenarios: 6, groups: 2, tasks: 5 });
	});
});

describe("A change over budget is reported per limit, with a split", () => {
	it("Scenario: A change within budget has no issues", () => {
		const deltas = [3, 3, 3, 3, 2, 2].map((scenarios, i) => added(i % 2 === 0 ? A : B, `Requirement ${i + 1}`, scenarios));
		const change = sized({ new: [A], modified: [B] }, deltas, taskList(3, 3, 3, 3));
		const { taskFiles, taskChars, testScenarios, ...limits } = DEFAULT_SIZE_BUDGET;
		expect(changeSize(change)).toEqual(limits);
		expect(sizeIssues(change)).toEqual([]);
	});

	it("Scenario: Each exceeded limit is its own issue", () => {
		const deltas = [3, 3, 3, 3, 5].map((scenarios, i) => added(A, `Requirement ${i + 1}`, scenarios));
		const change = sized({ new: [A], modified: [] }, deltas, taskList(7, 6));
		const issues = sizeIssues(change);
		expect(issues).toHaveLength(2);
		expect(issues.every((issue) => issue.level === "WARNING")).toBe(true);
		const specs = issues.find((issue) => issue.path === "specs");
		expect(specs?.message).toContain("17");
		expect(specs?.message).toContain("16");
		const tasks = issues.find((issue) => issue.path === "tasks.md");
		expect(tasks?.message).toContain("13");
		expect(tasks?.message).toContain("12");
	});

	it("Scenario: Split by capability", () => {
		const cli: CapabilityPath = ["task", "cli"];
		const group: CapabilityPath = ["task", "group"];
		const host: CapabilityPath = ["durable", "host"];
		const change = sized(
			{ new: [cli], modified: [group, host] },
			[added(cli, "First", 1), added(group, "Second", 1), added(host, "Third", 1)],
		);
		const issues = sizeIssues(change).filter((issue) => issue.path === "proposal.md");
		expect(issues).toHaveLength(1);
		const [issue] = issues;
		expect(issue?.level).toBe("WARNING");
		for (const text of ["3", "2", "task/cli", "task/group", "durable/host"]) expect(issue?.message).toContain(text);
	});

	it("Scenario: Split by group", () => {
		const tasks: TaskList = {
			groups: [
				{ number: 1, title: "Model", tasks: Array.from({ length: 7 }, (_, t) => task(`1.${t + 1}`)) },
				{ number: 2, title: "Loop", tasks: Array.from({ length: 6 }, (_, t) => task(`2.${t + 1}`)) },
			],
		};
		const change = sized({ new: [A], modified: [] }, [added(A, "First", 2)], tasks);
		const issues = sizeIssues(change).filter((issue) => issue.path === "tasks.md");
		expect(issues).toHaveLength(1);
		for (const text of ["13", "12", "1. Model", "2. Loop"]) expect(issues[0]?.message).toContain(text);
	});
});

describe("A proposal is sized before any delta exists", () => {
	it("Scenario: A proposal touching three capabilities", () => {
		const proposal: Proposal = {
			...demoChange().proposal,
			capabilities: {
				new: [["openspec", "size"]],
				modified: [
					["task", "cli"],
					["task", "group"],
				],
			},
		};
		const issues = proposalSizeIssues(proposal);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toBe("proposal.md");
		expect(issues[0]?.level).toBe("WARNING");
		for (const text of ["openspec/size", "task/cli", "task/group"]) expect(issues[0]?.message).toContain(text);
		const two: Proposal = { ...proposal, capabilities: { ...proposal.capabilities, modified: [["task", "cli"]] } };
		expect(proposalSizeIssues(two)).toEqual([]);
	});
});

describe("A task is one action on one file", () => {
	/** `task(id, links)` with this text, checked against the `Task` schema. */
	const worded = (id: string, text: string, links: Task["links"] = []): Task => {
		const value: Task = { ...task(id, links), text };
		expect(check(Task, value)).toBe(true);
		return value;
	};

	it("Scenario: A task naming two files", () => {
		const issues = taskIssues(worded("2.1", "`src/a.ts` and `src/b.ts`: rename the export"));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ level: "WARNING", path: "tasks.md#2.1" });
		expect(issues[0]?.message).toContain("src/a.ts");
		expect(issues[0]?.message).toContain("src/b.ts");
	});

	it("Scenario: A task with sub-steps", () => {
		const text = "Rename the export\n  - first step\n  - second step";
		expect(text.length).toBeLessThan(DEFAULT_SIZE_BUDGET.taskChars);
		const issues = taskIssues(worded("2.2", text));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ level: "WARNING", path: "tasks.md#2.2" });
		expect(issues[0]?.message).toMatch(/more than one line/);
	});

	it("Scenario: A test task claiming five scenarios", () => {
		const links: Task["links"] = ["one", "two", "three", "four", "five"].map((scenario) => ({
			target: threeRef(scenario),
			basis: "scenario-named",
			confidence: 1,
		}));
		const issues = taskIssues(worded("2.3", "Test the five scenarios", links));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ level: "WARNING", path: "tasks.md#2.3" });
		expect(issues[0]?.message).toMatch(/\b5\b/);
		expect(issues[0]?.message).toMatch(/\b4\b/);
	});

	it("Scenario: A command task passes", () => {
		expect(taskIssues(worded("4.1", "pnpm check and pnpm test pass"))).toEqual([]);
	});
});
