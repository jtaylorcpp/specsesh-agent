/**
 * The draft loop's shapes: its options, its outcome and its checkpoint.
 *
 * A stage's `seed` and `gate` are functions, so the options are a plain type, as
 * the spec loop's are; `stages` defaults to `SPEC_STAGES` when the loop starts.
 * Only `src/openspec` imports `typebox`, so the checkpoint is checked by hand, as
 * the group loop's is.
 */

import type { JsonObject, TaskId } from "@earendil-works/pi-durable";
import type { SpecLoopOptions } from "./spec-api.js";
import type { SpecStage } from "./spec-stage.js";

type JsonValue = JsonObject[string];

export const DRAFT_LOOP_TASK = "agentscript.draft-loop";
export const DRAFT_LOOP_VERSION = 1;

export type DraftLoopOptions = Omit<SpecLoopOptions, "stage"> & {
	/** The stages to draft, in order. Defaults to `SPEC_STAGES`. */
	readonly stages?: readonly SpecStage[];
};

/** One row per stage: whether it is approved, and how many spec loops this draft ran for it (`0` if approved before). */
export type DraftStageEntry = {
	stage: string;
	approved: boolean;
	runs: number;
};

/** The result of `LoopOutcome<DraftOutcome>`: every stage entered so far, in order. */
export type DraftOutcome = {
	change: string;
	stages: DraftStageEntry[];
};

export type DraftPhase = "next" | "stage" | "answer";

const DRAFT_PHASES: readonly DraftPhase[] = ["next", "stage", "answer"];

/**
 * `stage` is the stage the `stage` or `answer` phase works; `child` is its spec loop,
 * committed before it is awaited, so a resumed run awaits the same one.
 */
export type DraftCheckpoint = {
	phase: DraftPhase;
	stage?: string;
	child?: TaskId;
	entries: DraftStageEntry[];
};

/** Check a stored checkpoint; anything malformed throws `draft-loop checkpoint malformed: <field>`. */
export function decodeDraftCheckpoint(raw: JsonValue): DraftCheckpoint {
	const malformed = (field: string): never => {
		throw new Error(`draft-loop checkpoint malformed: ${field}`);
	};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return malformed("checkpoint");
	const o = raw as JsonObject;
	const phase = o.phase;
	if (typeof phase !== "string" || !DRAFT_PHASES.includes(phase as DraftPhase)) return malformed("phase");
	if (o.stage !== undefined && typeof o.stage !== "string") return malformed("stage");
	if (o.child !== undefined && !Number.isSafeInteger(o.child)) return malformed("child");
	const entries = o.entries;
	if (!Array.isArray(entries) || !entries.every(isEntry)) return malformed("entries");
	return {
		phase: phase as DraftPhase,
		...(typeof o.stage === "string" ? { stage: o.stage } : {}),
		...(typeof o.child === "number" ? { child: o.child as TaskId } : {}),
		entries: entries as unknown as DraftStageEntry[],
	};
}

function isEntry(value: JsonValue): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	return (
		typeof value.stage === "string" &&
		typeof value.approved === "boolean" &&
		Number.isSafeInteger(value.runs) &&
		(value.runs as number) >= 0
	);
}
