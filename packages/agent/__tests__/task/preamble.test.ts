import { cpSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareTaskLoop, taskPreamble } from "../../src/task/index.js";
import { cleanTemps, JUDGE_ONLY, temp, tinyChange } from "./helpers.js";

afterEach(cleanTemps);

const INPUT = { change: "add-x", task: "2.1", taskText: "Do X", proposal: "P\n", design: "D", deltas: "## a/b\nR\n" };

describe("task/agent: The task preamble is fixed text over the loop's sources", () => {
	it("Scenario: The preamble for a change directory", () => {
		expect(taskPreamble(INPUT)).toBe(`You are working on one task of an OpenSpec change. The documents below are its contract; the instructions after them are this iteration's plan.

Change: add-x
Task 2.1: Do X

Rules:
- Change only what the task needs.
- Never tick boxes in tasks.md, and never edit the change's proposal, design or spec deltas.
- If the spec itself looks wrong, say so in your reply instead of coding around it.

# proposal.md

P

# design.md

D

# Spec deltas

## a/b
R

# Instructions`);
	});

	it("Scenario: An empty design is left out", () => {
		const preamble = taskPreamble({ ...INPUT, design: "" });
		expect(preamble.split("\n")).not.toContain("# design.md");
		expect(preamble).toContain("\n\nP\n\n# Spec deltas\n\n");
	});

	it("Scenario: A change given as texts has no Change line", () => {
		const input = prepareTaskLoop({
			change: { proposal: { text: "P" }, deltas: [{ text: "R" }], tasks: { text: "- [ ] 1.1 Do X\n" } },
			task: "1.1",
			script: { text: JUDGE_ONLY },
			workspace: temp("task-ws-"),
		});
		const preamble = taskPreamble(input);
		expect(preamble.split("\n").some((line) => line.startsWith("Change:"))).toBe(false);
		expect(preamble.split("\n\n")[1]?.startsWith("Task ")).toBe(true);
	});
});

describe("task/agent: The loop input names the change it came from", () => {
	it("Scenario: A directory change is named", () => {
		const root = temp("task-repo-");
		const dir = join(root, "openspec", "changes", "add-x");
		cpSync(tinyChange(), dir, { recursive: true });
		const input = prepareTaskLoop({ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace: root });
		expect(input.change).toBe("add-x");
		expect(taskPreamble(input).split("\n\n")[1]).toBe("Change: add-x\nTask 1.1: `src/value.txt` holds 2");
	});
});
