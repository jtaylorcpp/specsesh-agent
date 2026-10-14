import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type Harness, type TaskId } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import type { Escalation } from "../../src/openspec/index.js";
import { TaskLoopStartError, groupLoopExtensions, startGroupLoop, waitForGroupLoop } from "../../src/task/index.js";
import type { GroupLoopOptions } from "../../src/task/group.js";
import { checkGroupContract, readGroupVerdict, seedGroupJudge } from "../../src/task/group-judge.js";
import { openHarness, setup } from "../durable/helpers.js";
import { GROUP_JUDGE as SHARED_GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, temp, tinyChange, verdict } from "./helpers.js";
import { stagedCheck } from "./staged-check.js";

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
    amend_path: mutable string = ""
    amend_text: mutable string = ""

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

	it("refuses a script without amend_path or amend_text by name", () => {
		for (const name of ["amend_path", "amend_text"]) {
			const message = refusal(GROUP_JUDGE.replace(`    ${name}: mutable string = ""\n`, ""));
			expect(message).toContain(`${name} is not declared; declare it as string`);
		}
	});

	it("refuses an amend_path that is not a string", () => {
		const message = refusal(GROUP_JUDGE.replace('amend_path: mutable string = ""', "amend_path: mutable number = 0"));
		expect(message).toContain("amend_path is declared number; the contract needs string");
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
			amendmentNote: "amendment dropped: amend_path is empty",
		});
	});
});

