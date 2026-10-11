/**
 * The task loop as one pi-durable task, `agentscript.task-loop`: the script runs
 * once per iteration as an `agentscript.run` child, and the loop judges what it
 * read back.
 *
 *   iterate  create the child run with the contract variables seeded and every
 *            subagent as an entry, in source order; wait on it, in one commit
 *   await    read the settled child (by its ID, so a resumed loop waits for the
 *            same run and starts no other)
 *   judge    map the read-back to the next iteration or the outcome; tick on
 *            convergence
 *
 * The child is created from the `agentscript.run` task the harness installed,
 * so its actions run on the host's registry (`taskLoopExtensions`).
 */

import type { RunResult, VariableValue } from "../interpreter/index.js";
import { analyze } from "../authoring/index.js";
import { readSubagents } from "../interpreter/compose.js";
import {
	defineExtension,
	defineTask,
	type Extension,
	type Task,
	type TaskId,
} from "@earendil-works/pi-durable";
import { AgentScriptRun, agentScriptExtensions, builtinActions, createActionRegistry, type RunInput } from "../durable/index.js";
import { LoopOutcome, TaskOutcome, check, explain } from "../openspec/index.js";
import { readRun } from "./iteration.js";
import { judgeIteration } from "./judge.js";
import type { LoopCheckpoint, TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { tickTask } from "./tick.js";

export const TASK_LOOP = "agentscript.task-loop";

const TaskLoopOutcome = LoopOutcome(TaskOutcome);

/** The contract's seeded variables for iteration `n`. */
export function seededVariables(input: TaskLoopInput, n: number, carried: string): Record<string, VariableValue> {
	return {
		task_id: input.task,
		task_text: input.taskText,
		proposal: input.proposal,
		design: input.design,
		deltas: input.deltas,
		iteration: n,
		carried,
	};
}

/** Every subagent the script declares, in source order. */
export function subagentsOf(script: string): string[] {
	return [...readSubagents(analyze(script).parsed).keys()];
}

function result(outcome: TaskLoopResult["outcome"], notes: string[]): TaskLoopResult {
	if (!check(TaskLoopOutcome, outcome)) {
		throw new Error(`the task loop built an outcome the ontology refuses: ${explain(TaskLoopOutcome, outcome).join("; ")}`);
	}
	return { outcome, notes };
}

export const TaskLoopTask: Task<TaskLoopInput, LoopCheckpoint, TaskLoopResult, object> = defineTask<
	TaskLoopInput,
	LoopCheckpoint,
	TaskLoopResult
>({
	name: TASK_LOOP,
	version: 1,
	initial: (input) => ({ phase: "iterate", iterations: [...input.earlier], carried: input.carried }),
	phases: {
		iterate: async (task, runtime, context) => {
			const { iterations, carried } = task.state.checkpoint;
			const input = task.input;
			const runTask = runtime.registry.task(AgentScriptRun.definition.name) as typeof AgentScriptRun | undefined;
			if (runTask === undefined) {
				throw new Error(`${TASK_LOOP} needs ${AgentScriptRun.definition.name} installed: install taskLoopExtensions(...)`);
			}
			const runInput: RunInput = {
				source: input.script,
				options: { entry: subagentsOf(input.script), variables: seededVariables(input, iterations.length + 1, carried) },
				...(input.model !== undefined ? { model: input.model } : {}),
			};
			await runtime.commit(async (tx) => {
				const child = await tx.createTask(runTask, runInput, { ownership: { kind: "task", taskId: runtime.taskId } });
				return {
					status: "waiting",
					checkpoint: { phase: "await", iterations, carried, child },
					on: [child],
					policy: "allSettled",
				};
			}, context);
		},
		await: async (task, runtime, context) => {
			const { iterations, carried, child } = task.state.checkpoint;
			const settled = await runtime.waitForTask(child as TaskId<RunResult>, context);
			const outcome = settled.state.outcome;
			const entries = subagentsOf(task.input.script);
			const read =
				outcome.status === "completed"
					? readRun(outcome.result, undefined, entries)
					: readRun(
							outcome.result,
							`the run ended ${outcome.status}: ${outcome.status === "failed" ? outcome.error.message : (outcome.reason ?? "")}`,
							entries,
						);
			await runtime.commit(
				() => ({ status: "running", checkpoint: { phase: "judge", iterations, carried, child, read } }),
				context,
			);
		},
		judge: async (task, runtime, context) => {
			const { iterations, read } = task.state.checkpoint;
			const input = task.input;
			const decision = judgeIteration(input, iterations, read);
			if (decision.kind === "iterate") {
				await runtime.commit(
					() => ({ status: "running", checkpoint: { phase: "iterate", iterations: decision.iterations, carried: decision.carried } }),
					context,
				);
				return;
			}
			let done: TaskLoopResult;
			if (decision.kind === "converged") {
				const tick = tickTask(input.tasksPath, input.task);
				done = result(
					{ status: "converged", iterations: decision.iterations, result: { task: input.task, ticked: tick.ticked } } as TaskLoopResult["outcome"],
					tick.note === undefined ? [] : [tick.note],
				);
			} else {
				done = result(decision.outcome as TaskLoopResult["outcome"], decision.notes);
			}
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
		},
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
	},
});

/** Brings the `agentscript.task-loop` task. Installed beside the run and step extensions bound to the loop's actions. */
export const TaskLoop: Extension = defineExtension({ name: TASK_LOOP, tasks: [TaskLoopTask] });

export interface TaskLoopActionOptions {
	readonly workspace: string;
	readonly checks?: readonly string[];
	readonly allow?: readonly string[];
	/** The Claude Code binary `delegate_claude_code` runs. Defaults to `claude` on PATH. */
	readonly claudeBinary?: string;
}

/** The registry `startTaskLoop` checks a script against: the built-ins for the loop's workspace, checks and allowlist. */
export function taskLoopRegistry(options: TaskLoopActionOptions) {
	return createActionRegistry(
		builtinActions({
			workspace: options.workspace,
			checks: options.checks ?? [],
			allow: options.allow ?? [],
			...(options.claudeBinary !== undefined ? { claudeBinary: options.claudeBinary } : {}),
		}),
	);
}

/**
 * What a harness running task loops installs: `TaskLoop`, and the run and step
 * extensions over the built-in actions for one workspace, check list and
 * allowlist. A harness runs the loops of that one configuration.
 */
export function taskLoopExtensions(options: TaskLoopActionOptions): readonly [Extension, Extension, Extension] {
	const { run, step } = agentScriptExtensions({ actions: taskLoopRegistry(options), workspace: options.workspace });
	return [TaskLoop, run, step];
}
