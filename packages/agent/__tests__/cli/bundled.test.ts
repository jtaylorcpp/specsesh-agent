/**
 * package/explain: the catalogue behind `specsesh agents`, read from the shipped `.agent`
 * files and delegate scripts. These scenarios are covered at the catalogue level here; the
 * `agents --json` command that prints it comes with `explain.ts`.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUNDLED_DIR, findBundled, listBundled } from "../../src/cli/bundled.js";
import { EDIT_AGENT, READ_AGENT } from "../../src/durable/delegate-scripts.js";

const SHIPPED = [
	"task",
	"task-delegate",
	"group",
	"spec-proposal",
	"spec-design",
	"spec-specify",
	"spec-plan",
	"ci-test-pick",
	"read",
	"edit",
];

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("specsesh agents lists the bundled scripts", () => {
	it("Scenario: Every bundled script is listed", () => {
		const scripts = listBundled();
		const names = scripts.map((s) => s.name);
		expect(names).toEqual(expect.arrayContaining(SHIPPED));
		for (const name of SHIPPED) {
			const script = scripts.find((s) => s.name === name)!;
			expect(script.description, name).not.toBe("");
			expect(script.runBy, name).not.toBe("");
			expect(script.runBy, name).not.toBe("bundled");
		}
		expect(names).toEqual([...names].sort());
	});

	it("Scenario: A new bundled script appears without code", () => {
		const dir = mkdtempSync(join(tmpdir(), "bundled-"));
		temps.push(dir);
		cpSync(BUNDLED_DIR, dir, { recursive: true });
		writeFileSync(
			join(dir, "zz-new.agent"),
			'config:\n    agent_name: "zz"\n    description: "A script added by a test"\n\nvariables:\n    note: mutable string = ""\n\nsubagent s:\n    description: "Say the note"\n\n    reasoning:\n        instructions: ->\n            | Say {!@variables.note}.\n',
		);
		const added = listBundled({ dir }).find((s) => s.name === "zz-new");
		expect(added).toMatchObject({
			kind: "task",
			description: "A script added by a test",
			runBy: "bundled",
			reads: ["note"],
			writes: [],
			path: join(dir, "zz-new.agent"),
		});
	});

	it("reads and writes come from how the script uses each variable", () => {
		const task = findBundled("task")!;
		// `task_id` is read in a template and as a `with` argument under a `run`.
		expect(task.reads).toEqual(expect.arrayContaining(["task_id", "task_text", "iteration", "plan", "check_output"]));
		// `checks_passed` is set under a `run`; `plan` is set by one step and read by the next.
		expect(task.writes).toEqual(
			expect.arrayContaining(["plan", "checks_passed", "check_output", "met", "next_action", "question"]),
		);
		expect(task.writes).not.toContain("task_id");
	});

	it("delegate scripts are the shipped source text, with no path", () => {
		const read = findBundled("read")!;
		expect(read).toMatchObject({ kind: "delegate", source: READ_AGENT, reads: ["instructions"], writes: ["ok", "summary"] });
		expect(read.path).toBeUndefined();
		expect(findBundled("edit")!.source).toBe(EDIT_AGENT);
	});

	it("a script with errors fails, naming its file", () => {
		const dir = mkdtempSync(join(tmpdir(), "bundled-"));
		temps.push(dir);
		writeFileSync(join(dir, "broken.agent"), "variables:\n    x: mutable = \n");
		expect(() => listBundled({ dir, delegates: {} })).toThrow(join(dir, "broken.agent"));
	});
});
