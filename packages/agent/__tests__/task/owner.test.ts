import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { defineExtension, defineTask } from "@earendil-works/pi-durable";
import { type NodeSqliteDatabase, openNodeSqliteDatabase, openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it } from "vitest";
import { TASK_LOOP } from "../../src/task/index.js";
import { isAlive, readLockPid } from "../../src/task/lock.js";
import { currentBootAt, isInterrupted, isLoopInterrupted, readOwner, writeOwner, type LoopOwner } from "../../src/task/owner.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cli, fauxModels, workdir } from "./cli-helpers.js";
import { cleanTemps, context, temp, tinyChange, verdict } from "./helpers.js";

const open: NodeSqliteDatabase[] = [];
afterEach(async () => {
	for (const db of open.splice(0)) await db.close();
	cleanTemps();
});

async function database(): Promise<{ db: NodeSqliteDatabase; path: string }> {
	const path = join(temp("owner-"), "task-loops.sqlite");
	const db = await openNodeSqliteDatabase(path);
	open.push(db);
	return { db, path };
}

const BOOT = 1_760_000_000_000;
const aliveOnly =
	(...pids: number[]) =>
	(pid: number) =>
		pids.includes(pid);

describe("task/owner: the loop_owner record", () => {
	it("writeOwner then readOwner gives the row back, and a second write replaces it", async () => {
		const { db } = await database();
		expect(await readOwner(db, 7)).toBeUndefined();
		await writeOwner(db, 7, 100, BOOT);
		expect(await readOwner(db, 7)).toEqual({ pid: 100, bootAt: BOOT });
		await writeOwner(db, 7, 200, BOOT + 5000);
		expect(await readOwner(db, 7)).toEqual({ pid: 200, bootAt: BOOT + 5000 });
		expect(await db.all("SELECT * FROM loop_owner")).toHaveLength(1);
	});

	it("writeOwner defaults to this process and the current boot time", async () => {
		const { db } = await database();
		await writeOwner(db, 1);
		const owner = await readOwner(db, 1);
		expect(owner?.pid).toBe(process.pid);
		expect(Math.abs((owner?.bootAt ?? 0) - currentBootAt())).toBeLessThanOrEqual(1000);
	});

	it("currentBootAt is whole seconds, within 1 s of now minus uptime", () => {
		const bootAt = currentBootAt();
		expect(bootAt % 1000).toBe(0);
		expect(Math.abs(bootAt - (Date.now() - uptime() * 1000))).toBeLessThanOrEqual(1000);
		expect(currentBootAt(BOOT + 60_400, 60)).toBe(BOOT);
		expect(currentBootAt(BOOT + 60_600, 60)).toBe(BOOT + 1000);
	});
});

describe("task/owner: the interrupted rule", () => {
	it("a live lock on another loop does not hide a dead one", () => {
		const base = { status: "running" as const, lockPid: 200, bootAt: BOOT, alive: aliveOnly(200) };
		expect(isInterrupted({ ...base, owner: { pid: 100, bootAt: BOOT } })).toBe(true);
		expect(isInterrupted({ ...base, owner: { pid: 200, bootAt: BOOT } })).toBe(false);
		expect(isInterrupted({ ...base, owner: undefined })).toBe(false);
	});

	it("a reboot is caught despite a reused pid", () => {
		const owner = { pid: 4242, bootAt: BOOT - 60_000 };
		expect(isInterrupted({ status: "running", owner, lockPid: 4242, bootAt: BOOT, alive: aliveOnly(4242) })).toBe(true);
	});

	it("a missing lock or a dead holder interrupts loops with and without an owner", () => {
		for (const lockPid of [undefined, 300]) {
			const base = { status: "running" as const, lockPid, bootAt: BOOT, alive: aliveOnly() };
			expect(isInterrupted({ ...base, owner: { pid: 300, bootAt: BOOT } })).toBe(true);
			expect(isInterrupted({ ...base, owner: undefined })).toBe(true);
		}
	});

	it("blocked and ended loops are never interrupted", () => {
		for (const status of ["blocked", "converged", "exhausted", "failed"] as const) {
			for (const owner of [undefined, { pid: 100, bootAt: BOOT - 60_000 }]) {
				expect(isInterrupted({ status, owner, lockPid: undefined, bootAt: BOOT, alive: aliveOnly() })).toBe(false);
			}
		}
	});

	it("a boot time within 2 s of the current one counts as this boot", () => {
		const base = { status: "running" as const, lockPid: 200, bootAt: BOOT, alive: aliveOnly(200) };
		expect(isInterrupted({ ...base, owner: { pid: 200, bootAt: BOOT - 2000 } })).toBe(false);
		expect(isInterrupted({ ...base, owner: { pid: 200, bootAt: BOOT + 2000 } })).toBe(false);
		expect(isInterrupted({ ...base, owner: { pid: 200, bootAt: BOOT - 3000 } })).toBe(true);
	});

	it("isLoopInterrupted reads the owner row and the lock without taking it", async () => {
		const { db, path } = await database();
		await writeOwner(db, 15);
		await writeOwner(db, 11, 2 ** 22 + 1);
		expect(await isLoopInterrupted(db, path, 15, "running")).toBe(true);
		writeFileSync(`${path}.lock`, String(process.pid));
		expect(await isLoopInterrupted(db, path, 15, "running")).toBe(false);
		expect(await isLoopInterrupted(db, path, 11, "running")).toBe(true);
		expect(await isLoopInterrupted(db, path, 3, "running")).toBe(false);
		expect(await isLoopInterrupted(db, path, 11, "blocked")).toBe(false);
		expect(readLockPid(path)).toBe(process.pid);
	});
});

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

