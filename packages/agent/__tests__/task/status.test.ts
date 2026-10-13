import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { formatLoop, summarize } from "../../src/task/status.js";
import { cli, fauxModels, workdir } from "./cli-helpers.js";
import { cleanTemps, context, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

describe("task/headless: status lists the loops in the database", () => {
	it("Scenario: Two loops are listed newest first", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const first = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		env.faux.setResponses([verdict(false, "two ways", "ask", "Which way?")]);
		const second = await cli(["run", tinyChange(), "1.2", "--db", db, "--script", script, ...env.args], env);
		const id = (r: typeof first) => /^loop (\d+)/.exec(r.errLines[0] ?? "")?.[1];
		const r = await cli(["status", "--db", db]);
		expect(r.code).toBe(0);
		const lines = r.out.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(`loop ${id(second)}  tiny  1.2  blocked  1 iteration`);
		expect(lines[1]).toBe(`loop ${id(first)}  tiny  1.1  converged  1 iteration`);
	});

	it("Scenario: An empty database", async () => {
		const { db, dir } = workdir();
		const storage = await openNodeSqliteStorage(db);
		await storage.close(context);
		const r = await cli(["status", "--db", "loops.sqlite"], fauxModels(), { cwd: dir });
		expect(r.out).toBe("no loops in loops.sqlite");
		expect(r.code).toBe(0);
		expect(db).toBe(join(dir, "loops.sqlite"));
	});

	it("a database file that does not exist has no loops, and is not created", async () => {
		const { db } = workdir();
		const r = await cli(["status", "--db", db]);
		expect(r.out).toBe(`no loops in ${db}`);
		expect(r.code).toBe(0);
		expect(existsSync(db)).toBe(false);
	});

	it("summarizes running and failed loops, and shows a worktree loop's branch", () => {
		const input = { task: "2.4", tasksPath: "/r/openspec/changes/c/tasks.md", earlier: [], worktree: { path: "/w", branch: "task/c/2.4" } };
		const running = summarize({ id: 3, input, state: { status: "waiting", checkpoint: { phase: "await", iterations: [{}], carried: "" } } });
		expect(running).toEqual({ id: 3, change: "c", task: "2.4", status: "running", iterations: 1, branch: "task/c/2.4" });
		expect(formatLoop(running)).toBe("loop 3  c  2.4  running  1 iteration  task/c/2.4");
		const failed = summarize({ id: 4, input: { ...input, worktree: undefined }, state: { status: "terminal", outcome: { status: "failed", error: { message: "x" } } } });
		expect(formatLoop(failed)).toBe("loop 4  c  2.4  failed  0 iterations");
	});

	it("Scenario: status shows the stage", () => {
		const taskInput = { task: "1.1", tasksPath: "/r/openspec/changes/add-plan-export/tasks.md", earlier: [] };
		const task = summarize({ id: 5, kind: "agentscript.task-loop", input: taskInput, state: { status: "waiting", checkpoint: { phase: "await", iterations: [], carried: "" } } });
		const spec = summarize({
			id: 6,
			kind: "agentscript.spec-loop",
			input: { change: "add-plan-export", stage: { name: "proposal", owns: ["proposal.md"] } },
			state: { status: "waiting", checkpoint: { phase: "await", iterations: [{}], carried: "" } },
		});
		expect(formatLoop(spec)).toBe("loop 6  add-plan-export  spec proposal  running  1 iteration");
		expect(formatLoop(task)).toBe("loop 5  add-plan-export  1.1  running  0 iterations");
		const plain = summarize({ id: 7, kind: "agentscript.spec-loop", input: { change: "add-plan-export", stage: "proposal" }, state: { status: "waiting" } });
		expect(plain.task).toBe("spec proposal");
		const old = summarize({ id: 8, kind: "agentscript.spec-loop", input: { change: "add-plan-export" }, state: { status: "terminal", outcome: { status: "failed", error: { message: "x" } } } });
		expect(formatLoop(old)).toBe("loop 8  add-plan-export  spec ?  failed  0 iterations");
	});

	it("status with no --db and no config prints usage", async () => {
		const r = await cli(["status"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
	});
});

describe("task/cli: The CLI has four commands and prints usage otherwise", () => {
	it("Scenario: An unknown command prints usage", async () => {
		const r = await cli(["frobnicate"]);
		expect(r.err).toContain("usage:");
		expect(r.code).toBe(2);
	});

	it("Scenario: No command prints usage", async () => {
		const r = await cli([]);
		expect(r.err.startsWith("usage:")).toBe(true);
		expect(r.err).toContain("agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]");
		expect(r.err).toContain("agentscript-task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]");
		expect(r.err).toContain("agentscript-task resume <loop-id> [--db <path>] [--json]");
		expect(r.err).toContain("agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]");
		expect(r.err).toContain("agentscript-task status [--db <path>]");
		expect(r.code).toBe(2);
	});

	it("Scenario: status is a command", async () => {
		const { db } = workdir();
		const r = await cli(["status", "--db", db]);
		expect(r.err).not.toContain("usage:");
		expect(r.code).toBe(0);
	});

	it("an unknown flag prints the reason and usage, exit 2", async () => {
		const r = await cli(["run", "x", "1.1", "--db", "y", "--frob"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("--frob");
		expect(r.err).toContain("usage:");
	});
});
