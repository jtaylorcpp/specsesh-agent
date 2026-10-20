import type { JsonObject, ModelRef, TaskId } from "@earendil-works/pi-durable";
import type { DelegateGrants } from "../durable/delegation.js";
import type { Escalation, Iteration, LoopOutcome, Recipient, TaskOutcome } from "../openspec/index.js";
import type { IterationRead } from "./iteration.js";
import type { LoopWorktree } from "./options.js";

/** The durable input of `agentscript.task-loop`: every source already read into text. */
export interface TaskLoopInput {
	readonly task: string;
	readonly taskText: string;
	readonly proposal: string;
	readonly design: string;
	/** Every delta, concatenated with capability headings. */
	readonly deltas: string;
	/** Absolute; set only when tasks.md came from a file, which only then is ticked. */
	readonly tasksPath?: string;
	readonly script: string;
	readonly workspace: string;
	readonly budget: { readonly maxIterations: number };
	readonly checks: readonly string[];
	readonly allow: readonly string[];
	readonly escalateTo: Recipient;
	readonly model?: ModelRef;
	/** The grants the loop started with; a resumed loop rebuilds its registry from them. */
	readonly delegates?: DelegateGrants;
	/** Whether `delete_file` was granted; a resumed loop rebuilds its registry from it. Absent (older loops): `false`. */
	readonly deleteFiles?: boolean;
	readonly worktree?: LoopWorktree;
	/** What the first iteration of this run is seeded with: `""`, or an answered escalation's decision. */
	readonly carried: string;
	/** Iterations an earlier, blocked run of this loop recorded. This run numbers on from them. */
	readonly earlier: readonly Iteration[];
	/** The blocked loop this run answers, when it is one. */
	readonly answers?: number;
	/** The escalation that blocked it. */
	readonly escalation?: Escalation;
	/** The blocked loop's baseline, which an answered run measures `changed` from. Absent: the run takes its own. */
	readonly since?: Baseline;
	/** Repository-relative paths `changed` leaves out, besides tasks.md. */
	readonly excludeChanged?: readonly string[];
}

/**
 * The workspace as the loop's first iteration found it: path → snapshot value, sorted by path.
 * `null`: the workspace cannot snapshot. Absent (a loop stored before baselines): taken at the next `iterate`.
 */
export type Baseline = Record<string, string> | null;

export type LoopCheckpoint =
	| { readonly phase: "iterate"; readonly iterations: Iteration[]; readonly carried: string; readonly since?: Baseline }
	| {
			readonly phase: "await";
			readonly iterations: Iteration[];
			readonly carried: string;
			readonly child: TaskId;
			readonly since?: Baseline;
	  }
	| {
			readonly phase: "judge";
			readonly iterations: Iteration[];
			readonly carried: string;
			readonly child: TaskId;
			readonly read: IterationRead;
			readonly since?: Baseline;
	  }
	/** The judge said met and checks are configured: the gate runs them before the loop converges. */
	| {
			readonly phase: "gate";
			readonly iterations: Iteration[];
			readonly carried: string;
			readonly child: TaskId;
			readonly read: IterationRead;
			readonly since?: Baseline;
	  };

/**
 * The loop task's durable result: the ontology's outcome, notes it has no field for, and the
 * loop's baseline, which `answerEscalation` hands the next run (absent on a result stored
 * before baselines).
 */
export type TaskLoopResult = JsonObject & {
	outcome: LoopOutcome<TaskOutcome> & JsonObject;
	notes: string[];
	since?: Baseline;
};
