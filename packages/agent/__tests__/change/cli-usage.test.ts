/**
 * change/cli: usage, and how `draft` starts a new change. `agentscript-change` in
 * process, on a faux model, in a temp workspace whose config names the changes
 * directory and the database.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { cleanTemps } from "../task/helpers.js";
import { draft } from "../task/spec-helpers.js";
import { CHANGE, change, loopsIn, workspace } from "./helpers.js";

afterEach(cleanTemps);

describe("change/cli usage", () => {
	it("Scenario: No command prints usage", async () => {
		const { dir } = workspace();
		const run = await change([], dir);
		expect(run.code).toBe(2);
		expect(run.err.startsWith("usage:")).toBe(true);
		expect(run.err).toContain("agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]");
		expect(run.err).toContain("agentscript-change approve <change> [--principal <name>] [--db <path>]");
	});

	it("Scenario: An unknown command prints usage", async () => {
		const { dir } = workspace();
		const run = await change(["frobnicate", CHANGE], dir);
		expect(run.code).toBe(2);
		expect(run.err).toContain("usage:");
	});

	it("Scenario: A new change starts at the proposal", async () => {
		const { dir, changesDir, db } = workspace();
		// The stage asks at once, so the loop blocks without reaching the gate.
		await change(["draft", CHANGE, "--intent", "Export a plan"], dir, [draft("", "ask", "CSV too?")]);
		expect(readFileSync(join(changesDir, CHANGE, "intent.md"), "utf8").trim()).toBe("Export a plan");

		const specLoops = (await loopsIn(db)).filter((loop) => loop.change === CHANGE && loop.task.startsWith("spec "));
		const first = specLoops.sort((a, b) => a.id - b.id)[0];
		expect(SPEC_STAGES[0]!.name).toBe("proposal");
		expect(SPEC_STAGES[0]!.owns).toContain("proposal.md");
		expect(first?.task).toBe(`spec ${SPEC_STAGES[0]!.name}`);
	});

	it("Scenario: A new change without an intent is refused", async () => {
		const { dir, changesDir, db } = workspace();
		const run = await change(["draft", CHANGE], dir);
		expect(run.code).toBe(2);
		expect(run.err).toContain("--intent");
		expect(existsSync(join(changesDir, CHANGE))).toBe(false);
		// Refused before the database opens, so no loop can have been recorded.
		expect(existsSync(db)).toBe(false);
	});
});
