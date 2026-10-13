/**
 * The spec loop's entry points for a host: start, wait, and the extensions to
 * install. Thin: the loop itself is `specLoopTask` in `spec-loop.ts`.
 *
 * A stage's `seed` and `gate` are functions, so the durable input names the
 * stage and the task finds it again in this process: `startSpecLoop` and
 * `specLoopExtensions({ stages })` both register it.
 */

import { join, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import { defineExtension, type Extension, type Harness, type ModelRef, type TaskId } from "@earendil-works/pi-durable";
import { start } from "../interpreter/index.js";
import { agentScriptExtensions, checkBindings, createActionRegistry, type Workspace } from "../durable/index.js";
import { localWorkspace } from "../node/index.js";
import { LoopOutcome, check, explain, type Recipient } from "../openspec/index.js";
import { closed } from "../openspec/schema.js";
import { ApprovalsFileError, TaskLoopStartError } from "./errors.js";
import { subagentsOf } from "./loop.js";
import { DEFAULT_ESCALATE_TO, DEFAULT_MAX_ITERATIONS } from "./options.js";
import { readSource } from "./sources.js";
import { staleApprovals } from "./spec-approvals.js";
import {
	SPEC_LOOP,
	SpecLoop,
	SpecLoopTask,
	registerSpecStage,
	specLoopTask,
	type SpecLoopInput,
	type SpecLoopResult,
	type StageOutcome,
} from "./spec-loop.js";
import { stageContractProblems, type SpecStage } from "./spec-stage.js";

export interface SpecLoopOptions {
	/** The change's id: its directory is `<changesDir>/<change>`. */
	readonly change: string;
	readonly stage: SpecStage;
	/** What the change is for, in the principal's words. */
	readonly intent: string;
	/** The repo root, where `openspec/` lives. Made absolute. */
	readonly workspace: string;
	/** The directory holding the change directories: the config's `changesDir`. Made absolute. */
	readonly changesDir: string;
	/** The owned paths of the stages already approved, seeded as `approved`. Defaults to none. */
	readonly approved?: readonly string[];
	readonly budget?: { readonly maxIterations: number };
	/** Who a stage's question goes to. A review always goes to the principal. */
	readonly escalateTo?: Recipient;
	/** The model every step runs on. Defaults to the owning conversation's model. */
	readonly model?: ModelRef;
}

export interface SpecLoopExtensionOptions {
	/** A directory (made `localWorkspace`) or a `Workspace`, where the gates' commands run. */
	readonly workspace: string | Workspace;
	/** Stages to register, so a loop resumed in this process finds them before any start. */
	readonly stages?: readonly SpecStage[];
}

/**
 * The spec loop (its gates' commands bound to a given `Workspace`), and the run and step
 * extensions with no actions: a stage script returns text, and the loop writes it.
 */
export function specLoopExtensions(options: SpecLoopExtensionOptions): readonly [Extension, Extension, Extension] {
	for (const stage of options.stages ?? []) registerSpecStage(stage);
	const workspace = typeof options.workspace === "string" ? localWorkspace(options.workspace) : options.workspace;
	const { run, step } = agentScriptExtensions({ actions: createActionRegistry([]), workspace: workspace.root });
	const loop = typeof options.workspace === "string" ? SpecLoop : defineExtension({ name: SPEC_LOOP, tasks: [specLoopTask(undefined, options.workspace)] });
	return [loop, run, step];
}

/** The loop's durable input, or the refusal. Reads the stage's script once. */
export function prepareSpecLoop(options: SpecLoopOptions): SpecLoopInput {
	const maxIterations = options.budget?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	if (!Number.isInteger(maxIterations) || maxIterations < 1) {
		throw new TaskLoopStartError(`budget.maxIterations must be a positive integer, got ${maxIterations}`);
	}
	assertAfterApproved(options);
	const script = readSource(options.stage.script);
	const problems = stageContractProblems(script);
	if (problems.length > 0) {
		throw new TaskLoopStartError(
			`the ${options.stage.name} stage's script breaks the stage contract, so the loop was not started:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
		);
	}
	// The whole document, as a run would check it, against no actions: a stage returns text.
	start(script, { entry: subagentsOf(script) });
	checkBindings(script, createActionRegistry([]));

	return {
		change: options.change,
		stage: { name: options.stage.name, owns: [...options.stage.owns] },
		script,
		intent: options.intent,
		workspace: resolve(options.workspace),
		changesDir: resolve(options.changesDir),
		approved: [...(options.approved ?? [])],
		budget: { maxIterations },
		escalateTo: options.escalateTo ?? DEFAULT_ESCALATE_TO,
		...(options.model !== undefined ? { model: options.model } : {}),
	};
}

/**
 * Refuses a stage when a stage in its `after` is unapproved, or a file recorded at its approval
 * changed or is gone. An `approvals.json` that is not valid refuses too, naming the file.
 */
function assertAfterApproved(options: SpecLoopOptions): void {
	if ((options.stage.after ?? []).length === 0) return;
	const changeDir = join(resolve(options.changesDir), options.change);
	let stale;
	try {
		stale = staleApprovals(options.stage, changeDir);
	} catch (error) {
		if (error instanceof ApprovalsFileError) throw new TaskLoopStartError(`${error.message}; the loop was not started`);
		throw error;
	}
	if (stale.length > 0) {
		throw new TaskLoopStartError(
			`the ${options.stage.name} stage cannot start yet, so the loop was not started:\n${stale.map((s) => `  - ${s.message}`).join("\n")}`,
		);
	}
}

/**
 * Durably create the spec loop and return its ID. Every refusal (budget, approvals of the
 * stages it follows, script source, stage contract, the script itself) comes first and creates nothing.
 */
export async function startSpecLoop(
	harness: Harness,
	options: SpecLoopOptions,
	context: Context,
): Promise<TaskId<LoopOutcome<StageOutcome>>> {
	const input = prepareSpecLoop(options);
	registerSpecStage(options.stage);
	const owner = await harness.root(context);
	const id = await owner.commit((tx) => tx.createTask(SpecLoopTask, input, { ownership: { kind: "conversation" } }), context);
	// The durable result is `{ outcome }`; `waitForSpecLoop` hands back the outcome.
	return id as unknown as TaskId<LoopOutcome<StageOutcome>>;
}

/** The ontology has no `StageOutcome` schema: the outcome is checked with its result left out, as the loop does, and the result by hand. */
const SpecLoopShape = LoopOutcome(closed({}));

function stageOutcomeProblems(result: unknown): string[] {
	if (result === undefined) return [];
	const r = result as Partial<Record<keyof StageOutcome, unknown>>;
	const problems: string[] = [];
	if (typeof r.change !== "string" || r.change === "") problems.push("result.change is not a non-empty string");
	if (typeof r.stage !== "string" || r.stage === "") problems.push("result.stage is not a non-empty string");
	if (!Array.isArray(r.files) || !r.files.every((f) => typeof f === "string")) problems.push("result.files is not a list of paths");
	if (typeof r.approved !== "boolean") problems.push("result.approved is not a boolean");
	return problems;
}

/** The settled spec loop's `LoopOutcome<StageOutcome>`, checked against the ontology. */
export async function waitForSpecLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<StageOutcome>>,
	context: Context,
): Promise<LoopOutcome<StageOutcome>> {
	const settled = await harness.waitForTask(id as unknown as TaskId<SpecLoopResult>, context);
	if (settled.state.status !== "terminal") {
		throw new Error(`spec loop ${String(id)} is ${settled.state.status}, not finished. Loop IDs are numbers; check the ID passed in.`);
	}
	const outcome = settled.state.outcome;
	if (outcome.status !== "completed") {
		const why = outcome.status === "failed" ? outcome.error.message : (outcome.reason ?? "");
		throw new Error(`spec loop ${String(id)} ended ${outcome.status}: ${why}`);
	}
	return readSpecOutcome(outcome.result, id);
}

/** A completed spec loop's durable result as its `LoopOutcome<StageOutcome>`, checked against the ontology. */
export function readSpecOutcome(durable: unknown, id: unknown): LoopOutcome<StageOutcome> {
	const value = (durable as Partial<SpecLoopResult> | undefined)?.outcome;
	const { result, ...rest } = (value ?? {}) as Partial<SpecLoopResult["outcome"]>;
	// Converged is the one status whose shape needs a result: an empty one stands in, as in the loop.
	const shape = rest.status === "converged" && result !== undefined ? { ...rest, result: {} } : rest;
	const problems = check(SpecLoopShape, shape) ? stageOutcomeProblems(result) : explain(SpecLoopShape, shape);
	if (problems.length > 0) {
		throw new Error(`spec loop ${String(id)} holds an outcome the ontology refuses: ${problems.join("; ")}`);
	}
	return value as LoopOutcome<StageOutcome>;
}
