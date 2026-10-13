/**
 * `draft <change> [<feedback>]`: start, continue or answer a change's draft loop,
 * addressed by change, never by loop.
 *
 *   change state            draft                       draft "<feedback>"
 *   missing                 needs --intent: a new draft  refused
 *   review                  shown again, exit 0          answered as the principal's decision
 *   question                shown again, exit 1          answered the same way
 *   running                 resumed and awaited          refused
 *   ready                   a new draft, fresh budget    refused, nothing waits
 *   drafted                 nothing starts, exit 0       refused, nothing waits
 *
 * Feedback that is `approve` is refused in every state, naming `pnpm change approve`.
 *
 * Two halves, so every refusal comes before the database opens: `prepareDraft` checks
 * the arguments and reads the intent, touching nothing; `runDraft` writes `intent.md`
 * for a new change and works the loop on a harness the caller opened with
 * `draftLoopExtensions`. Neither prints, reads stdin or prompts: the result says what
 * to print and the exit code.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Harness, ModelRef, TaskId } from "@earendil-works/pi-durable";
import type { LoopOutcome, Recipient } from "../openspec/index.js";
import { changeState, type ChangeState, type StageDraft } from "./change-state.js";
import { answerDraftLoop, lastSpecLoop, startDraftLoop, waitForDraftLoop } from "./draft-api.js";
import type { DraftOutcome } from "./draft-input.js";
import { ApprovalsFileError, EscalationAnswerError } from "./errors.js";
import { readSpecOutcome } from "./spec-api.js";
import { INTENT_FILE, shownPath } from "./spec-cli.js";
import type { SpecLoopInput } from "./spec-loop.js";
import type { SpecStage } from "./spec-stage.js";
import { SPEC_STAGES } from "./spec-stages.js";

type DraftId = TaskId<LoopOutcome<DraftOutcome>>;

/** The command's arguments, as the bin parsed them. */
export interface DraftArgs {
	readonly change: string;
	/** The principal's words for what is waiting: a revision at a review, or a question's answer. */
	readonly feedback?: string;
	readonly intent?: string;
	/** Resolved against `cwd`. */
	readonly intentFile?: string;
}

export interface DraftPrepareOptions {
	/** The repo root, where `openspec/` lives. */
	readonly workspace: string;
	/** The directory holding the change directories: the config's `changesDir`, resolved. */
	readonly changesDir: string;
	/** The directory `--intent-file` resolves against. */
	readonly cwd: string;
}

/** Checked arguments: the change, its directory, and the intent of a new change. */
export interface DraftRequest {
	readonly kind: "request";
	readonly change: string;
	readonly workspace: string;
	/** Absolute: the directory holding `changeDir`. */
	readonly changesDir: string;
	readonly changeDir: string;
	/** `changeDir` as messages and output name it: relative to the workspace when under it. */
	readonly changePath: string;
	readonly feedback?: string;
	/** Set only for a change that does not exist yet. */
	readonly intent?: string;
}

export interface DraftRefusal {
	readonly kind: "refused";
	readonly message: string;
	readonly exitCode: 2;
}

export interface DraftRunOptions {
	readonly model?: ModelRef;
	readonly budget?: { readonly maxIterations: number };
	readonly escalateTo?: Recipient;
	/** Who answers with the feedback; a review needs a name. */
	readonly principal?: string;
	/** The stages, in order. Defaults to `SPEC_STAGES`. */
	readonly stages?: readonly SpecStage[];
	/** Called once a loop exists, before any model call, so a crash still leaves its ID. */
	readonly onLoop?: (loop: number) => void;
}

interface Shown {
	readonly change: string;
	readonly loop: number;
	/** True when this call ran the loop; false when it only shows what was already waiting. */
	readonly ran: boolean;
	readonly approved: readonly string[];
}

export type DraftResult =
	| DraftRefusal
	| (Shown & { readonly kind: "review"; readonly stage: string; readonly files: readonly string[]; readonly drafts: readonly StageDraft[]; readonly exitCode: 0 })
	| (Shown & { readonly kind: "question"; readonly stage: string; readonly question: string; readonly drafts: readonly StageDraft[]; readonly exitCode: 1 })
	| { readonly kind: "drafted"; readonly change: string; readonly loop?: number; readonly ran: boolean; readonly approved: readonly string[]; readonly exitCode: 0 }
	| (Shown & {
			readonly kind: "failed";
			readonly status: "exhausted" | "failed";
			readonly reason: string;
			readonly stage?: string;
			readonly drafts: readonly StageDraft[];
			readonly exitCode: 1;
	  });

