import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GroupOutcome, LoopOutcome, check } from "../../src/openspec/index.js";
import { decideJudge, initialGroupCheckpoint, type GroupCheckpoint, type GroupLoopInput } from "../../src/task/group.js";
import { readGroupVerdict } from "../../src/task/group-judge.js";
import { untickLine } from "../../src/task/tasks-md.js";
import { untick } from "../../src/task/tick.js";

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TASKS = [
	{ id: "1.1", text: "first", ticked: true },
	{ id: "1.2", text: "second", ticked: true },
];
const IDS = TASKS.map((t) => t.id);

const input = (over: Partial<GroupLoopInput> = {}): GroupLoopInput =>
	({
		group: 1,
		groupTitle: "Setup",
		tasks: TASKS,
		escalateTo: "principal",
		budget: { maxIterations: 3, maxReworks: 2 },
		...over,
	}) as GroupLoopInput;

const atJudge = (over: Partial<GroupCheckpoint> = {}): GroupCheckpoint => ({
	...initialGroupCheckpoint(TASKS),
	phase: "judge",
	checkOutput: [{ command: "pnpm test", exitCode: 1, output: "import missing\nmore" }],
	child: { task: "judge", id: 9 as never },
	...over,
});

const verdict = (vars: Record<string, string>) =>
	readGroupVerdict({ next_action: "", rework_task: "", feedback: "", question: "", ...vars }, IDS);

const ended = (d: ReturnType<typeof decideJudge>) => {
	expect(d.kind).toBe("end");
	if (d.kind !== "end") throw new Error("unreachable");
	expect(check(LoopOutcome(GroupOutcome), d.done.outcome)).toBe(true);
	return d.done;
};

describe("task/group: Rework reruns one task with the failure carried in", () => {
	it("Scenario: A failed check is fixed by reworking a task (the rework half)", () => {
		const d = decideJudge(verdict({ next_action: "rework", rework_task: "1.1", feedback: "restore the import" }), atJudge(), input());
		expect(d.kind).toBe("rework");
		if (d.kind !== "rework") return;
		expect(d.task).toBe("1.1");
		expect(d.checkpoint).toMatchObject({ phase: "next", queue: ["1.1"], reworks: 1 });
		expect(d.checkpoint.child).toBeUndefined();
		expect(d.checkpoint.checkOutput).toBeUndefined();
		expect(d.checkpoint.carried?.startsWith("$ pnpm test\nexit 1\nimport missing")).toBe(true);
		expect(d.checkpoint.carried?.endsWith("restore the import")).toBe(true);
		expect(d.checkpoint.entries).toEqual(atJudge().entries);
	});
});

describe("task/group: Rework is bounded", () => {
	it("Scenario: The rework budget runs out", () => {
		const cp = atJudge({ reworks: 1 });
		const done = ended(decideJudge(verdict({ next_action: "rework", rework_task: "1.1" }), cp, input({ budget: { maxIterations: 3, maxReworks: 1 } })));
		expect(done.outcome.status).toBe("exhausted");
		expect(done.outcome.result?.tasks.map((t) => t.task)).toEqual(cp.entries.map((e) => e.task));
	});
});

describe("task/group: ask and amend-spec block the group", () => {
	it("Scenario: The judge asks the principal", () => {
		const done = ended(decideJudge(verdict({ next_action: "ask", question: "Drop scenario X?" }), atJudge(), input()));
		expect(done.outcome).toMatchObject({
			status: "blocked",
			escalation: { level: "group", to: "principal", question: "Drop scenario X?" },
		});
	});

	it("an empty question falls back to the check output's first line", () => {
		const done = ended(decideJudge(verdict({ next_action: "ask", question: "  " }), atJudge(), input()));
		expect(done.outcome).toMatchObject({ status: "blocked", escalation: { question: "$ pnpm test" } });
	});

	it("amend-spec blocks as a spec-defect, to escalateTo", () => {
		const done = ended(decideJudge(verdict({ next_action: "amend-spec", question: "Fix the spec?" }), atJudge(), input({ escalateTo: "agent" })));
		expect(done.outcome).toMatchObject({
			status: "blocked",
			escalation: { level: "group", to: "agent", reason: "spec-defect: amend-spec", question: "Fix the spec?" },
		});
		expect(check(LoopOutcome(GroupOutcome), done.outcome)).toBe(true);
	});
});

describe("task/group: A judge answer outside the contract fails the group", () => {
	it("Scenario: A task outside the group is refused", () => {
		const done = ended(decideJudge(verdict({ next_action: "rework", rework_task: "3.1" }), atJudge(), input()));
		expect(done.outcome.status).toBe("failed");
		expect(done.notes.join("\n")).toContain("3.1");
		expect(done.notes.join("\n")).toContain("broke its contract");
	});

	it("an out-of-group task fails as a contract break even when the budget is spent", () => {
		const done = ended(decideJudge(verdict({ next_action: "rework", rework_task: "3.1" }), atJudge({ reworks: 2 }), input()));
		expect(done.outcome.status).toBe("failed");
	});

	it("an unknown next_action fails the group", () => {
		const done = ended(decideJudge(verdict({ next_action: "frobnicate" }), atJudge(), input()));
		expect(done.outcome.status).toBe("failed");
		expect(done.notes.join("\n")).toContain("frobnicate");
	});
});

describe("task/agent: Ticking never writes in doubt and never unticks (only a rework unticks)", () => {
	const LINES = "## 1. G\n\n- [x] 1.1 a\n- [x] 1.10 b\n- [ ] 1.2 c\n";

	it("unticks only the target line", () => {
		expect(untickLine(LINES, "1.1")).toEqual({ text: "## 1. G\n\n- [ ] 1.1 a\n- [x] 1.10 b\n- [ ] 1.2 c\n" });
	});

	it("leaves a similar id alone", () => {
		expect(untickLine(LINES, "1.10")).toEqual({ text: "## 1. G\n\n- [x] 1.1 a\n- [ ] 1.10 b\n- [ ] 1.2 c\n" });
	});

	it("an unticked or missing line is not changed", () => {
		expect(untickLine(LINES, "1.2")).toEqual({ reason: "unticked" });
		expect(untickLine(LINES, "9.9")).toEqual({ reason: "missing" });
	});

	it("writes the file for a path, and nothing for text input", () => {
		const dir = mkdtempSync(join(tmpdir(), "untick-"));
		temps.push(dir);
		const path = join(dir, "tasks.md");
		writeFileSync(path, LINES);
		expect(untick(path, "1.1")).toEqual({ unticked: true });
		expect(readFileSync(path, "utf8")).toBe("## 1. G\n\n- [ ] 1.1 a\n- [x] 1.10 b\n- [ ] 1.2 c\n");
		expect(untick(path, "1.1").note).toContain("already unticked");
		expect(untick(path, "9.9").note).toContain("no longer in");
		expect(untick(undefined, "1.1")).toMatchObject({ unticked: false, note: expect.stringContaining("given as text") });
	});
});
