/**
 * `approve <change>`: approve the stage of a change waiting for review, as the principal,
 * addressed by change, never by loop.
 *
 *   change state            approve
 *   review                  answered `approve` by the principal; the new run printed as draft's
 *   question                refused, naming `pnpm change draft <change> "<answer>"`
 *   anything else           refused: nothing is under review
 *
 * Two halves, as `draft`: `prepareApprove` checks the change id, touching nothing;
 * `runApprove` works the loop on a harness the caller opened with `draftLoopExtensions`.
 * The state is read before the principal is needed, so a refusal on state never depends
 * on who is approving. Neither prints, reads stdin or prompts.
 */

import { dirname, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Harness, ModelRef, TaskId } from "@earendil-works/pi-durable";
import type { LoopOutcome, Recipient } from "../openspec/index.js";
import { changeState, type ChangeState } from "./change-state.js";
import { isChangeId, settle, type DraftRefusal, type DraftRequest, type DraftResult } from "./cmd-draft.js";
import { answerDraftLoop } from "./draft-api.js";
import type { DraftOutcome } from "./draft-input.js";
import { ApprovalsFileError, EscalationAnswerError } from "./errors.js";
import { shownPath } from "./spec-cli.js";
import type { SpecStage } from "./spec-stage.js";
import { SPEC_STAGES } from "./spec-stages.js";

type DraftId = TaskId<LoopOutcome<DraftOutcome>>;

/** The command's arguments, as the bin parsed them. */
export interface ApproveArgs {
	readonly change: string;
}

export interface ApprovePrepareOptions {
	/** The repo root, where `openspec/` lives. */
	readonly workspace: string;
	/** The directory holding the change directories: the config's `changesDir`, resolved. */
	readonly changesDir: string;
}

export interface ApproveRunOptions {
	/** Who approves: `--principal`, else `git config user.name`, else `$USER`. Without one, a review is refused. */
	readonly principal?: string;
	readonly model?: ModelRef;
	readonly budget?: { readonly maxIterations: number };
	readonly escalateTo?: Recipient;
	/** The stages, in order. Defaults to `SPEC_STAGES`. */
	readonly stages?: readonly SpecStage[];
	/** Called once the new run exists, before any model call, so a crash still leaves its ID. */
	readonly onLoop?: (loop: number) => void;
}

/** What `draft` would show for the run the approval started, and the stage it approved (for slices). */
export type ApproveResult = DraftRefusal | (Exclude<DraftResult, DraftRefusal> & { readonly approvedStage: string });

const refused = (message: string): DraftRefusal => ({ kind: "refused", message, exitCode: 2 });

/** Check the change id. Opens nothing, so a refusal leaves everything as it was. */
export function prepareApprove(args: ApproveArgs, options: ApprovePrepareOptions): DraftRequest | DraftRefusal {
	const { change } = args;
	const workspace = resolve(options.workspace);
	const changesDir = resolve(options.changesDir);
	const changeDir = resolve(changesDir, change);
	if (!isChangeId(change) || dirname(changeDir) !== changesDir) {
		return refused(`"${change}" is not a change id: give the directory name under ${shownPath(workspace, changesDir)}/`);
	}
	return { kind: "request", change, workspace, changesDir, changeDir, changePath: shownPath(workspace, changeDir) };
}

/** Approve the stage waiting for review on `harness` (opened with `draftLoopExtensions`, not yet resumed), then settle the run it starts. */
export async function runApprove(harness: Harness, request: DraftRequest, options: ApproveRunOptions, context: Context): Promise<ApproveResult> {
	const { change, changesDir, changePath } = request;
	const stages = options.stages ?? SPEC_STAGES;

	let state: ChangeState;
	try {
		state = await changeState(harness, { change, changesDir, stages }, context);
	} catch (error) {
		if (error instanceof ApprovalsFileError) return refused(`${changePath}/${error.message}`);
		throw error;
	}
	if (state.kind === "question") {
		return refused(`${change} is waiting on a question, not a review:\n${state.question}\nanswer: pnpm change draft ${change} "<answer>"`);
	}
	if (state.kind !== "review") return refused(`nothing in ${change} is under review`);
	const principal = options.principal?.trim() ?? "";
	if (principal === "") return refused("approve needs a principal: pass --principal <name>");

	let id: DraftId;
	try {
		id = await answerDraftLoop(harness, state.loop as unknown as DraftId, { by: "principal", principal, decision: "approve" }, context);
	} catch (error) {
		if (error instanceof EscalationAnswerError) return refused(error.message);
		throw error;
	}
	options.onLoop?.(Number(id));
	const result = await settle(harness, Number(id), request, stages, context);
	return result.kind === "refused" ? result : { ...result, approvedStage: state.stage };
}
