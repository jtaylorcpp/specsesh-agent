import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineExtension, defineTask } from "@earendil-works/pi-durable";
import { openNodeSqliteDatabase, openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { main } from "../../src/bin/agentscript-task.js";
import { TASK_LOOP } from "../../src/task/index.js";
import { isAlive } from "../../src/task/lock.js";
import { currentBootAt, writeOwner } from "../../src/task/owner.js";
import { SPEC_LOOP } from "../../src/task/spec-loop.js";
import { formatLoop, markInterrupted, summarize, type LoopSummary } from "../../src/task/status.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cli, fauxModels, workdir } from "./cli-helpers.js";
import { cleanTemps, context, temp, tinyChange, verdict } from "./helpers.js";
import { draft, proposalStage } from "./spec-helpers.js";

afterEach(() => cleanTemps());

/** The id in the first stderr line, `loop <id> — resume with: …`. */
const idOf = (errLines: readonly string[]) => Number(/^loop (\d+) — resume with: /.exec(errLines[0] ?? "")?.[1]);

/** The status line for loop `id`, matched on its columns rather than their widths. */
const lineOf = (lines: readonly string[], id: number) => lines.find((l) => new RegExp(`^loop\\s+${id}\\s`).test(l)) ?? "";

/** A stand-in `agentscript.task-loop`: created and never resumed, so it stays a loop with no outcome. */
const StandInLoopTask = defineTask<{ task: string; tasksPath: string; earlier: [] }, { phase: "await"; iterations: []; carried: "" }, never>({
	name: TASK_LOOP,
	version: 1,
	initial: () => ({ phase: "await", iterations: [], carried: "" }),
	phases: { await: async () => {} },
	abort: async (_t, runtime, ctx) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), ctx);
	},
});

/** One task loop with no outcome for `task` in the database at `db`; its id. */
async function runningLoop(db: string, task: string): Promise<number> {
	const env = setup();
	env.registry.install(defineExtension({ name: TASK_LOOP, tasks: [StandInLoopTask] }));
	const harness = await openHarness(await openNodeSqliteStorage(db), env);
	try {
		const owner = await harness.root(context);
		const input = { task, tasksPath: "/r/openspec/changes/tiny/tasks.md", earlier: [] as [] };
		return Number(await owner.commit((tx) => tx.createTask(StandInLoopTask, input, { ownership: { kind: "conversation" } }), context));
	} finally {
		await harness.close(context);
	}
}

/** A pid that was alive a moment ago and is not now. */
function deadPid(): number {
	const pid = spawnSync(process.execPath, ["-e", ""]).pid;
	expect(isAlive(pid)).toBe(false);
	return pid;
}

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

	it("Scenario: A group loop and its task loops are listed", async () => {
		const { dir, script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true), verdict(true)]);
		const g = await cli(["run", tinyChange(), "1", "--db", db, "--script", script, "--workspace", dir, "--check", "node --version", ...env.args], env);
		expect(g.code, g.err).toBe(0);
		const r = await cli(["status", "--db", db]);
		expect(r.code).toBe(0);
		const lines = r.out.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines.at(-1)).toBe(`loop ${idOf(g.errLines)}  tiny  group 1  converged  1 iteration`);
		expect(lines.filter((l) => l.includes("  1.1  converged"))).toHaveLength(1);
		expect(lines.filter((l) => l.includes("  1.2  converged"))).toHaveLength(1);
		const ids = lines.map((l) => Number(/^loop (\d+)/.exec(l)?.[1]));
		expect(ids).toEqual([...ids].sort((a, b) => b - a));
	});

	it("Scenario: An interrupted loop is marked and a blocked one is not", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "two ways", "ask", "Which way?")]);
		const b = await cli(["run", tinyChange(), "1.2", "--db", db, "--script", script, ...env.args], env);
		expect(b.code).toBe(1);
		const blocked = idOf(b.errLines);
		const stale = await runningLoop(db, "1.1");
		const sql = await openNodeSqliteDatabase(db);
		try {
			await writeOwner(sql, stale, deadPid(), currentBootAt());
		} finally {
			await sql.close();
		}
		expect(existsSync(`${db}.lock`)).toBe(false);

		const r = await cli(["status", "--db", db]);
		expect(r.code, r.err).toBe(0);
		const lines = r.out.split("\n");
		expect(lineOf(lines, stale)).toMatch(new RegExp(`^loop\\s+${stale}\\s+tiny\\s+1\\.1\\s+interrupted\\b`));
		expect(lineOf(lines, blocked)).toMatch(new RegExp(`^loop\\s+${blocked}\\s+tiny\\s+1\\.2\\s+blocked\\b`));
		expect(lineOf(lines, blocked)).not.toContain("interrupted");
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

	it("markInterrupted relabels only running loops, never blocked or ended ones", () => {
		const loop = (id: number, status: LoopSummary["status"]): LoopSummary => ({ id, change: "c", task: "1.1", status, iterations: 1 });
		const loops = [loop(1, "converged"), loop(2, "exhausted"), loop(3, "failed"), loop(4, "blocked"), loop(5, "running"), loop(6, "running")];
		const boot = 1_760_000_000_000;
		// Every loop but 6 has a dead owner; no live process holds the lock.
		const owners = new Map(loops.slice(0, 5).map((l) => [l.id, { pid: 100, bootAt: boot }]));
		const marked = markInterrupted(loops, owners, undefined, boot, () => false);
		expect(marked.map((l) => l.status)).toEqual(["converged", "exhausted", "failed", "blocked", "interrupted", "interrupted"]);
		expect(formatLoop(marked[4]!)).toBe("loop 5  c  1.1  interrupted  1 iteration");
	});

	it("status with no --db and no config prints usage", async () => {
		const r = await cli(["status"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
	});
});

describe("task/cli: The CLI has five commands and prints usage otherwise", () => {
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
		expect(r.err).toContain("agentscript-task resume <loop-id>|--all [--db <path>] [--json]");
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

describe("task/cli: The exit code says whether the loop converged", () => {
	it("Scenario: A spec loop waiting for review exits 0", async () => {
		const dir = temp("task-cli-spec-");
		const db = join(dir, ".agentscript", "spec.sqlite");
		const { faux, models } = fauxModels();
		faux.setResponses([draft("=== proposal.md\n# A proposal\n")]);
		const model = faux.getModel();
		const out: string[] = [];
		const err: string[] = [];
		const code = await main(["spec", "add-plan-export", "--intent", "Export a plan", "--db", db], {
			models: () => models,
			out: (line) => out.push(line),
			err: (line) => err.push(line),
			cwd: dir,
			env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id },
			stages: [proposalStage()],
		});
		expect(code, err.join("\n")).toBe(0);
		expect(out.join("\n")).toMatch(/^# spec loop \d+ — blocked \(review\)/);
		const storage = await openNodeSqliteStorage(db);
		const page = await storage.scanTasks({ kind: SPEC_LOOP }, 10, undefined, context);
		await storage.close(context);
		expect(page.items).toHaveLength(1);
		const state = page.items[0]?.state as { outcome?: { result?: { outcome: { status: string; escalation?: { reason: string } } } } };
		const outcome = state.outcome?.result?.outcome;
		expect([outcome?.status, outcome?.escalation?.reason]).toEqual(["blocked", "review"]);
	});
});