describe("task/group: The group judge reads back an amendment", () => {
	const ids = ["1.1", "1.2"];
	const vars = (over: Record<string, string>) => ({ next_action: "", rework_task: "", feedback: "", question: "", ...over });
	const path = "specs/task/queue/spec.md";
	const text = "## MODIFIED Requirements\n\n### Requirement: Empty queue\n…";

	it("builds the Amendment from amend_path and amend_text, unchanged", () => {
		const verdict = readGroupVerdict(vars({ next_action: "amend-spec", amend_path: path, amend_text: text }), ids);
		expect(verdict).toEqual({ kind: "amend-spec", question: "", amendment: { delta: path, text } });
		expect(verdict.kind === "amend-spec" && verdict.amendment?.text).toBe(text);
	});

	it("keeps surrounding whitespace in amend_text", () => {
		const padded = `\n${text}\n\n`;
		const verdict = readGroupVerdict(vars({ next_action: "amend-spec", amend_path: path, amend_text: padded }), ids);
		expect(verdict.kind === "amend-spec" && verdict.amendment).toEqual({ delta: path, text: padded });
	});

	it("ignores the amendment variables on ask and rework", () => {
		expect(readGroupVerdict(vars({ next_action: "ask", question: "Drop scenario X?", amend_path: path, amend_text: text }), ids)).toEqual({
			kind: "ask",
			question: "Drop scenario X?",
		});
		expect(readGroupVerdict(vars({ next_action: "rework", rework_task: "1.1", feedback: "f", amend_path: path, amend_text: text }), ids)).toEqual({
			kind: "rework",
			task: "1.1",
			feedback: "f",
		});
	});

	it("drops the amendment when amend_text is blank", () => {
		for (const blank of ["", " \n\t"]) {
			expect(readGroupVerdict(vars({ next_action: "amend-spec", question: "How should it read?", amend_path: path, amend_text: blank }), ids)).toEqual({
				kind: "amend-spec",
				question: "How should it read?",
				amendmentNote: "amendment dropped: amend_text is empty",
			});
		}
	});

	it("drops the amendment when amend_path is empty, checking the path first", () => {
		for (const amend_text of [text, ""]) {
			expect(readGroupVerdict(vars({ next_action: "amend-spec", amend_path: "", amend_text }), ids)).toEqual({
				kind: "amend-spec",
				question: "",
				amendmentNote: "amendment dropped: amend_path is empty",
			});
		}
	});

	it("reads a missing or non-string amendment variable as empty", () => {
		expect(readGroupVerdict({ ...vars({ next_action: "amend-spec", amend_path: path }), amend_text: 3 }, ids)).toEqual({
			kind: "amend-spec",
			question: "",
			amendmentNote: "amendment dropped: amend_text is empty",
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

// Full runs: in-memory store, the faux model, a staged check. Both child tasks converge, then the
// group check fails, so the judge runs once with the answer the test gives.
const AMEND_TEXT = "## MODIFIED Requirements\n\n### Requirement: Empty queue\n…";
// The shared judge never sets the amendment variables; this one sets all six from the result.
const AMENDING_JUDGE = SHARED_GROUP_JUDGE.replace(
	"            set @variables.question = @outputs.question\n",
	"            set @variables.question = @outputs.question\n" +
		"            set @variables.amend_path = @outputs.amend_path\n" +
		"            set @variables.amend_text = @outputs.amend_text\n",
);
const judgeSays = (vars: Record<string, string>) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { next_action: "", rework_task: "", feedback: "", question: "", amend_path: "", amend_text: "", ...vars })], {
		stopReason: "toolUse",
	});

const opened: Harness[] = [];
afterEach(async () => {
	for (const harness of opened.splice(0)) await harness.close(context).catch(() => undefined);
	cleanTemps();
});

async function runJudged(judge: Record<string, string>, change?: GroupLoopOptions["change"], over: Partial<GroupLoopOptions> = {}) {
	const workspace = temp("group-judge-ws-");
	const checks = [stagedCheck([true, true, false]).command];
	const env = setup();
	for (const extension of groupLoopExtensions({ workspace, checks })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	opened.push(harness);
	env.faux.setResponses([verdict(true), verdict(true), judgeSays(judge)]);
	const id = await startGroupLoop(
		harness,
		{
			change: change ?? { dir: tinyChange({ capabilities: ["task/queue"] }) },
			group: 1,
			script: { text: JUDGE_ONLY },
			groupScript: { text: AMENDING_JUDGE },
			workspace,
			checks,
			model: env.model,
			...over,
		},
		context,
	);
	harness.resume();
	const outcome = await waitForGroupLoop(harness, id, context);
	const settled = await harness.waitForTask(id as unknown as TaskId<never>, context);
	const notes = ((settled.state.outcome as unknown as { result?: { notes: string[] } }).result?.notes ?? []) as string[];
	const runs = (await storage.scanTasks({ kind: "agentscript.run" }, 50, undefined, context)).items;
	const judgeRuns = runs.filter((t) => JSON.stringify((t.input as unknown as { options: { choices?: unknown } }).options.choices).includes('"rework"'));
	return { outcome, notes, judgeRuns, escalation: (outcome as unknown as { escalation: Escalation }).escalation };
}

describe("task/group: the judge's amendment on a real loop", () => {

	it("Scenario: An amend-spec verdict yields an Amendment", async () => {
		const amend = { next_action: "amend-spec", question: "Replace the queue delta?", amend_path: "specs/task/queue/spec.md", amend_text: AMEND_TEXT };
		const { outcome, escalation, judgeRuns } = await runJudged(amend);
		expect(outcome.status).toBe("blocked");
		expect(escalation.reason).toBe("spec-defect: amend-spec");

		// The judge run's variables, as the loop read them back, build the Amendment unchanged.
		expect(judgeRuns).toHaveLength(1);
		const variables = (judgeRuns[0]?.state as unknown as { outcome: { result: { variables: Record<string, string> } } }).outcome.result.variables;
		const read = readGroupVerdict(variables, ["1.1", "1.2"]);
		expect(read).toEqual({ kind: "amend-spec", question: "Replace the queue delta?", amendment: { delta: "specs/task/queue/spec.md", text: AMEND_TEXT } });
		expect(read.kind === "amend-spec" && read.amendment?.text).toBe(AMEND_TEXT);
	});

	it("Scenario: ask ignores the amendment variables", async () => {
		const ask = { next_action: "ask", question: "Drop scenario X?", amend_path: "specs/task/queue/spec.md", amend_text: AMEND_TEXT };
		const { outcome, escalation, notes } = await runJudged(ask);
		expect(outcome.status).toBe("blocked");
		expect(escalation.level).toBe("group");
		expect(escalation.to).toBe("principal");
		expect(escalation.question).toBe("Drop scenario X?");
		expect(escalation).not.toHaveProperty("amendment");
		expect(notes.filter((note) => note.includes("amendment dropped"))).toEqual([]);
	});

	it("Scenario: The amend_path choices list the change's deltas", async () => {
		// A `{ dir }` change sorts its deltas by capability (group before queue); listed sources keep their order.
		const dir = tinyChange({ capabilities: ["task/queue", "task/group"], design: "## Context\n" });
		const { judgeRuns } = await runJudged(
			{ next_action: "ask", question: "Which delta?" },
			{
				proposal: { path: join(dir, "proposal.md") },
				design: { path: join(dir, "design.md") },
				deltas: [{ path: join(dir, "specs/task/queue/spec.md") }, { path: join(dir, "specs/task/group/spec.md") }],
				tasks: { path: join(dir, "tasks.md") },
			},
		);
		expect(judgeRuns).toHaveLength(1);
		expect((judgeRuns[0]?.input as unknown as { options: { choices: unknown } }).options.choices).toEqual({
			next_action: ["rework", "ask", "amend-spec"],
			amend_path: ["", "specs/task/queue/spec.md", "specs/task/group/spec.md"],
		});
	});
});

describe("task/group: ask and amend-spec block the group", () => {
	const QUEUE = "specs/task/queue/spec.md";
	// Padded on both sides, so an exact match proves the text is not trimmed.
	const PADDED = "  ## MODIFIED Requirements\n\n### Requirement: Empty queue\nThe queue SHALL skip ticked tasks.\n\n#### Scenario: Empty queue\n- **WHEN** …\n";

	// The round the judge blocked on: its one feedback, and the finding behind it.
	const lastFeedback = (outcome: unknown) => {
		const iterations = (outcome as { iterations: { feedback: { action: string; from: { kind: string } }[] }[] }).iterations;
		return iterations[iterations.length - 1]?.feedback;
	};
	const specDefect = [expect.objectContaining({ action: "amend-spec", from: expect.objectContaining({ kind: "spec-defect" }) })];
	const snapshot = (dir: string) => readdirSync(dir, { recursive: true, withFileTypes: true })
		// tasks.md is left out: the child task loops tick it before the judge runs.
		.filter((entry) => entry.isFile() && entry.name !== "tasks.md")
		.map((entry) => {
			const path = join(entry.parentPath, entry.name);
			return { path, text: readFileSync(path, "utf8"), mtime: statSync(path).mtimeMs };
		})
		.sort((a, b) => a.path.localeCompare(b.path));

	it("Scenario: The judge asks the principal", async () => {
		const { outcome, escalation } = await runJudged({ next_action: "ask", question: "Drop scenario X?" }, undefined, { escalateTo: "principal" });
		expect(outcome.status).toBe("blocked");
		expect(escalation).toMatchObject({ level: "group", to: "principal", question: "Drop scenario X?" });
		expect("amendment" in escalation).toBe(false);
	});

	it("Scenario: The escalation carries the judge's amendment", async () => {
		const dir = tinyChange({ capabilities: ["task/queue"] });
		const before = snapshot(dir);
		expect(before.map((file) => file.path)).toContain(join(dir, QUEUE));
		const question = "Scenario 'Empty queue' contradicts the ticked-task rule; replace the delta?";
		const amend = { next_action: "amend-spec", question, amend_path: QUEUE, amend_text: PADDED };
		const { outcome, escalation, notes } = await runJudged(amend, { dir }, { escalateTo: "principal" });
		expect(outcome.status).toBe("blocked");
		expect(escalation.level).toBe("group");
		expect(escalation.to).toBe("principal");
		expect(escalation.question).toBe(question);
		expect(escalation.amendment).toStrictEqual({ delta: QUEUE, text: PADDED });
		expect(lastFeedback(outcome)).toEqual(specDefect);
		expect(notes.filter((note) => note.includes("amendment dropped"))).toEqual([]);
		// The loop only escalates: no change file was written, not even with the same text.
		expect(snapshot(dir)).toEqual(before);
	});

	it("Scenario: A blank amend_text drops the amendment", async () => {
		const question = "The queue delta looks wrong; how should it read?";
		for (const blank of ["", "  \n"]) {
			const { outcome, escalation, notes } = await runJudged({ next_action: "amend-spec", question, amend_path: QUEUE, amend_text: blank });
			expect(notes).toContain("amendment dropped: amend_text is empty");
			expect(outcome.status).toBe("blocked");
			expect(escalation.level).toBe("group");
			expect(escalation.question).toBe(question);
			expect("amendment" in escalation).toBe(false);
			expect(lastFeedback(outcome)).toEqual(specDefect);
		}
	});

	it("Scenario: An empty amend_path drops the amendment", async () => {
		const amend = { next_action: "amend-spec", question: "Which delta is wrong?", amend_path: "", amend_text: PADDED };
		const { outcome, escalation, notes } = await runJudged(amend);
		expect(notes).toContain("amendment dropped: amend_path is empty");
		expect(outcome.status).toBe("blocked");
		expect(escalation.level).toBe("group");
		expect("amendment" in escalation).toBe(false);
	});
});
