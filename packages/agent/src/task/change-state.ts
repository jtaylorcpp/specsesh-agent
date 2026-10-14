/**
 * Where a change's draft stands, read from the database and the files on disk:
 * the newest draft loop of the change, its last spec loop when it blocked, and
 * `approvals.json`. Nothing starts, nothing is written, the terminal is not touched.
 *
 *   newest draft loop          state
 *   blocked, reason review     review: the stage, its files, its drafts
 *   blocked, reason question   question: the stage, the question, its drafts
 *   not settled yet            running: resume it, never start a second
 *   none, or ended otherwise   ready (a stage unapproved) or drafted (every stage approved)
 *
 * A stage is approved, as the draft loop itself decides it, when it has an entry in
 * `approvals.json` and none of its recorded files changed since.
 *
 * Beside it, `build`: where the change's newest change loop stands.
 *
 *   newest change loop             build
 *   none, or ended exhausted/failed ready
 *   not settled yet                ready, `running`: resume it, never start a second
 *   blocked                        waiting: its escalation, and the group and task it blocked at
 *   converged                      built
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Cursor, Harness, JsonObject, TaskRecord } from "@earendil-works/pi-durable";
import type { Escalation, ValidationEvidence } from "../openspec/index.js";
import { readChangeResult } from "./change-api.js";
import { CHANGE_LOOP_TASK } from "./change-input.js";
import type { ChangeLoopInput, ChangeLoopResult } from "./change-loop.js";
import { DRAFT_LOOP_TASK } from "./draft-input.js";
import { lastSpecLoop, readDraftOutcome } from "./draft-api.js";
import type { DraftLoopInput, DraftLoopResult } from "./draft-loop.js";
import { readSpecOutcome } from "./spec-api.js";
import { staleApprovals, type ApprovalStage } from "./spec-approvals.js";
import type { SpecLoopInput } from "./spec-loop.js";
import { SPEC_STAGES } from "./spec-stages.js";
import { blockedBy, type GroupLoopResult } from "./group.js";
import { changeOf } from "./status.js";

type JsonValue = JsonObject[string];

/** One draft of the stage waiting: its number, and the gate's issues. */
export interface StageDraft {
	readonly n: number;
	readonly issues: readonly ValidationEvidence["report"]["issues"][number][];
}

/** Where the change's newest change loop stands. `loop` is that loop's ID. */
export type ChangeBuildState =
	/** No change loop, or the newest ended exhausted or failed; `running` when it has not settled yet. */
	| { readonly kind: "ready"; readonly loop?: number; readonly running?: true }
	/** Blocked: the escalation it ended with, and the group (and task, when one blocked it) it waits at. */
	| { readonly kind: "waiting"; readonly loop: number; readonly escalation: Escalation & { readonly group?: number; readonly task?: string } }
	| { readonly kind: "built"; readonly loop: number };

type DraftState =
	| {
			readonly kind: "review";
			readonly change: string;
			readonly loop: number;
			readonly stage: string;
			/** Relative to the change directory. */
			readonly files: readonly string[];
			readonly approved: readonly string[];
			readonly drafts: readonly StageDraft[];
	  }
	| {
			readonly kind: "question";
			readonly change: string;
			readonly loop: number;
			readonly stage: string;
			readonly question: string;
			readonly approved: readonly string[];
			readonly drafts: readonly StageDraft[];
	  }
	| { readonly kind: "running"; readonly change: string; readonly loop: number; readonly approved: readonly string[] }
	| { readonly kind: "ready"; readonly change: string; readonly loop?: number; readonly firstStage: string; readonly approved: readonly string[] }
	| { readonly kind: "drafted"; readonly change: string; readonly loop?: number; readonly approved: readonly string[] };

/** Every state but `missing` also carries `build`; `loop` is always the draft loop's. */
export type ChangeState = { readonly kind: "missing"; readonly change: string } | (DraftState & { readonly build: ChangeBuildState });

export interface ChangeStateOptions {
	readonly change: string;
	/** The directory holding the change directories, e.g. `<repo>/openspec/changes`. */
	readonly changesDir: string;
	/** The stages, in order. Defaults to `SPEC_STAGES`. */
	readonly stages?: readonly ApprovalStage[];
}

type DraftRecord = TaskRecord<JsonValue, JsonValue, DraftLoopResult>;

/**
 * The approved stages in order, up to the first without a current approval, and that stage.
 * Throws `ApprovalsFileError` when `approvals.json` is not valid.
 */
export function approvedStages(stages: readonly ApprovalStage[], changeDir: string): { approved: string[]; next?: string } {
	const approved: string[] = [];
	for (const stage of stages) {
		// A stage that follows only this one may start exactly when this one's approval is current.
		if (staleApprovals({ name: stage.name, owns: [], after: [stage.name] }, changeDir).length > 0) return { approved, next: stage.name };
		approved.push(stage.name);
	}
	return { approved };
}

