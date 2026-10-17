/**
 * Task hints name specsesh task: the spec resume hint, a blocked group's answer
 * command and the usage name `specsesh task`, never the old commands.
 */

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatGroupOutcome, main } from "../../src/bin/agentscript-task.js";
import type { GroupOutcome, LoopOutcome } from "../../src/openspec/index.js";
import { cli, fauxModels } from "./cli-helpers.js";
import { cleanTemps, temp } from "./helpers.js";
import { draft, proposalStage } from "./spec-helpers.js";

const USAGE_LINES = [
	"specsesh task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]",
	"specsesh task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]",
	"specsesh task resume <loop-id>|--all [--db <path>] [--json]",
	"specsesh task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]",
	"specsesh task status [--db <path>]",
] as const;

let dir: string;
let db: string;
beforeEach(() => {
	dir = temp("task-cli-specsesh-");
	db = join(dir, ".agentscript", "spec.sqlite");
});
afterEach(() => cleanTemps());

describe("task/cli: Task hints name specsesh task", () => {
	it("Scenario: The spec resume hint names specsesh task", async () => {
		const models = fauxModels();
		models.faux.setResponses([draft("=== proposal.md\n# A proposal\n")]);
		const model = models.faux.getModel();
		const err: string[] = [];
		const code = await main(["spec", "add-plan-export", "--intent", "Export a plan", "--db", db], {
			models: () => models.models,
			out: () => {},
			err: (line) => err.push(line),
			cwd: dir,
			env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id },
			stages: [proposalStage()],
		});
		expect(code, err.join("\n")).toBe(0);
		const lines = err.join("\n").split("\n");
		expect(lines.some((line) => /^loop \d+ — resume with: specsesh task resume \d+ --db /.test(line))).toBe(true);
		for (const line of lines) {
			expect(line).not.toContain("agentscript-task");
			expect(line).not.toContain("pnpm task");
		}
	});

	it("Scenario: A blocked group ends with the specsesh answer command", () => {
		const outcome = {
			status: "blocked",
			iterations: [],
			escalation: { level: "task", to: "principal", question: "Which way?" },
			result: { group: 1, tasks: [{ task: "1.1", runs: 1, outcome: { status: "blocked", iterations: [] } }] },
		} as unknown as LoopOutcome<GroupOutcome>;
		const text = formatGroupOutcome(9, outcome, "loops.sqlite").join("\n").trim();
		expect(text.split("\n").at(-1)).toBe('specsesh task answer 9 --db loops.sqlite --by principal --decision "…"');
	});

	it("Scenario: The task usage names no old command", async () => {
		const r = await cli([]);
		expect(r.code).toBe(2);
		expect(r.err.startsWith("usage:")).toBe(true);
		expect(r.err).not.toContain("agentscript-task");
		expect(r.err).not.toContain("pnpm task");
		for (const line of USAGE_LINES) expect(r.err).toContain(line);
	});
});
