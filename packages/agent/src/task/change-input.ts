/**
 * The change loop's shapes: its options and its checkpoint.
 *
 * Only `src/openspec` imports `typebox`, so the checkpoint is checked by hand, as
 * the group and draft loops' are.
 */

import type { JsonObject, TaskId } from "@earendil-works/pi-durable";
import type { GroupOutcome, LoopOutcome } from "../openspec/index.js";
import type { GroupLoopOptions } from "./group.js";

type JsonValue = JsonObject[string];

export const CHANGE_LOOP_TASK = "agentscript.change-loop";
export const CHANGE_LOOP_VERSION = 1;

/** The group loop's options without `group`, plus the checks run once after the last group. */
export type ChangeLoopOptions = Omit<GroupLoopOptions, "group"> & {
	/** Run in order, each without a shell, once every group has converged. Defaults to `checks`. */
	readonly changeChecks?: readonly string[];
};

/** The change check's commands: `changeChecks`, or the `checks` when it is not set. */
export function changeChecksOf(options: Pick<ChangeLoopOptions, "checks" | "changeChecks">): readonly string[] {
	return options.changeChecks ?? options.checks ?? [];
}

/** One row per group: its latest group-loop outcome and how many group loops this change ran for it. */
export type ChangeEntry = {
	group: number;
	outcome: LoopOutcome<GroupOutcome> & JsonObject;
	runs: number;
};

export type ChangePhase = "next" | "group" | "check";

const CHANGE_PHASES: readonly ChangePhase[] = ["next", "group", "check"];

/**
 * `child.group` is the group the `group` phase works; `child.id` is its group loop,
 * committed before it is awaited, so a resumed run awaits the same one.
 */
export type ChangeCheckpoint = {
	phase: ChangePhase;
	queue: number[];
	entries: ChangeEntry[];
	child?: { group: number; id?: TaskId };
};

/** The first checkpoint: every group, ticked or not, once each and ascending. */
export function initialChangeCheckpoint(groups: readonly number[]): ChangeCheckpoint {
	return { phase: "next", queue: [...new Set(groups)].sort((a, b) => a - b), entries: [] };
}

const isGroupNumber = (value: JsonValue | undefined): value is number => Number.isSafeInteger(value) && (value as number) >= 1;

/** Check a stored checkpoint; anything malformed throws `change-loop checkpoint malformed: <field>`. */
export function decodeChangeCheckpoint(raw: JsonValue): ChangeCheckpoint {
	const malformed = (field: string): never => {
		throw new Error(`change-loop checkpoint malformed: ${field}`);
	};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return malformed("checkpoint");
	const o = raw as JsonObject;
	const phase = o.phase;
	if (typeof phase !== "string" || !CHANGE_PHASES.includes(phase as ChangePhase)) return malformed("phase");
	const queue = o.queue;
	if (!Array.isArray(queue) || !queue.every(isGroupNumber)) return malformed("queue");
	const entries = o.entries;
	if (!Array.isArray(entries) || !entries.every(isEntry)) return malformed("entries");
	const child = o.child;
	if (child !== undefined) {
		if (child === null || typeof child !== "object" || Array.isArray(child) || !isGroupNumber(child.group)) {
			return malformed("child");
		}
		if (child.id !== undefined && !Number.isSafeInteger(child.id)) return malformed("child");
	}
	return {
		phase: phase as ChangePhase,
		queue: queue as number[],
		entries: entries as unknown as ChangeEntry[],
		...(child !== undefined
			? {
					child: {
						group: (child as JsonObject).group as number,
						...(typeof (child as JsonObject).id === "number" ? { id: (child as JsonObject).id as TaskId } : {}),
					},
				}
			: {}),
	};
}

function isEntry(value: JsonValue): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const outcome = value.outcome;
	return (
		isGroupNumber(value.group) &&
		outcome !== null &&
		typeof outcome === "object" &&
		!Array.isArray(outcome) &&
		typeof outcome.status === "string" &&
		isGroupNumber(value.runs)
	);
}
