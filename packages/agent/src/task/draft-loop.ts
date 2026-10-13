/**
 * The draft loop as one pi-durable task, `agentscript.draft-loop`: every stage of a
 * change without a current approval, in order, as a child `agentscript.spec-loop`,
 * until every stage is approved. It decides nothing itself: each stage's gate and
 * the principal's review do that, and every block is the stage's own.
 *
 *   next     the first stage whose approval is missing or stale → stage; none → converged.
 *            No model request, no child
 *   stage    create the stage's spec loop and store its ID in one commit; a later entry
 *            (a resume included) awaits that ID. Converged → next; blocked → blocked with
 *            the child's escalation unchanged; exhausted or failed → failed
 *   answer   the first phase of a run answering a blocked draft: create the run that
 *            answers the blocked spec loop (`specAnswerInput`) and store its ID in one
 *            commit, then go on as `stage`
 *
 * A stage's `seed` and `gate` are functions, so the input keeps each stage's name,
 * owned paths, `after` and script text, and the spec loop resolves the rest by name.
 */

import { join } from "node:path";
import {
	defineExtension,
	defineTask,
	type Extension,
	type JsonObject,
	type ModelRef,
	type Task,
	type TaskDefinition,
	type TaskId,
} from "@earendil-works/pi-durable";
import { LoopOutcome, check, explain, type Escalation, type Recipient } from "../openspec/index.js";
import { closed } from "../openspec/schema.js";
import {
	DRAFT_LOOP_TASK,
	DRAFT_LOOP_VERSION,
	decodeDraftCheckpoint,
	type DraftCheckpoint,
	type DraftOutcome,
	type DraftPhase,
	type DraftStageEntry,
} from "./draft-input.js";
import { ApprovalsFileError } from "./errors.js";
import { readSpecOutcome } from "./spec-api.js";
import { specAnswerInput, type SpecLoopAnswer } from "./spec-answer.js";
import { staleApprovals } from "./spec-approvals.js";
import { SPEC_LOOP, type SpecLoopInput, type SpecLoopResult, type SpecLoopTask } from "./spec-loop.js";

/** A stage as the input holds it: what a checkpoint can, its script already read into text. */
export interface DraftStageInput {
	readonly name: string;
	readonly owns: readonly string[];
	readonly after?: readonly string[];
	readonly script: string;
}

/** The durable input of `agentscript.draft-loop`: the spec loop's input less its stage, and every stage in order. */
export interface DraftLoopInput {
	readonly change: string;
	readonly stages: readonly DraftStageInput[];
	readonly intent: string;
	/** Absolute: the repo root, where `openspec/` lives. */
	readonly workspace: string;
	readonly budget: { readonly maxIterations: number };
	readonly escalateTo: Recipient;
	readonly model?: ModelRef;
	/**
	 * Set only on a run that answers a blocked draft: the blocked spec loop's stage and ID,
	 * the entries so far, the answer handed to it, and the draft run this one answers.
	 */
	readonly resume?: {
		readonly stage: string;
		readonly child: number;
		readonly entries: readonly DraftStageEntry[];
		readonly answer: SpecLoopAnswer;
		readonly answers: number;
	};
}

/** The draft loop's durable result: the ontology's outcome, and notes it has no field for. */
export interface DraftLoopResult extends JsonObject {
	outcome: LoopOutcome<DraftOutcome> & JsonObject;
	notes: string[];
}

/** The checkpoint as pi-durable stores it, narrowed per phase so each handler's task type is not `never`. */
export type StoredDraftCheckpoint = { [P in DraftPhase]: JsonObject & { phase: P } }[DraftPhase];

/** Copy only the fields that are present; `undefined` is never written. */
export function encodeDraftCheckpoint(cp: DraftCheckpoint): StoredDraftCheckpoint {
	return {
		phase: cp.phase,
		...(cp.stage !== undefined ? { stage: cp.stage } : {}),
		...(cp.child !== undefined ? { child: cp.child as unknown as number } : {}),
		entries: cp.entries.map((e) => ({ stage: e.stage, approved: e.approved, runs: e.runs })),
	} as StoredDraftCheckpoint;
}

/** The first checkpoint: `answer` on a run answering a blocked draft, else `next` with no entries. */
export function initialDraftCheckpoint(input: Pick<DraftLoopInput, "resume">): DraftCheckpoint {
	const resume = input.resume;
	if (resume === undefined) return { phase: "next", entries: [] };
	return { phase: "answer", stage: resume.stage, child: resume.child as unknown as TaskId, entries: [...resume.entries] };
}

