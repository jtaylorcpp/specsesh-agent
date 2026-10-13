/**
 * The draft loop's entry points for a host: start, wait, answer, and the extensions to
 * install. Thin: the loop itself is `DraftLoopTask` in `draft-loop.ts`.
 *
 * An answer is checked here, against the blocked spec loop, before any run starts; the new
 * draft run's `answer` phase then creates the spec loop that carries it, so a crash between
 * the two leaves either nothing or a draft run that will create it.
 */

import { resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Cursor, Extension, Harness, JsonObject, TaskId, TaskRecord } from "@earendil-works/pi-durable";
import { LoopOutcome, check, explain } from "../openspec/index.js";
import { closed } from "../openspec/schema.js";
import { DRAFT_LOOP_TASK, type DraftLoopOptions, type DraftOutcome } from "./draft-input.js";
import { DraftLoop, DraftLoopTask, type DraftLoopInput, type DraftLoopResult } from "./draft-loop.js";
import { EscalationAnswerError, TaskLoopStartError } from "./errors.js";
import { prepareSpecLoop, specLoopExtensions, type SpecLoopExtensionOptions } from "./spec-api.js";
import { specAnswerInput, type SpecLoopAnswer } from "./spec-answer.js";
import { SPEC_LOOP, registerSpecStage, type SpecLoopInput, type SpecLoopResult } from "./spec-loop.js";
import { SPEC_STAGES } from "./spec-stages.js";

/** Any JSON value; pi-durable exports `JsonObject` but not its value type. */
type JsonValue = JsonObject[string];

/** `DraftLoop` plus the three extensions `specLoopExtensions` returns, over `stages` (default `SPEC_STAGES`). */
export function draftLoopExtensions(options: SpecLoopExtensionOptions): readonly [Extension, Extension, Extension, Extension] {
	return [DraftLoop, ...specLoopExtensions({ ...options, stages: options.stages ?? SPEC_STAGES })];
}

/** The draft's durable input, or the refusal. Reads every stage's script once. */
export function prepareDraftLoop(options: DraftLoopOptions): DraftLoopInput {
	const stages = options.stages ?? SPEC_STAGES;
	if (stages.length === 0) throw new TaskLoopStartError("a draft loop needs at least one stage");
	// Each stage as the spec loop would start it, less its `after`: the draft starts a stage only once those are approved.
	const prepared = stages.map((stage) => ({ stage, input: prepareSpecLoop({ ...options, stage: { ...stage, after: [] } }) }));
	const first = prepared[0]!.input;
	return {
		change: options.change,
		stages: prepared.map(({ stage, input }) => ({
			name: stage.name,
			owns: [...stage.owns],
			...(stage.after !== undefined ? { after: [...stage.after] } : {}),
			script: input.script,
		})),
		intent: options.intent,
		workspace: resolve(options.workspace),
		changesDir: resolve(options.changesDir),
		budget: first.budget,
		escalateTo: first.escalateTo,
		...(options.model !== undefined ? { model: options.model } : {}),
	};
}

/**
 * Durably create the draft loop and return its ID. Every refusal (budget, any stage's script
 * source, stage contract or script) comes first and creates nothing.
 */
export async function startDraftLoop(
	harness: Harness,
	options: DraftLoopOptions,
	context: Context,
): Promise<TaskId<LoopOutcome<DraftOutcome>>> {
	const input = prepareDraftLoop(options);
	for (const stage of options.stages ?? SPEC_STAGES) registerSpecStage(stage);
	const owner = await harness.root(context);
	const id = await owner.commit((tx) => tx.createTask(DraftLoopTask, input, { ownership: { kind: "conversation" } }), context);
	return id as unknown as TaskId<LoopOutcome<DraftOutcome>>;
}

/** The ontology has no `DraftOutcome` schema: the outcome is checked with its result left out, as the loop does, and the result by hand. */
const DraftLoopShape = LoopOutcome(closed({}));

function draftOutcomeProblems(result: unknown): string[] {
	if (result === undefined) return [];
	const r = result as Partial<Record<keyof DraftOutcome, unknown>>;
	const problems: string[] = [];
	if (typeof r.change !== "string" || r.change === "") problems.push("result.change is not a non-empty string");
	const entry = (e: unknown) => {
		const o = e as Record<string, unknown> | null;
		return o !== null && typeof o === "object" && typeof o.stage === "string" && typeof o.approved === "boolean" && Number.isSafeInteger(o.runs);
	};
	if (!Array.isArray(r.stages) || !r.stages.every(entry)) problems.push("result.stages is not a list of stage entries");
	return problems;
}

