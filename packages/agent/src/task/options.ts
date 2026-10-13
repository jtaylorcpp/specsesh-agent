/**
 * What a host hands the task loop, and what it falls back to.
 *
 * Every `Source` is text or a path; paths are read once, when the loop starts
 * (see `sources.ts`), so a resumed loop sees exactly what it started on.
 */

import type { ModelRef } from "@earendil-works/pi-durable";
import type { DelegateGrants } from "../durable/delegation.js";
import type { Recipient, TaskId } from "../openspec/index.js";

/** Inline text, or a file read when the loop starts. */
export type Source = { readonly text: string } | { readonly path: string };

/** The change: its directory, or each artifact on its own. */
export type ChangeSource =
	| { readonly dir: string }
	| {
			readonly proposal: Source;
			readonly design?: Source;
			readonly deltas: readonly Source[];
			readonly tasks: Source;
	  };

export interface TaskLoopOptions {
	readonly change: ChangeSource;
	/** The task's id in tasks.md, e.g. `2.4`. */
	readonly task: TaskId;
	/** The Agent Script run once per iteration. Defaults to the bundled `task.agent`. */
	readonly script?: Source;
	/** The directory every action runs in and is confined to. */
	readonly workspace: string;
	readonly budget?: { readonly maxIterations: number };
	/** The commands `run_checks` runs, in order. */
	readonly checks?: readonly string[];
	/** The first words `run_command` may run. */
	readonly allow?: readonly string[];
	readonly escalateTo?: Recipient;
	/** The model every step runs on. Defaults to the owning conversation's model. */
	readonly model?: ModelRef;
	/** The delegates the loop's scripts may call, as `mcpTool://delegate/<name>`. Unset: none. */
	readonly delegates?: DelegateGrants;
	/** The git worktree a host created for this loop, recorded so a resume or a status can name it. */
	readonly worktree?: LoopWorktree;
}

/** A git worktree a loop runs in. */
export interface LoopWorktree {
	readonly path: string;
	readonly branch: string;
}

export const DEFAULT_MAX_ITERATIONS = 8;
export const DEFAULT_ESCALATE_TO: Recipient = "principal";

/** The bundled scripts, beside this module in `src/` and in `dist/` alike. */
export const BUNDLED_SCRIPTS = {
	task: new URL("./scripts/task.agent", import.meta.url),
	delegate: new URL("./scripts/task-delegate.agent", import.meta.url),
	group: new URL("./scripts/group.agent", import.meta.url),
	specProposal: new URL("./scripts/spec-proposal.agent", import.meta.url),
	specDesign: new URL("./scripts/spec-design.agent", import.meta.url),
	specSpecify: new URL("./scripts/spec-specify.agent", import.meta.url),
	specPlan: new URL("./scripts/spec-plan.agent", import.meta.url),
} as const;