/**
 * The stages from the first, entered while they hold a current approval (`runs` 0 for a stage
 * this draft has no entry for), up to the first that does not. Throws `ApprovalsFileError`
 * when `approvals.json` is not valid.
 */
export function nextStage(
	input: Pick<DraftLoopInput, "workspace" | "change" | "stages">,
	entries: readonly DraftStageEntry[],
): { readonly stage?: string; readonly entries: DraftStageEntry[] } {
	const changeDir = join(input.workspace, "openspec", "changes", input.change);
	let kept = [...entries];
	for (const stage of input.stages) {
		// A stage that follows only this one may start exactly when this one's approval is current.
		if (staleApprovals({ name: stage.name, owns: [], after: [stage.name] }, changeDir).length > 0) {
			return { stage: stage.name, entries: kept };
		}
		kept = kept.some((e) => e.stage === stage.name)
			? kept.map((e) => (e.stage === stage.name ? { ...e, approved: true } : e))
			: [...kept, { stage: stage.name, approved: true, runs: 0 }];
	}
	return { entries: kept };
}

/** The stage's entry with one more run, not approved: replaced in place, or appended. */
export function startedRun(entries: readonly DraftStageEntry[], stage: string): DraftStageEntry[] {
	const runs = (entries.find((e) => e.stage === stage)?.runs ?? 0) + 1;
	const entry: DraftStageEntry = { stage, approved: false, runs };
	return entries.some((e) => e.stage === stage) ? entries.map((e) => (e.stage === stage ? entry : e)) : [...entries, entry];
}

/** The spec loop's input for `stage`: the draft's options, and the owned paths of the stages approved so far. */
export function stageLoopInput(input: DraftLoopInput, stage: string, entries: readonly DraftStageEntry[]): SpecLoopInput {
	const found = input.stages.find((s) => s.name === stage);
	if (found === undefined) throw new Error(`${DRAFT_LOOP_TASK} has no stage named "${stage}"`);
	const approved = entries.filter((e) => e.approved).flatMap((e) => input.stages.find((s) => s.name === e.stage)?.owns ?? []);
	return {
		change: input.change,
		stage: { name: found.name, owns: [...found.owns] },
		script: found.script,
		intent: input.intent,
		workspace: input.workspace,
		approved,
		budget: { maxIterations: input.budget.maxIterations },
		escalateTo: input.escalateTo,
		...(input.model !== undefined ? { model: input.model } : {}),
		stages: input.stages.map((s) => ({ name: s.name, owns: [...s.owns], ...(s.after !== undefined ? { after: [...s.after] } : {}) })),
	};
}

/** The ontology has no `DraftOutcome` schema: the outcome is checked with its result left out, as the spec loop's is. */
const DraftLoopShape = LoopOutcome(closed({}));

type DraftStatus = "converged" | "blocked" | "failed";

/** The terminal result, entries in `stages` order, checked against the ontology before it is stored. */
export function finishDraft(
	input: Pick<DraftLoopInput, "change" | "stages">,
	status: DraftStatus,
	entries: readonly DraftStageEntry[],
	extra: { escalation?: Escalation; notes?: string[] } = {},
): DraftLoopResult {
	const stages = input.stages.flatMap((s) => entries.filter((e) => e.stage === s.name));
	const result: DraftOutcome = { change: input.change, stages };
	const outcome = status === "blocked" ? { status, iterations: [], result, escalation: extra.escalation } : { status, iterations: [], result };
	const { result: _result, ...rest } = outcome;
	const shape = rest.status === "converged" ? { ...rest, result: {} } : rest;
	if (!check(DraftLoopShape, shape)) {
		throw new Error(`the draft loop built an outcome the ontology refuses: ${explain(DraftLoopShape, shape).join("; ")}`);
	}
	return { outcome: outcome as unknown as DraftLoopResult["outcome"], notes: extra.notes ?? [] };
}

type DraftPhases = TaskDefinition<DraftLoopInput, StoredDraftCheckpoint, DraftLoopResult, object>["phases"];

type DraftRuntime = Parameters<DraftPhases["stage"]>[1];

function specLoopOf(runtime: DraftRuntime): typeof SpecLoopTask {
	const task = runtime.registry.task(SPEC_LOOP) as typeof SpecLoopTask | undefined;
	if (task === undefined) throw new Error(`${DRAFT_LOOP_TASK} needs ${SPEC_LOOP} installed: install draftLoopExtensions(...)`);
	return task;
}

