import { describe, expect, it } from "vitest";
import { TaskLoopStartError } from "../../src/task/index.js";
import { checkGroupContract, readGroupVerdict, seedGroupJudge } from "../../src/task/group-judge.js";

const GROUP_JUDGE = `config:
    agent_name: "group-judge"

variables:
    group_number: mutable number = 1
    group_title: mutable string = ""
    tasks: mutable string = ""
    proposal: mutable string = ""
    deltas: mutable string = ""
    check_output: mutable string = ""
    rework_count: mutable number = 0
    next_action: mutable string = "ask"
    rework_task: mutable string = ""
    feedback: mutable string = ""
    question: mutable string = ""

subagent judge:
    description: "Judge the group"

    reasoning:
        instructions: ->
            | Group {!@variables.group_number}: {!@variables.group_title}
            | {!@variables.check_output}
            set @variables.next_action = @outputs.next_action
`;

const refusal = (source: string) => {
	try {
		checkGroupContract(source);
	} catch (error) {
		expect(error).toBeInstanceOf(TaskLoopStartError);
		return (error as Error).message;
	}
	throw new Error("expected a refusal");
};

describe("task/group: The judge contract is checked before anything runs", () => {
	it("Scenario: A script without rework_task is refused", () => {
		const message = refusal(GROUP_JUDGE.replace('    rework_task: mutable string = ""\n', ""));
		expect(message).toContain("rework_task");
	});

	it("refuses a mistyped variable by name", () => {
		const message = refusal(GROUP_JUDGE.replace("group_number: mutable number = 1", 'group_number: mutable string = ""'));
		expect(message).toContain("group_number");
		expect(message).toContain("number");
	});

	it("passes a script that declares every variable", () => {
		expect(() => checkGroupContract(GROUP_JUDGE)).not.toThrow();
	});
});

describe("task/group: The judge is seeded with the group and the failing check", () => {
	const seed = seedGroupJudge({
		group: 1,
		title: "Setup",
		tasks: [
			{ id: "1.1", text: "first", status: "converged" },
			{ id: "1.2", text: "second", status: "converged" },
		],
		proposal: "why",
		deltas: "what",
		checks: [
			{ command: "pnpm check", exitCode: 0, output: "fine" },
			{ command: "pnpm test", exitCode: 1, output: "2 failed: value.test.ts" },
		],
		reworks: 1,
	});

	it("Scenario: The judge sees the check output", () => {
		const output = seed["check_output"] as string;
		expect(output).toContain("pnpm test");
		expect(output).toContain("exit 1");
		expect(output).toContain("2 failed: value.test.ts");
		expect(output).not.toContain("pnpm check");
	});

	it("seeds numbers as numbers and tasks one per line", () => {
		expect(seed["group_number"]).toBe(1);
		expect(seed["rework_count"]).toBe(1);
		expect(seed["group_title"]).toBe("Setup");
		expect(seed["tasks"]).toBe("1.1 first — converged\n1.2 second — converged");
	});
});

describe("task/group: The judge's verdict is read back from four variables", () => {
	const ids = ["1.1", "1.2"];
	const vars = (over: Record<string, string>) => ({ next_action: "", rework_task: "", feedback: "", question: "", ...over });

	it("Scenario: The judge reworks a task", () => {
		expect(readGroupVerdict(vars({ next_action: "rework", rework_task: "1.1", feedback: "restore the import" }), ids)).toEqual({
			kind: "rework",
			task: "1.1",
			feedback: "restore the import",
		});
	});

	it("reads ask with its question", () => {
		expect(readGroupVerdict(vars({ next_action: "ask", question: "Drop scenario X?" }), ids)).toEqual({
			kind: "ask",
			question: "Drop scenario X?",
		});
	});

	it("reads amend-spec", () => {
		expect(readGroupVerdict(vars({ next_action: "amend-spec", question: "Scenario X contradicts Y" }), ids)).toEqual({
			kind: "amend-spec",
			question: "Scenario X contradicts Y",
		});
	});
});

describe("task/group: A judge answer outside the contract fails the group", () => {
	const ids = ["1.1", "1.2"];

	it("Scenario: The judge reworks a task outside the group", () => {
		const verdict = readGroupVerdict({ next_action: "rework", rework_task: "3.1", feedback: "x", question: "" }, ids);
		expect(verdict.kind).toBe("contract-broken");
		expect(verdict.kind === "contract-broken" && verdict.reason).toContain("3.1");
	});

	it("an unknown next_action is contract-broken", () => {
		const verdict = readGroupVerdict({ next_action: "frobnicate", rework_task: "", feedback: "", question: "" }, ids);
		expect(verdict.kind).toBe("contract-broken");
		expect(verdict.kind === "contract-broken" && verdict.reason).toContain("frobnicate");
	});

	it("a non-string variable is contract-broken", () => {
		const verdict = readGroupVerdict({ next_action: true, rework_task: "", feedback: "", question: "" }, ids);
		expect(verdict.kind).toBe("contract-broken");
	});
});