/** A completed draft loop's durable result as its `LoopOutcome<DraftOutcome>`, checked against the ontology. */
export function readDraftOutcome(durable: unknown, id: unknown): LoopOutcome<DraftOutcome> {
	const value = (durable as Partial<DraftLoopResult> | undefined)?.outcome;
	const { result, ...rest } = (value ?? {}) as Partial<DraftLoopResult["outcome"]>;
	const shape = rest.status === "converged" && result !== undefined ? { ...rest, result: {} } : rest;
	const problems = check(DraftLoopShape, shape) ? draftOutcomeProblems(result) : explain(DraftLoopShape, shape);
	if (problems.length > 0) {
		throw new Error(`draft loop ${String(id)} holds an outcome the ontology refuses: ${problems.join("; ")}`);
	}
	return value as LoopOutcome<DraftOutcome>;
}

/** The settled draft loop's `LoopOutcome<DraftOutcome>`, checked against the ontology. */
export async function waitForDraftLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<DraftOutcome>>,
	context: Context,
): Promise<LoopOutcome<DraftOutcome>> {
	const settled = await harness.waitForTask(id as unknown as TaskId<DraftLoopResult>, context);
	if (settled.state.status !== "terminal") {
		throw new Error(`draft loop ${String(id)} is ${settled.state.status}, not finished. Loop IDs are numbers; check the ID passed in.`);
	}
	const outcome = settled.state.outcome;
	if (outcome.status !== "completed") {
		const why = outcome.status === "failed" ? outcome.error.message : (outcome.reason ?? "");
		throw new Error(`draft loop ${String(id)} ended ${outcome.status}: ${why}`);
	}
	return readDraftOutcome(outcome.result, id);
}

/** The draft's last spec loop: the one it was waiting on when it ended. A terminal task keeps no checkpoint, so it is found by owner. */
export async function lastSpecLoop(
	harness: Harness,
	draft: TaskRecord<JsonValue, JsonValue, DraftLoopResult>,
	context: Context,
): Promise<TaskRecord<JsonValue, JsonValue, SpecLoopResult> | undefined> {
	return harness.commit(async (tx) => {
		let cursor: Cursor | undefined;
		do {
			const page = await tx.scanTasks({ kind: SPEC_LOOP, conversationId: draft.conversationId, order: "descending" }, 100, cursor);
			const found = page.items.find((record) => record.owner !== undefined && Number(record.owner) === Number(draft.id));
			if (found !== undefined) return found as unknown as TaskRecord<JsonValue, JsonValue, SpecLoopResult>;
			cursor = page.next;
		} while (cursor !== undefined);
		return undefined;
	}, context);
}

/**
 * Answer a blocked draft loop: the answer goes to the spec loop it blocked on, as
 * `answerSpecLoop` would take it. Rejects with `EscalationAnswerError`, starting nothing,
 * for a loop that is not a blocked draft loop or an answer that spec loop refuses (a review
 * answered by anyone but a named principal, a malformed `approvals.json`). Returns the new
 * draft run's ID, for `waitForDraftLoop`.
 */
export async function answerDraftLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<DraftOutcome>>,
	answer: SpecLoopAnswer,
	context: Context,
): Promise<TaskId<LoopOutcome<DraftOutcome>>> {
	const record = await harness.getTask(id as unknown as TaskId<DraftLoopResult>, context);
	if (record === undefined || record.kind !== DRAFT_LOOP_TASK) throw new EscalationAnswerError(`there is no draft loop ${String(id)}`);
	if (record.state.status !== "terminal" || record.state.outcome.status !== "completed") {
		throw new EscalationAnswerError(`draft loop ${id} has not ended blocked, so it has no escalation to answer`);
	}
	const outcome = readDraftOutcome(record.state.outcome.result, id);
	if (outcome.status !== "blocked") {
		throw new EscalationAnswerError(`draft loop ${id} ended ${outcome.status}, not blocked, so it has no escalation to answer`);
	}
	const child = await lastSpecLoop(harness, record, context);
	if (child === undefined) throw new EscalationAnswerError(`draft loop ${id} ended blocked but has no spec loop to answer`);
	// The refusal, if any, before anything starts; the new run's `answer` phase builds the same input again.
	specAnswerInput(child, child.id, answer);

	const { resume: _resume, ...input } = record.input as unknown as DraftLoopInput;
	const resumed: DraftLoopInput = {
		...input,
		resume: {
			stage: (child.input as unknown as SpecLoopInput).stage.name,
			child: child.id as unknown as number,
			entries: outcome.result?.stages ?? [],
			answer: { by: answer.by, decision: answer.decision, ...(answer.principal !== undefined ? { principal: answer.principal } : {}) },
			answers: id as unknown as number,
		},
	};
	const owner = await harness.root(context);
	const created = await owner.commit((tx) => tx.createTask(DraftLoopTask, resumed, { ownership: { kind: "conversation" } }), context);
	return created as unknown as TaskId<LoopOutcome<DraftOutcome>>;
}
