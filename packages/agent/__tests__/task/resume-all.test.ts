import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonObject, StorageWrite } from "@earendil-works/pi-durable";
import { openNodeSqliteDatabase, openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { TASK_LOOP } from "../../src/task/loop.js";
import { resumeAll, type ResumeOne, type RootResult } from "../../src/task/resume-all.js";
import { SPEC_LOOP } from "../../src/task/spec-loop.js";
import { cleanTemps, context, temp } from "./helpers.js";

afterEach(() => cleanTemps());

const LABEL = ".agentscript/task-loops.sqlite";

type JsonValue = JsonObject[string];
type StoredTask = Extract<StorageWrite, { type: "task" }>["value"];

type Loop = {
	id: number;
	kind: string;
	input: JsonValue;
	owner?: number;
	startedAt?: number;
	/** Running when absent. */
	outcome?: JsonValue;
};

const tasksPath = (change: string) => `/r/openspec/changes/${change}/tasks.md`;
const task = (id: number, change: string, name: string, more: Partial<Loop> = {}): Loop => ({
	id,
	kind: TASK_LOOP,
	input: { task: name, tasksPath: tasksPath(change), earlier: [] },
	...more,
});
const group = (id: number, change: string, n: number, more: Partial<Loop> = {}): Loop => ({
	id,
	kind: GROUP_LOOP_NAME,
	input: { group: n, tasksPath: tasksPath(change) },
	...more,
});
const spec = (id: number, change: string, stage: string, more: Partial<Loop> = {}): Loop => ({
	id,
	kind: SPEC_LOOP,
	input: { change, stage: { name: stage, owns: [`${stage}.md`] } },
	...more,
});
const ended = (status: string): JsonValue => ({ status: "completed", result: { outcome: { status, iterations: [{}] } } });

/** A database holding exactly `loops`, none with an owner row and no lock: every running one is interrupted. */
async function database(loops: readonly Loop[]): Promise<string> {
	const dir = temp("resume-all-");
	mkdirSync(join(dir, ".agentscript"));
	const db = join(dir, LABEL);
	const storage = await openNodeSqliteStorage(db);
	try {
		const writes: StorageWrite[] = loops.map((loop) => ({
			type: "task",
			value: {
				id: loop.id,
				conversationId: 1,
				kind: loop.kind,
				version: 1,
				input: loop.input,
				...(loop.owner !== undefined ? { owner: loop.owner } : {}),
				background: false,
				abortRequested: false,
				...(loop.startedAt !== undefined ? { startedAt: loop.startedAt } : {}),
				state:
					loop.outcome === undefined
						? { status: "running", checkpoint: { phase: "await", iterations: [], carried: "" } }
						: { status: "terminal", outcome: loop.outcome },
			} as unknown as StoredTask,
		}));
		await storage.commit(writes, context);
	} finally {
		await storage.close(context);
	}
	return db;
}

/** `resumeAll` over `db` with a stub resumer: the roots it was given, in order. */
async function resumeWith(db: string, answer: (id: number) => RootResult | Promise<RootResult>) {
	const resumed: number[] = [];
	const resumeOne: ResumeOne = async (root) => {
		resumed.push(root.loop.id);
		return await answer(root.loop.id);
	};
	const storage = await openNodeSqliteStorage(db);
	const sql = await openNodeSqliteDatabase(db);
	try {
		const result = await resumeAll({ storage, sql, db: { path: db, label: LABEL }, lockPid: undefined, resumeOne, context });
		return { ...result, resumed };
	} finally {
		await sql.close();
		await storage.close(context);
	}
}

/** Loops 10 in group 11 and 14 in group 13, group 13 started first; 9 converged and 12 blocked. */
const NESTED: readonly Loop[] = [
	task(9, "add-resume-hint", "2.1", { startedAt: 500, outcome: ended("converged") }),
	task(10, "add-resume-hint", "2.2", { owner: 11, startedAt: 2100 }),
	group(11, "add-resume-hint", 2, { startedAt: 2000 }),
	task(12, "add-plan-schema", "2.1", { startedAt: 100, outcome: ended("blocked") }),
	group(13, "add-plan-export", 1, { startedAt: 1000 }),
	task(14, "add-plan-export", "1.3", { owner: 13, startedAt: 1100 }),
];

describe("task/cli: resume --all resumes each interrupted loop once through its root", () => {
	it("Scenario: Nested loops resume through their parents in start order", async () => {
		const r = await resumeWith(await database(NESTED), () => ({ status: "converged" }));
		expect(r.resumed).toEqual([13, 11]);
		expect(r.lines).toEqual(["loop 13 add-plan-export group 1 (via 14) — converged", "loop 11 add-resume-hint group 2 (via 10) — converged"]);
		expect(r.exitCode).toBe(0);
	});

	it("Scenario: A refused root does not stop the batch", async () => {
		const db = await database([
			task(10, "add-resume-hint", "2.2", { owner: 11, startedAt: 1100 }),
			group(11, "add-resume-hint", 2, { startedAt: 1000 }),
			group(13, "add-plan-export", 1, { startedAt: 2000 }),
		]);
		const r = await resumeWith(db, (id) => {
			if (id === 11) throw new Error("worktree /w/add-resume-hint-2 no longer exists");
			return { status: "converged" };
		});
		expect(r.lines[0]?.startsWith("loop 11 add-resume-hint group 2 (via 10) — refused: ")).toBe(true);
		expect(r.lines[0]).toContain("worktree /w/add-resume-hint-2 no longer exists");
		expect(r.resumed).toEqual([11, 13]);
		expect(r.lines[1]).toBe("loop 13 add-plan-export group 1 — converged");
		expect(r.exitCode).toBe(1);
	});

	it("a root whose parent has ended is its own root", async () => {
		const db = await database([
			group(20, "c", 1, { startedAt: 1000, outcome: ended("converged") }),
			task(21, "c", "1.1", { owner: 20, startedAt: 1100 }),
		]);
		const r = await resumeWith(db, () => ({ status: "exhausted" }));
		expect(r.resumed).toEqual([21]);
		expect(r.lines).toEqual(["loop 21 c 1.1 — exhausted"]);
		expect(r.exitCode).toBe(1);
	});

	it("roots that started at the same time go by loop id", async () => {
		const db = await database([task(31, "c", "1.2", { startedAt: 1000 }), task(30, "c", "1.1", { startedAt: 1000 })]);
		const r = await resumeWith(db, () => ({ status: "converged" }));
		expect(r.resumed).toEqual([30, 31]);
	});
});

describe("task/cli: resume --all prints one outcome line per root", () => {
	it("Scenario: A blocked root ends with the answer command", async () => {
		const db = await database([group(13, "add-plan-export", 1, { startedAt: 1000 }), task(14, "add-plan-export", "1.3", { owner: 13, startedAt: 1100 })]);
		const r = await resumeWith(db, () => ({ status: "blocked", to: "principal" }));
		expect(r.lines).toContain(
			'loop 13 add-plan-export group 1 (via 14) — blocked: agentscript-task answer 13 --db .agentscript/task-loops.sqlite --by principal --decision "…"',
		);
		expect(r.exitCode).toBe(1);
	});

	it("Scenario: Nothing to resume", async () => {
		const db = await database([task(9, "c", "1.1", { outcome: ended("converged") }), task(12, "c", "1.2", { outcome: ended("blocked") })]);
		const r = await resumeWith(db, () => ({ status: "converged" }));
		expect(r.lines).toEqual(["no interrupted loops in .agentscript/task-loops.sqlite"]);
		expect(r.exitCode).toBe(0);
		expect(r.resumed).toEqual([]);
	});

	it("a spec loop blocked for review exits 0", async () => {
		const db = await database([spec(40, "add-plan-export", "proposal", { startedAt: 1000 })]);
		const r = await resumeWith(db, () => ({ status: "blocked", to: "principal", reason: "review" }));
		expect(r.lines).toEqual([
			'loop 40 add-plan-export spec proposal — blocked: agentscript-task answer 40 --db .agentscript/task-loops.sqlite --by principal --decision "…"',
		]);
		expect(r.exitCode).toBe(0);
	});
});
