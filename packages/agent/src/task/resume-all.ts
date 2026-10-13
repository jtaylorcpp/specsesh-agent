/**
 * `agentscript-task resume --all`: every interrupted loop in one database,
 * resumed once through its root — the outermost loop up its parent links that
 * is still running — one root after another in start order, one outcome line
 * per root. The caller holds `<db>.lock` and says how one root resumes.
 */

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Cursor, Storage } from "@earendil-works/pi-durable";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { CHANGE_LOOP_TASK } from "./change-input.js";
import type { DbPath } from "./config.js";
import { DRAFT_LOOP_TASK } from "./draft-input.js";
import { GROUP_LOOP_NAME } from "./group.js";
import { TASK_LOOP } from "./loop.js";
import { currentBootAt, isInterrupted, readOwners, type LoopOwner } from "./owner.js";
import { specExitCode } from "./spec-cli.js";
import { SPEC_LOOP } from "./spec-loop.js";
import { changeOf, summarize } from "./status.js";

/** The loops `status` lists; only these are ever `interrupted` themselves. */
const LISTED = new Set([TASK_LOOP, GROUP_LOOP_NAME, SPEC_LOOP]);
/** Loops that own other loops but are not listed: reached only as a running parent. */
const OUTER = new Set([CHANGE_LOOP_TASK, DRAFT_LOOP_TASK]);

export interface LoopRow {
	readonly id: number;
	readonly kind: string;
	readonly change: string;
	/** As `status` shows it: the task id, `group <n>` or `spec <stage>`; `change` or `draft` for those loops. */
	readonly task: string;
	/** The loop that owns this one: a task loop's group loop, a group loop's change loop. */
	readonly owner?: number;
	readonly startedAt?: number;
	/** No outcome and not blocked. */
	readonly running: boolean;
}

type StoredRecord = Awaited<ReturnType<Storage["scanTasks"]>>["items"][number];

function rowOf(record: StoredRecord): LoopRow {
	const base = {
		id: Number(record.id),
		kind: record.kind,
		...(record.owner !== undefined ? { owner: Number(record.owner) } : {}),
		...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
	};
	if (LISTED.has(record.kind)) {
		const summary = summarize(record as Parameters<typeof summarize>[0]);
		return { ...base, change: summary.change, task: summary.task, running: summary.status === "running" };
	}
	const input = (record.input ?? {}) as { change?: unknown; tasksPath?: string };
	const change = typeof input.change === "string" ? input.change : changeOf(input);
	return { ...base, change, task: record.kind === CHANGE_LOOP_TASK ? "change" : "draft", running: record.state.status !== "terminal" };
}

/** Every loop in the storage, of every kind, ascending by id. */
export async function readLoops(storage: Pick<Storage, "scanTasks">, context: Context = BACKGROUND_CONTEXT): Promise<LoopRow[]> {
	const loops: LoopRow[] = [];
	for (const kind of [...LISTED, ...OUTER]) {
		let cursor: Cursor | undefined;
		do {
			const page = await storage.scanTasks({ kind }, 100, cursor, context);
			for (const record of page.items) loops.push(rowOf(record));
			cursor = page.next;
		} while (cursor !== undefined);
	}
	return loops.sort((a, b) => a.id - b.id);
}

/**
 * The listed loops `isInterrupted` holds for, given the pid `<db>.lock` named.
 * Blocked and ended loops never are.
 */
export function findInterruptedLoops(
	loops: readonly LoopRow[],
	owners: ReadonlyMap<number, LoopOwner>,
	lockPid: number | undefined,
	bootAt: number = currentBootAt(),
	alive?: (pid: number) => boolean,
): LoopRow[] {
	return loops.filter(
		(loop) =>
			LISTED.has(loop.kind) &&
			loop.running &&
			isInterrupted({ status: "running", owner: owners.get(loop.id), lockPid, bootAt, ...(alive !== undefined ? { alive } : {}) }),
	);
}

export interface Root {
	readonly loop: LoopRow;
	/** The interrupted loops under the root that it carries on, ascending; never the root itself. */
	readonly via: readonly number[];
}

const startOrder = (root: Root) => root.loop.startedAt ?? Number.POSITIVE_INFINITY;

/**
 * Each interrupted loop's root: up its parent links while the parent is still
 * running, else the loop itself. One `Root` per root, by start time, then id.
 */