const phases: DraftPhases = {
	next: async (task, runtime, context) => {
		const cp = decodeDraftCheckpoint(task.state.checkpoint);
		let found;
		try {
			found = nextStage(task.input, cp.entries);
		} catch (error) {
			if (!(error instanceof ApprovalsFileError)) throw error;
			const done = finishDraft(task.input, "failed", cp.entries, { notes: [error.message] });
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
			return;
		}
		if (found.stage === undefined) {
			const done = finishDraft(task.input, "converged", found.entries);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
			return;
		}
		const next = encodeDraftCheckpoint({ phase: "stage", stage: found.stage, entries: found.entries });
		await runtime.commit(() => ({ status: "running", checkpoint: next }), context);
	},
	// Create the stage's spec loop and store its ID in one commit, so a crash leaves both or
	// neither; every later entry (a resume included) waits for the stored ID.
	stage: async (task, runtime, context) => {
		const cp = decodeDraftCheckpoint(task.state.checkpoint);
		const stage = cp.stage;
		if (stage === undefined) throw new Error(`${DRAFT_LOOP_TASK} stage phase has no stage`);

		if (cp.child === undefined) {
			const specLoop = specLoopOf(runtime);
			const runInput = stageLoopInput(task.input, stage, cp.entries);
			const entries = startedRun(cp.entries, stage);
			await runtime.commit(async (tx) => {
				const child = await tx.createTask(specLoop, runInput, { ownership: { kind: "task", taskId: runtime.taskId } });
				return { status: "waiting", checkpoint: encodeDraftCheckpoint({ phase: "stage", stage, child, entries }), on: [child], policy: "allSettled" };
			}, context);
			return;
		}

		const settled = await runtime.waitForTask(cp.child as TaskId<SpecLoopResult>, context);
		const ended = settled.state.outcome;
		const outcome = ended.status === "completed" ? readSpecOutcome(ended.result, cp.child) : undefined;
		const status = outcome?.status ?? ended.status;
		if (status === "converged") {
			const entries = cp.entries.map((e) => (e.stage === stage ? { ...e, approved: true } : e));
			await runtime.commit(() => ({ status: "running", checkpoint: encodeDraftCheckpoint({ phase: "next", entries }) }), context);
			return;
		}
		const done =
			outcome?.status === "blocked"
				? finishDraft(task.input, "blocked", cp.entries, { escalation: outcome.escalation })
				: finishDraft(task.input, "failed", cp.entries, { notes: [`the ${stage} stage ended ${status}`] });
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
	},
	// Like `stage`: the answering run is created and its ID stored in one commit. The answer
	// was checked before this draft run started, so a refusal here is an error, not an outcome.
	answer: async (task, runtime, context) => {
		const cp = decodeDraftCheckpoint(task.state.checkpoint);
		const stage = cp.stage;
		const answer = task.input.resume?.answer;
		if (stage === undefined || cp.child === undefined || answer === undefined) {
			throw new Error(`${DRAFT_LOOP_TASK} answer phase has no blocked spec loop to answer`);
		}
		const specLoop = specLoopOf(runtime);
		const record = await runtime.getTask(cp.child as TaskId<SpecLoopResult>, context);
		const runInput = specAnswerInput(record, cp.child, answer);
		const entries = startedRun(cp.entries, stage);
		await runtime.commit(async (tx) => {
			const child = await tx.createTask(specLoop, runInput, { ownership: { kind: "task", taskId: runtime.taskId } });
			return { status: "waiting", checkpoint: encodeDraftCheckpoint({ phase: "stage", stage, child, entries }), on: [child], policy: "allSettled" };
		}, context);
	},
};

export const DraftLoopTask: Task<DraftLoopInput, StoredDraftCheckpoint, DraftLoopResult, object> = defineTask<
	DraftLoopInput,
	StoredDraftCheckpoint,
	DraftLoopResult
>({
	name: DRAFT_LOOP_TASK,
	version: DRAFT_LOOP_VERSION,
	initial: (input) => encodeDraftCheckpoint(initialDraftCheckpoint(input)),
	phases,
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
	},
});

/** Brings the `agentscript.draft-loop` task. Installed beside `specLoopExtensions`, whose spec loops are its children. */
export const DraftLoop: Extension = defineExtension({ name: DRAFT_LOOP_TASK, tasks: [DraftLoopTask] });
