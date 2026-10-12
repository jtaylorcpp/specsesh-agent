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
 *            convergence. A met verdict with checks configured goes to the gate
 *   gate     run the checks (no child); converge and tick only if all pass,
 *            else record the iteration unmet and retry or exhaust
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
import { LoopOutcome, TaskOutcome, check, explain, outcomeStatus, type Finding, type Iteration } from "../openspec/index.js";
import { NEXT_ACTIONS } from "./contract.js";
import { checkEvidence, runGroupChecks } from "./checks.js";
import { readRun, recordIteration, taskTarget } from "./iteration.js";
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

/** The converged outcome: ticks the task and records the result. Shared by the judge and the gate. */
function converge(input: TaskLoopInput, iterations: Iteration[]): TaskLoopResult {
	const tick = tickTask(input.tasksPath, input.task);
	return result(
		{ status: "converged", iterations, result: { task: input.task, ticked: tick.ticked } } as TaskLoopResult["outcome"],
		tick.note === undefined ? [] : [tick.note],
	);
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
				options: {
					entry: subagentsOf(input.script),
					variables: seededVariables(input, iterations.length + 1, carried),
					choices: { next_action: [...NEXT_ACTIONS] },
				},
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
			if (decision.kind === "gate") {
				const { carried, child } = task.state.checkpoint;
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "gate", iterations, carried, child, read } }), context);
				return;
			}
			const done =
				decision.kind === "converged"
					? converge(input, decision.iterations)
					: result(decision.outcome as TaskLoopResult["outcome"], decision.notes);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
		},
		// Runs the checks and starts no child. Nothing is stored before they finish, so a
		// process that dies here reruns them; checks only read.
		gate: async (task, runtime, context) => {
			const { iterations, read } = task.state.checkpoint;
			const input = task.input;
			const n = iterations.length + 1;
			const runs = await runGroupChecks(input.checks, input.workspace);
			const failing = runs.filter((r) => r.exitCode !== 0);
			if (failing.length === 0) {
				const done = converge(input, [...iterations, recordIteration(n, input.task, read)]);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
				return;
			}

			const reason = `the judge said met, but the checks failed: ${failing.map((r) => `${r.command} exited ${r.exitCode}`).join(", ")}`;
			const target = taskTarget(input.task);
			const finding: Finding = { kind: "code-defect", target, evidence: checkEvidence(runs), message: reason };
			const iteration: Iteration = {
				n,
				plan: read.plan,
				actions: read.actions,
				evidence: read.evidence,
				verdict: { met: false, satisfied: [], unmet: [{ target, reason }] },
				feedback: [{ from: finding, action: "retry" }],
			};
			const all = [...iterations, iteration];
			const status = outcomeStatus(all.slice(input.earlier.length), input.budget);
			if (status === undefined) {
				const carried =
					reason + "\n\n" + failing.map((c) => "$ " + c.command + " (exit " + c.exitCode + ")\n" + c.output.slice(-4000)).join("\n\n");
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "iterate", iterations: all, carried } }), context);
				return;
			}
			const done = result({ status, iterations: all } as TaskLoopResult["outcome"], []);
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
	readonly delegateModel?: string;
	readonly delegateContext?: readonly string[];
}

/** The registry `startTaskLoop` checks a script against: the built-ins for the loop's workspace, checks, allowlist and delegate. */
export function taskLoopRegistry(options: TaskLoopActionOptions) {
	return createActionRegistry(
		builtinActions({
			workspace: options.workspace,
			checks: options.checks ?? [],
			allow: options.allow ?? [],
			...(options.claudeBinary !== undefined ? { claudeBinary: options.claudeBinary } : {}),
			...(options.delegateModel !== undefined ? { delegateModel: options.delegateModel } : {}),
			...(options.delegateContext !== undefined ? { delegateContext: options.delegateContext } : {}),
		}),
	);
}

/**
 * What a harness running task loops installs: `TaskLoop`, and the run and step
 * extensions over the built-in actions for one workspace, check list,
 * allowlist and delegate configuration. A harness runs the loops of that one
 * configuration.
 */
export function taskLoopExtensions(options: TaskLoopActionOptions): readonly [Extension, Extension, Extension] {
	const { run, step } = agentScriptExtensions({ actions: taskLoopRegistry(options), workspace: options.workspace });
	return [TaskLoop, run, step];
}