/** `count` running task loops in the database at `db`, and their ids, oldest first. */
async function runningLoops(db: string, count: number): Promise<number[]> {
	const env = setup();
	env.registry.install(defineExtension({ name: TASK_LOOP, tasks: [StandInLoopTask] }));
	const storage = await openNodeSqliteStorage(db);
	const harness = await openHarness(storage, env);
	try {
		const owner = await harness.root(context);
		const ids: number[] = [];
		for (let n = 1; n <= count; n++) {
			const input = { task: `1.${n}`, tasksPath: "/r/openspec/changes/tiny/tasks.md", earlier: [] as [] };
			ids.push(Number(await owner.commit((tx) => tx.createTask(StandInLoopTask, input, { ownership: { kind: "conversation" } }), context)));
		}
		return ids;
	} finally {
		await harness.close(context);
	}
}

async function own(db: string, owners: ReadonlyMap<number, LoopOwner>): Promise<void> {
	const sql = await openNodeSqliteDatabase(db);
	try {
		for (const [id, { pid, bootAt }] of owners) await writeOwner(sql, id, pid, bootAt);
	} finally {
		await sql.close();
	}
}

/** A pid that was alive a moment ago and is not now. */
function deadPid(): number {
	const pid = spawnSync(process.execPath, ["-e", ""]).pid;
	expect(isAlive(pid)).toBe(false);
	return pid;
}

/** `status` in process: each loop's status, by id. */
async function statuses(db: string): Promise<Map<number, string>> {
	const r = await cli(["status", "--db", db]);
	expect(r.code, r.err).toBe(0);
	return new Map(r.out.split("\n").map((line) => {
		const fields = line.split("  ");
		return [Number(/^loop (\d+)$/.exec(fields[0] ?? "")?.[1]), fields[3] ?? ""];
	}));
}

describe("task/headless: Each loop records its owner, and a dead owner makes it interrupted", () => {
	it("Scenario: run records the owner", async () => {
		const { dir, script, db } = workdir();
		const env = fauxModels();
		let during: { owners: Map<number, LoopOwner>; status: Map<number, string> } | undefined;
		// The step waits for the loop's owner row, then takes `status` while the run still holds the lock.
		env.faux.setResponses([
			async () => {
				for (let tries = 0; tries < 400 && during === undefined; tries++) {
					const sql = await openNodeSqliteDatabase(db);
					const rows = await sql.all<{ loop_id: number | bigint; pid: number | bigint; boot_at: number | bigint }>("SELECT * FROM loop_owner").catch(() => []);
					await sql.close();
					if (rows.length > 0) {
						const owners = new Map(rows.map((r) => [Number(r.loop_id), { pid: Number(r.pid), bootAt: Number(r.boot_at) }]));
						during = { owners, status: await statuses(db) };
					} else {
						await new Promise((resolve) => setTimeout(resolve, 5));
					}
				}
				return verdict(true);
			},
		]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, "--workspace", dir, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		const id = Number(/^loop (\d+) — resume with: /.exec(r.errLines[0] ?? "")?.[1]);

		expect([...(during?.owners.keys() ?? [])]).toEqual([id]);
		const owner = during?.owners.get(id);
		expect(owner?.pid).toBe(process.pid);
		expect((owner?.bootAt ?? 1) % 1000).toBe(0);
		expect(Math.abs((owner?.bootAt ?? 0) - (Date.now() - uptime() * 1000))).toBeLessThanOrEqual(1000);
		expect(readLockPid(db)).toBeUndefined();
		expect(during?.status.get(id)).toBe("running");
	});

	it("Scenario: A live lock on another loop does not hide a dead one", async () => {
		const { db } = workdir();
		const [noOwner, dead, live] = await runningLoops(db, 3);
		const boot = currentBootAt();
		await own(db, new Map([[live!, { pid: process.pid, bootAt: boot }], [dead!, { pid: deadPid(), bootAt: boot }]]));
		// This process stands in for the live holder running `live`.
		writeFileSync(`${db}.lock`, String(process.pid));

		const status = await statuses(db);
		expect(status.get(dead!)).toBe("interrupted");
		expect(status.get(live!)).toBe("running");
		expect(status.get(noOwner!)).toBe("running");
		expect(readLockPid(db)).toBe(process.pid);
	});

	it("Scenario: A reboot is caught despite a reused pid", async () => {
		const { db } = workdir();
		const [rebooted, thisBoot] = await runningLoops(db, 2);
		const boot = currentBootAt();
		// Same live pid for both; only the boot time tells them apart (the second is within the 2 s slack).
		await own(db, new Map([[rebooted!, { pid: process.pid, bootAt: boot - 60_000 }], [thisBoot!, { pid: process.pid, bootAt: boot - 1000 }]]));
		writeFileSync(`${db}.lock`, String(process.pid));

		const status = await statuses(db);
		expect(status.get(rebooted!)).toBe("interrupted");
		expect(status.get(thisBoot!)).toBe("running");
	});
});