const refused = (message: string): DraftRefusal => ({ kind: "refused", message, exitCode: 2 });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A change id is one directory name under `changesDir`. */
export const isChangeId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");

const shown = shownPath;

/** True for feedback that is `approve`, trimmed and in any case: an approval, which only `approve` gives. */
export const isApproveFeedback = (feedback: string) => feedback.trim().toLowerCase() === "approve";

/** Check the arguments and read the intent. Writes nothing and opens nothing, so a refusal leaves everything as it was. */
export function prepareDraft(args: DraftArgs, options: DraftPrepareOptions): DraftRequest | DraftRefusal {
	const { change } = args;
	const workspace = resolve(options.workspace);
	const changesDir = resolve(options.changesDir);
	const changeDir = resolve(changesDir, change);
	if (!isChangeId(change) || dirname(changeDir) !== changesDir) {
		return refused(`"${change}" is not a change id: give the directory name under ${shown(workspace, changesDir)}/`);
	}
	if (args.feedback !== undefined && isApproveFeedback(args.feedback)) {
		return refused(`"approve" is not feedback; to approve the stage under review run: pnpm change approve ${change}`);
	}
	if (args.intent !== undefined && args.intentFile !== undefined) return refused("give --intent or --intent-file, not both");
	const changePath = shown(workspace, changeDir);
	const exists = existsSync(changeDir);
	const given = args.intent !== undefined || args.intentFile !== undefined;
	if (exists && given) return refused(`${change} exists: --intent and --intent-file are only for a new change; edit ${changePath}/${INTENT_FILE} instead`);
	if (!exists && !given) return refused(`the change ${change} does not exist; give --intent or --intent-file to start it`);
	if (!exists && args.feedback !== undefined) return refused(`the change ${change} does not exist, so nothing waits for feedback`);

	let intent = args.intent;
	if (args.intentFile !== undefined) {
		try {
			intent = readFileSync(resolve(options.cwd, args.intentFile), "utf8");
		} catch (error) {
			return refused(`cannot read --intent-file: ${message(error)}`);
		}
	}
	if (intent !== undefined && intent.trim() === "") return refused("the intent is empty");
	return { kind: "request", change, workspace, changesDir, changeDir, changePath, ...(args.feedback !== undefined ? { feedback: args.feedback } : {}), ...(intent !== undefined ? { intent } : {}) };
}

/**
 * Work the change's draft on `harness` (opened with `draftLoopExtensions` over the same
 * workspace and stages, not yet resumed): what the table at the top says, then the result.
 */
export async function runDraft(harness: Harness, request: DraftRequest, options: DraftRunOptions, context: Context): Promise<DraftResult> {
	const { change, changesDir, changeDir, changePath, feedback } = request;
	const stages = options.stages ?? SPEC_STAGES;

	// Only now is anything written: the change and its intent.
	if (request.intent !== undefined) {
		mkdirSync(changeDir, { recursive: true });
		writeFileSync(join(changeDir, INTENT_FILE), request.intent);
	}

	let state;
	try {
		state = await changeState(harness, { change, changesDir, stages }, context);
	} catch (error) {
		if (error instanceof ApprovalsFileError) return refused(`${changePath}/${error.message}`);
		throw error;
	}
	const nothingWaits = () => refused(`nothing of ${change} waits for feedback; run draft ${change} without it`);

	switch (state.kind) {
		case "missing":
			return refused(`the change ${change} does not exist; give --intent or --intent-file to start it`);
		case "review":
			if (feedback === undefined) return { ...state, ran: false, exitCode: 0 };
			return answer(harness, state.loop, request, options, context);
		case "question":
			if (feedback === undefined) return { ...state, ran: false, exitCode: 1 };
			return answer(harness, state.loop, request, options, context);
		case "running":
			if (feedback !== undefined) return refused(`draft loop ${state.loop} of ${change} is still running; run draft ${change} without feedback to finish it`);
			options.onLoop?.(state.loop);
			return settle(harness, state.loop, request, stages, context);
		case "drafted":
			if (feedback !== undefined) return nothingWaits();
			return { kind: "drafted", change, ...(state.loop !== undefined ? { loop: state.loop } : {}), ran: false, approved: state.approved, exitCode: 0 };
		case "ready": {
			if (feedback !== undefined) return nothingWaits();
			const intentPath = join(changeDir, INTENT_FILE);
			if (!existsSync(intentPath)) return refused(`${changePath} has no ${INTENT_FILE}; write one to say what the change is for`);
			let id: DraftId;
			try {
				id = await startDraftLoop(
					harness,
					{
						change,
						intent: readFileSync(intentPath, "utf8"),
						workspace: request.workspace,
						changesDir,
						stages,
						...(options.model !== undefined ? { model: options.model } : {}),
						...(options.budget !== undefined ? { budget: options.budget } : {}),
						...(options.escalateTo !== undefined ? { escalateTo: options.escalateTo } : {}),
					},
					context,
				);
			} catch (error) {
				return refused(message(error));
			}
			options.onLoop?.(Number(id));
			return settle(harness, Number(id), request, stages, context);
		}
	}
}

