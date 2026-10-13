/**
 * Which process owns each loop: a `loop_owner` row of pid and boot time,
 * written whenever a process starts or resumes a loop. A running loop whose
 * owner is not the live holder of `<db>.lock` is `interrupted`; the check
 * reads the lock but never takes it.
 */

import { uptime } from "node:os";
import type { Context } from "@earendil-works/chord";
import type { Cursor, Storage } from "@earendil-works/pi-durable";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { CHANGE_LOOP_TASK } from "./change-input.js";
import { DRAFT_LOOP_TASK } from "./draft-input.js";
import { GROUP_LOOP_NAME } from "./group.js";
import { isAlive, readLockPid } from "./lock.js";
import { TASK_LOOP } from "./loop.js";
import { SPEC_LOOP } from "./spec-loop.js";
import type { LoopStatus } from "./status.js";

export interface LoopOwner {
	readonly pid: number;
	/** The machine's boot time, ms since the epoch, rounded to the second. */
	readonly bootAt: number;
}

/** Owners recorded within this much of the current boot time are on this boot. */
const BOOT_SLACK_MS = 2000;

/** Created on first use, so a database from before `loop_owner` needs no migration. */
export async function ensureOwnerTable(db: SqliteExecutor): Promise<void> {
	await db.exec(
		"CREATE TABLE IF NOT EXISTS loop_owner (loop_id INTEGER PRIMARY KEY, pid INTEGER NOT NULL, boot_at INTEGER NOT NULL)",
	);
}

/** The machine's boot time in ms, rounded to the second. */
export function currentBootAt(now: number = Date.now(), uptimeSec: number = uptime()): number {
	return Math.round((now - uptimeSec * 1000) / 1000) * 1000;
}

/** Record this process (or `pid`) as the loop's owner, replacing any earlier owner. */
export async function writeOwner(
	db: SqliteExecutor,
	loopId: number,
	pid: number = process.pid,
	bootAt: number = currentBootAt(),
): Promise<void> {
	await ensureOwnerTable(db);
	await db.run(
		"INSERT INTO loop_owner (loop_id, pid, boot_at) VALUES (?, ?, ?) ON CONFLICT(loop_id) DO UPDATE SET pid = excluded.pid, boot_at = excluded.boot_at",
		loopId,
		pid,
		bootAt,
	);
}

const LOOP_KINDS = new Set([TASK_LOOP, GROUP_LOOP_NAME, SPEC_LOOP, CHANGE_LOOP_TASK, DRAFT_LOOP_TASK]);
/** Every status but `terminal`: a loop with no outcome and not blocked. A live loop's parents are live too. */
const LIVE = ["pending", "running", "waiting", "completing"] as const;

/** Each live loop's owning task, by loop ID. */
async function liveLoops(storage: Pick<Storage, "scanTasks">, context: Context): Promise<Map<number, number | undefined>> {
	const loops = new Map<number, number | undefined>();
	for (const status of LIVE) {
		let cursor: Cursor | undefined;
		do {
			const page = await storage.scanTasks({ status }, 100, cursor, context);
			for (const record of page.items) {
				if (LOOP_KINDS.has(record.kind)) loops.set(Number(record.id), record.owner === undefined ? undefined : Number(record.owner));
			}
			cursor = page.next;
		} while (cursor !== undefined);
	}
	return loops;
}

/**
 * The loops one process owns. `claim` writes the root and every live loop nested
 * under it, each once per process, so a resumed tree takes on this owner and a
 * nested loop gets exactly the root's `{ pid, bootAt }`.
 */
export class LoopOwnership {
	readonly owner: LoopOwner;
	readonly #db: SqliteExecutor;
	readonly #storage: Pick<Storage, "scanTasks">;
	readonly #written = new Set<number>();

	constructor(db: SqliteExecutor, storage: Pick<Storage, "scanTasks">, owner: LoopOwner = { pid: process.pid, bootAt: currentBootAt() }) {
		this.#db = db;
		this.#storage = storage;
		this.owner = owner;
	}

	async claim(root: number, context: Context): Promise<void> {
		const loops = await liveLoops(this.#storage, context);
		const under = (id: number): boolean => {
			for (let at = loops.get(id); at !== undefined; at = loops.get(at)) if (at === root) return true;
			return false;
		};
		for (const id of [root, ...[...loops.keys()].filter(under)]) {
			if (this.#written.has(id)) continue;
			await writeOwner(this.#db, id, this.owner.pid, this.owner.bootAt);
			this.#written.add(id);
		}
	}

	/** Claim `root` now, then every `pollMs` until stopped, so nested loops are owned as they are created. */
	async follow(root: number, context: Context, pollMs: number): Promise<() => Promise<void>> {
		await this.claim(root, context);
		let pending = Promise.resolve();
		const timer = setInterval(() => {
			pending = pending.then(() => this.claim(root, context)).catch(() => undefined);
		}, pollMs);
		return async () => {
			clearInterval(timer);
			await pending;
		};
	}
}

export async function readOwner(db: SqliteExecutor, loopId: number): Promise<LoopOwner | undefined> {
	await ensureOwnerTable(db);
	const row = await db.get<{ pid: number | bigint; boot_at: number | bigint }>(
		"SELECT pid, boot_at FROM loop_owner WHERE loop_id = ?",
		loopId,
	);
	return row === undefined ? undefined : { pid: Number(row.pid), bootAt: Number(row.boot_at) };
}

/** Every owner row, by loop ID; empty for a database from before `loop_owner`, which is left as it is. */
export async function readOwners(db: SqliteExecutor): Promise<Map<number, LoopOwner>> {
	const table = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'loop_owner'");
	if (table === undefined) return new Map();
	const rows = await db.all<{ loop_id: number | bigint; pid: number | bigint; boot_at: number | bigint }>("SELECT loop_id, pid, boot_at FROM loop_owner");
	return new Map(rows.map((row) => [Number(row.loop_id), { pid: Number(row.pid), bootAt: Number(row.boot_at) }]));
}

export interface InterruptedInput {
	readonly status: LoopStatus;
	readonly owner: LoopOwner | undefined;
	/** The pid `<db>.lock` names, if any. */
	readonly lockPid: number | undefined;
	/** The current boot time; defaults to `currentBootAt()`. */
	readonly bootAt?: number;
	readonly alive?: (pid: number) => boolean;
}

/**
 * A running loop is interrupted when its owner is not the live lock holder:
 * no live holder, another pid, or an owner from an earlier boot. A loop with
 * no owner row is interrupted only when nothing live holds the lock. Ended and
 * blocked loops never are.
 */
export function isInterrupted({ status, owner, lockPid, bootAt = currentBootAt(), alive = isAlive }: InterruptedInput): boolean {
	if (status !== "running") return false;
	if (lockPid === undefined || !alive(lockPid)) return true;
	if (owner === undefined) return false;
	return owner.pid !== lockPid || Math.abs(owner.bootAt - bootAt) > BOOT_SLACK_MS;
}

/** `isInterrupted` for one stored loop of the database at `dbPath`. */
export async function isLoopInterrupted(db: SqliteExecutor, dbPath: string, loopId: number, status: LoopStatus): Promise<boolean> {
	if (status !== "running") return false;
	return isInterrupted({ status, owner: await readOwner(db, loopId), lockPid: readLockPid(dbPath) });
}
