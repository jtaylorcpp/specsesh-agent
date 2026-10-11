/**
 * `agentscript-task status`: one line per loop in a database, newest first —
 * its id, change, task, status, iteration count and, for a worktree loop, the
 * branch. Read straight from storage; no harness is opened, nothing runs.
 */

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Cursor, Storage } from "@earendil-works/pi-durable";
import { BUNDLED_SCRIPT_NAMES } from "./config.js";
import type { LoopCheckpoint, TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { TASK_LOOP } from "./loop.js";

export type LoopStatus = "running" | "converged" | "blocked" | "exhausted" | "failed";

export interface LoopSummary {
	readonly id: number;
	readonly change: string;
	readonly task: string;
	readonly status: LoopStatus;
	readonly iterations: number;
	readonly branch?: string;
}

/** The change a loop works: its directory's name, from where its tasks.md was read; `-` when it came as text. */
export function changeOf(input: TaskLoopInput): string {
	return input.tasksPath === undefined ? "-" : basename(dirname(input.tasksPath));
}

/** The bundled script's name when the loop runs one, else `custom`. */
export function scriptOf(input: TaskLoopInput): string {
	for (const [name, url] of Object.entries(BUNDLED_SCRIPT_NAMES)) {
		if (readFileSync(url, "utf8") === input.script) return name;
	}
	return "custom";
}

type StoredLoop = {
	readonly id: unknown;
	readonly input: unknown;
	readonly state: { readonly status: string; readonly checkpoint?: unknown; readonly outcome?: unknown };
};

export function summarize(record: StoredLoop): LoopSummary {
	const input = record.input as TaskLoopInput;
	const state = record.state;
	let status: LoopStatus = "running";
	let iterations = 0;
	if (state.status === "terminal" || state.status === "completing") {
		const outcome = state.outcome as { status: string; result?: TaskLoopResult };
		if (outcome.status === "completed" && outcome.result !== undefined) {
			status = outcome.result.outcome.status as LoopStatus;
			iterations = outcome.result.outcome.iterations.length;
		} else {
			status = "failed";
			iterations = input.earlier.length;
		}
		if (state.status === "completing") status = "running";
	} else {
		iterations = (state.checkpoint as LoopCheckpoint | undefined)?.iterations.length ?? input.earlier.length;
	}
	return {
		id: Number(record.id),
		change: changeOf(input),
		task: input.task,
		status,
		iterations,
		...(input.worktree !== undefined ? { branch: input.worktree.branch } : {}),
	};
}

/** Every loop in the storage, newest first. */
export async function listLoops(storage: Storage, context: Context): Promise<LoopSummary[]> {
	const loops: LoopSummary[] = [];
	let cursor: Cursor | undefined;
	do {
		const page = await storage.scanTasks({ kind: TASK_LOOP, order: "descending" }, 100, cursor, context);
		for (const record of page.items) loops.push(summarize(record as unknown as StoredLoop));
		cursor = page.next;
	} while (cursor !== undefined);
	return loops.sort((a, b) => b.id - a.id);
}

export function formatLoop(loop: LoopSummary): string {
	const iterations = `${loop.iterations} iteration${loop.iterations === 1 ? "" : "s"}`;
	return [`loop ${loop.id}`, loop.change, loop.task, loop.status, iterations, ...(loop.branch !== undefined ? [loop.branch] : [])].join("  ");
}