export function groupByRoot(loops: readonly LoopRow[], interrupted: readonly LoopRow[]): Root[] {
	const byId = new Map(loops.map((loop) => [loop.id, loop]));
	const roots = new Map<number, { loop: LoopRow; via: number[] }>();
	for (const loop of interrupted) {
		let root = loop;
		const seen = new Set([root.id]);
		for (let parent = byId.get(root.owner ?? -1); parent?.running === true && !seen.has(parent.id); parent = byId.get(root.owner ?? -1)) {
			root = parent;
			seen.add(root.id);
		}
		const entry = roots.get(root.id) ?? { loop: root, via: [] };
		if (loop.id !== root.id) entry.via.push(loop.id);
		roots.set(root.id, entry);
	}
	return [...roots.values()]
		.map(({ loop, via }) => ({ loop, via: via.sort((a, b) => a - b) }))
		.sort((a, b) => (startOrder(a) !== startOrder(b) ? (startOrder(a) < startOrder(b) ? -1 : 1) : a.loop.id - b.loop.id));
}

/** How one root ended. A refusal is thrown, not returned. */
export type RootResult =
	| { readonly status: "converged" | "exhausted" | "failed" }
	| { readonly status: "blocked"; readonly to: string; readonly reason?: string };

/** Resume one root as `resume <loop-id>` would, worktree, owner and stderr events included. */
export type ResumeOne = (root: Root) => Promise<RootResult>;

/** The command that answers a blocked loop. */
export function answerCommand(id: number, dbLabel: string, to: string): string {
	return `agentscript-task answer ${id} --db ${dbLabel} --by ${to} --decision "…"`;
}

/** `loop <id> <change> <task>[ (via <ids>)] — <status>`. */
export function formatRootLine(root: Root, result: RootResult | { readonly status: "refused"; readonly reason: string }, dbLabel: string): string {
	const via = root.via.length > 0 ? ` (via ${root.via.join(", ")})` : "";
	const status =
		result.status === "blocked"
			? `blocked: ${answerCommand(root.loop.id, dbLabel, result.to)}`
			: result.status === "refused"
				? `refused: ${result.reason}`
				: result.status;
	return `loop ${root.loop.id} ${root.loop.change} ${root.loop.task}${via} — ${status}`;
}

/** Converged, or a spec loop blocked for review: the rules `resume <loop-id>` exits 0 by. */
function settledWell(root: Root, result: RootResult): boolean {
	if (root.loop.kind !== SPEC_LOOP) return result.status === "converged";
	const escalation = result.status === "blocked" && result.reason !== undefined ? { escalation: { reason: result.reason } } : {};
	return specExitCode({ status: result.status, ...escalation }) === 0;
}

export interface ResumeAllOptions {
	readonly storage: Pick<Storage, "scanTasks">;
	/** The `loop_owner` table's connection, on the same file. */
	readonly sql: SqliteExecutor;
	readonly db: DbPath;
	/**
	 * The pid `<db>.lock` named before the caller took it (`DbLock.staleFrom`):
	 * read afterwards, the lock names this live process and hides loops with no owner.
	 */
	readonly lockPid: number | undefined;
	readonly resumeOne: ResumeOne;
	readonly context?: Context;
}

/** Resume every root once, in order; a refused root is a line, and the batch goes on. */
export async function resumeAll({ storage, sql, db, lockPid, resumeOne, context }: ResumeAllOptions): Promise<{ lines: string[]; exitCode: 0 | 1 }> {
	const loops = await readLoops(storage, context);
	// `staleFrom` is 0 for an unreadable lock, which names no process.
	const holder = lockPid !== undefined && lockPid > 0 ? lockPid : undefined;
	const roots = groupByRoot(loops, findInterruptedLoops(loops, await readOwners(sql), holder));
	if (roots.length === 0) return { lines: [`no interrupted loops in ${db.label}`], exitCode: 0 };
	const lines: string[] = [];
	let exitCode: 0 | 1 = 0;
	for (const root of roots) {
		try {
			const result = await resumeOne(root);
			lines.push(formatRootLine(root, result, db.label));
			if (!settledWell(root, result)) exitCode = 1;
		} catch (error) {
			lines.push(formatRootLine(root, { status: "refused", reason: error instanceof Error ? error.message : String(error) }, db.label));
			exitCode = 1;
		}
	}
	return { lines, exitCode };
}
