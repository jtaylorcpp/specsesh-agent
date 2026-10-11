/**
 * One live process per database: `<db>.lock` holds the holder's pid. A lock
 * whose process is gone is taken over; a live holder (this process included)
 * refuses the newcomer. The lock is released on every exit path, including
 * `process.exit`.
 */

import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";

/** Another live process holds the database. Exit 2. */
export class DatabaseLockedError extends Error {
	override readonly name = "DatabaseLockedError";
	readonly lockPath: string;
	readonly pid: number;
	constructor(lockPath: string, pid: number) {
		super(`the database is in use by process ${pid} (${lockPath}); wait for it to finish, or use another --db`);
		this.lockPath = lockPath;
		this.pid = pid;
	}
}

export interface DbLock {
	readonly path: string;
	/** Set when a dead process's lock was taken over: that process's pid. */
	readonly staleFrom?: number;
	release(): void;
}

/** Whether a process with this pid is alive. EPERM means it is, under another user. */
export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function create(path: string): boolean {
	try {
		const fd = openSync(path, "wx");
		writeSync(fd, String(process.pid));
		closeSync(fd);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

const holderOf = (path: string): number | undefined => {
	try {
		const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
};

/** Take `<db>.lock`, or throw `DatabaseLockedError` naming the live holder. */
export function lockDatabase(db: string): DbLock {
	const path = `${db}.lock`;
	let staleFrom: number | undefined;
	if (!create(path)) {
		const holder = holderOf(path);
		if (holder !== undefined && isAlive(holder)) throw new DatabaseLockedError(path, holder);
		// Dead (or unreadable) holder: take it over. Another process racing for the same stale lock loses at `wx`.
		rmSync(path, { force: true });
		if (!create(path)) {
			const winner = holderOf(path) ?? 0;
			throw new DatabaseLockedError(path, winner);
		}
		staleFrom = holder ?? 0;
	}
	let held = true;
	const release = () => {
		if (!held) return;
		held = false;
		process.removeListener("exit", release);
		if (holderOf(path) === process.pid) rmSync(path, { force: true });
	};
	process.on("exit", release);
	return { path, ...(staleFrom !== undefined ? { staleFrom } : {}), release };
}