/** Answer the waiting draft loop with the feedback, as the principal, then settle the run that answers it. */
async function answer(harness: Harness, loop: number, request: DraftRequest, options: DraftRunOptions, context: Context): Promise<DraftResult> {
	let id: DraftId;
	try {
		id = await answerDraftLoop(
			harness,
			loop as unknown as DraftId,
			{ by: "principal", decision: request.feedback!, ...(options.principal !== undefined ? { principal: options.principal } : {}) },
			context,
		);
	} catch (error) {
		if (error instanceof EscalationAnswerError) return refused(error.message);
		throw error;
	}
	options.onLoop?.(Number(id));
	return settle(harness, Number(id), request, options.stages ?? SPEC_STAGES, context);
}

/** Run draft loop `loop` to its end and read where the change stands. */
export async function settle(harness: Harness, loop: number, request: DraftRequest, stages: readonly SpecStage[], context: Context): Promise<DraftResult> {
	const { change, changesDir } = request;
	harness.resume();
	let outcome: LoopOutcome<DraftOutcome>;
	try {
		outcome = await waitForDraftLoop(harness, loop as unknown as DraftId, context);
	} catch (error) {
		const state = await changeState(harness, { change, changesDir, stages }, context);
		return { kind: "failed", change, loop, ran: true, approved: approvedOf(state), status: "failed", reason: message(error), drafts: [], exitCode: 1 };
	}
	const state = await changeState(harness, { change, changesDir, stages }, context);
	if (outcome.status === "blocked" && state.kind === "review") return { ...state, ran: true, exitCode: 0 };
	if (outcome.status === "blocked" && state.kind === "question") return { ...state, ran: true, exitCode: 1 };
	if (outcome.status === "converged") return { kind: "drafted", change, loop, ran: true, approved: approvedOf(state), exitCode: 0 };

	const last = await lastStage(harness, loop, context);
	return {
		kind: "failed",
		change,
		loop,
		ran: true,
		approved: approvedOf(state),
		status: outcome.status === "exhausted" ? "exhausted" : "failed",
		reason: outcome.status === "blocked" ? `blocked: ${outcome.escalation.reason}` : outcome.status,
		...(last !== undefined ? { stage: last.stage } : {}),
		drafts: last?.drafts ?? [],
		exitCode: 1,
	};
}

const approvedOf = (state: ChangeState) => ("approved" in state ? [...state.approved] : []);

/** The stage draft loop `loop` ended on, and its drafts, from its last spec loop. */
async function lastStage(harness: Harness, loop: number, context: Context): Promise<{ stage: string; drafts: StageDraft[] } | undefined> {
	const record = await harness.getTask(loop as never, context);
	if (record === undefined) return undefined;
	const child = await lastSpecLoop(harness, record as never, context);
	if (child === undefined || child.state.status !== "terminal" || child.state.outcome.status !== "completed") return undefined;
	const outcome = readSpecOutcome(child.state.outcome.result, child.id);
	return {
		stage: (child.input as unknown as SpecLoopInput).stage.name,
		drafts: outcome.iterations.map((iteration) => ({
			n: iteration.n,
			issues: iteration.evidence.flatMap((evidence) => (evidence.kind === "validation" ? evidence.report.issues : [])),
		})),
	};
}