/** The change's draft loop with the highest ID, if any. */
async function newestDraftLoop(harness: Pick<Harness, "commit">, change: string, context: Context): Promise<DraftRecord | undefined> {
	return harness.commit(async (tx) => {
		let newest: DraftRecord | undefined;
		let cursor: Cursor | undefined;
		do {
			const page = await tx.scanTasks({ kind: DRAFT_LOOP_TASK }, 100, cursor);
			for (const record of page.items) {
				if ((record.input as unknown as Partial<DraftLoopInput>).change !== change) continue;
				if (newest === undefined || Number(record.id) > Number(newest.id)) newest = record as unknown as DraftRecord;
			}
			cursor = page.next;
		} while (cursor !== undefined);
		return newest;
	}, context);
}

type ChangeRecord = TaskRecord<JsonValue, JsonValue, ChangeLoopResult>;

/** The change's change loop with the highest ID, if any. Its change is the directory its tasks.md was read from. */
export async function newestChangeLoop(harness: Pick<Harness, "commit">, change: string, context: Context): Promise<ChangeRecord | undefined> {
	return harness.commit(async (tx) => {
		let newest: ChangeRecord | undefined;
		let cursor: Cursor | undefined;
		do {
			const page = await tx.scanTasks({ kind: CHANGE_LOOP_TASK }, 100, cursor);
			for (const record of page.items) {
				if (changeOf(record.input as unknown as ChangeLoopInput) !== change) continue;
				if (newest === undefined || Number(record.id) > Number(newest.id)) newest = record as unknown as ChangeRecord;
			}
			cursor = page.next;
		} while (cursor !== undefined);
		return newest;
	}, context);
}

/** Where the change's newest change loop stands. A loop whose task failed or was aborted counts as failed. */
export async function changeBuildState(harness: Pick<Harness, "commit">, change: string, context: Context): Promise<ChangeBuildState> {
	const record = await newestChangeLoop(harness, change, context);
	if (record === undefined) return { kind: "ready" };
	const loop = Number(record.id);
	if (record.state.status !== "terminal") return { kind: "ready", loop, running: true };
	const ended = record.state.outcome;
	if (ended.status !== "completed") return { kind: "ready", loop };
	const result = readChangeResult(ended.result, loop);
	const { outcome } = result;
	if (outcome.status === "converged") return { kind: "built", loop };
	if (outcome.status !== "blocked") return { kind: "ready", loop };
	// The escalation is the blocked group's, raised to level "change", or the trial fold's, with no group; its `to` is who answers.
	const group = result.blocked?.group;
	const entry = outcome.result?.groups.find((g) => g.group === group);
	const task = entry === undefined ? null : blockedBy(entry.outcome as unknown as GroupLoopResult["outcome"]);
	return {
		kind: "waiting",
		loop,
		escalation: { ...outcome.escalation, ...(group !== undefined ? { group } : {}), ...(task !== null ? { task } : {}) },
	};
}

/** What the change waits for. Throws `ApprovalsFileError` when its `approvals.json` is not valid. */
export async function changeState(harness: Harness, options: ChangeStateOptions, context: Context): Promise<ChangeState> {
	const { change } = options;
	const changeDir = join(options.changesDir, change);
	if (!existsSync(changeDir)) return { kind: "missing", change };
	const draft = await draftState(harness, options, changeDir, context);
	return { ...draft, build: await changeBuildState(harness, change, context) };
}

async function draftState(harness: Harness, options: ChangeStateOptions, changeDir: string, context: Context): Promise<DraftState> {
	const { change } = options;
	const { approved, next } = approvedStages(options.stages ?? SPEC_STAGES, changeDir);
	const record = await newestDraftLoop(harness, change, context);
	if (record === undefined) return next !== undefined ? { kind: "ready", change, firstStage: next, approved } : { kind: "drafted", change, approved };

	const loop = Number(record.id);
	if (record.state.status !== "terminal") return { kind: "running", change, loop, approved };
	const ended = record.state.outcome;
	if (ended.status === "completed" && readDraftOutcome(ended.result, loop).status === "blocked") {
		const child = await lastSpecLoop(harness, record, context);
		if (child !== undefined && child.state.status === "terminal" && child.state.outcome.status === "completed") {
			const outcome = readSpecOutcome(child.state.outcome.result, child.id);
			if (outcome.status === "blocked") {
				const stage = (child.input as unknown as SpecLoopInput).stage.name;
				const drafts = outcome.iterations.map((iteration) => ({
					n: iteration.n,
					issues: iteration.evidence.flatMap((evidence) => (evidence.kind === "validation" ? evidence.report.issues : [])),
				}));
				if (outcome.escalation.reason === "review") {
					return { kind: "review", change, loop, stage, files: [...(outcome.result?.files ?? [])], approved, drafts };
				}
				return { kind: "question", change, loop, stage, question: outcome.escalation.question, approved, drafts };
			}
		}
	}
	return next !== undefined ? { kind: "ready", change, loop, firstStage: next, approved } : { kind: "drafted", change, loop, approved };
}
