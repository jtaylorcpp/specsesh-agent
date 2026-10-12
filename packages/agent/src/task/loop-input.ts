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
	readonly worktree?: LoopWorktree;
	/** What the first iteration of this run is seeded with: `""`, or an answered escalation's decision. */
	readonly carried: string;
	/** Iterations an earlier, blocked run of this loop recorded. This run numbers on from them. */
	readonly earlier: readonly Iteration[];
	/** The blocked loop this run answers, when it is one. */
	readonly answers?: number;
	/** The escalation that blocked it. */
	readonly escalation?: Escalation;
}

export type LoopCheckpoint =
	| { readonly phase: "iterate"; readonly iterations: Iteration[]; readonly carried: string }
	| { readonly phase: "await"; readonly iterations: Iteration[]; readonly carried: string; readonly child: TaskId }
	| {
			readonly phase: "judge";
			readonly iterations: Iteration[];
			readonly carried: string;
			readonly child: TaskId;
			readonly read: IterationRead;
	  }
	/** The judge said met and checks are configured: the gate runs them before the loop converges. */
	| {
			readonly phase: "gate";
			readonly iterations: Iteration[];
			readonly carried: string;
			readonly child: TaskId;
			readonly read: IterationRead;
	  };

/** The loop task's durable result: the ontology's outcome, and notes it has no field for. */
export interface TaskLoopResult extends JsonObject {
	outcome: LoopOutcome<TaskOutcome> & JsonObject;
	notes: string[];
}
