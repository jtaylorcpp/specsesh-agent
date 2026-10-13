/**
 * The change loop: every group of a change in order, each as a child group loop, then
 * the change check once. A refusal at start creates nothing and calls no model.
 *
 *   next    queue empty → check;  else → group (shift)
 *   group   create the group loop and store its id in one commit → await it
 *           converged          → entered → next
 *           blocked            → blocked, its escalation at level "change"
 *           exhausted | failed → failed, naming the group
 *   check   changeChecks in order, argv, no shell → one Iteration on { check: "change" }
 */

import { readFileSync } from "node:fs";
import {
	defineExtension,
	defineTask,
	type Extension,
	type JsonObject,
	type Task,
	type TaskDefinition,
	type TaskId,
} from "@earendil-works/pi-durable";
import {
	ChangeOutcome,
	LoopOutcome,
	check,
	explain,
	feedbackFor,
	type Escalation,
	type Iteration,
	type ScenarioRef,
	type Target,
} from "../openspec/index.js";
import type { Workspace } from "../durable/index.js";
import {
	CHANGE_LOOP_TASK,
	CHANGE_LOOP_VERSION,
	changeChecksOf,
	decodeChangeCheckpoint,
	initialChangeCheckpoint,
	type ChangeCheckpoint,
	type ChangeEntry,
	type ChangeLoopOptions,
	type ChangePhase,
} from "./change-input.js";
import { checkEvidence, runLoopChecks, type CheckRun } from "./checks.js";
import { concatDeltas } from "./deltas.js";
import { TaskLoopStartError } from "./errors.js";
import { GroupLoopTask, findGroup, formatCheckOutput, resolveGroupOptions, type GroupLoopInput, type GroupLoopResult } from "./group.js";
import { loopWorkspace } from "./loop.js";
import { BUNDLED_SCRIPTS, DEFAULT_ESCALATE_TO } from "./options.js";
import { readChange, readScript, readSource } from "./sources.js";
import { delegatesOf } from "./start.js";

/** Any JSON value; pi-durable exports `JsonObject` but not its value type. */
type JsonValue = JsonObject[string];

/**
 * The durable input of `agentscript.change-loop`: what every group loop shares, every source
 * already read into text, plus the groups, the change check and what no task claimed.
 */
export interface ChangeLoopInput extends Omit<GroupLoopInput, "group" | "groupTitle" | "tasks" | "resume"> {
	/** Every group in tasks.md, ascending. */
	readonly groups: readonly number[];
	readonly changeChecks: readonly string[];
	/** The delta scenarios no task quoted by exact name when the loop started. */
	readonly unclaimed: readonly ScenarioRef[];
	/** Set only on a run that answers a blocked change loop: the encoded checkpoint it starts from, and the loop it answers. */
	readonly resume?: { readonly checkpoint: JsonObject; readonly answers: number };
}

/** The change loop's durable result: the ontology's outcome, notes it has no field for, and the group loop that blocked it. */
export interface ChangeLoopResult extends JsonObject {
	outcome: LoopOutcome<ChangeOutcome> & JsonObject;
	notes: string[];
	/** When a group blocked the change: the group, and its loop, which an answer resumes; else `null`. */
	blocked: { group: number; loop: number } | null;
}

const GROUP_NUMBER = /^## (\d+)\./gm;

/** Every group number in tasks.md, once each and ascending. */
export function groupNumbers(tasksText: string): number[] {
	return [...new Set([...tasksText.matchAll(GROUP_NUMBER)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * Read every source once and list the groups. Refuses a change with no group, a group with
 * no task, or no checks. `unclaimed` is the guard's, kept as it was at the start.
 */
export function readChangeInput(options: ChangeLoopOptions, unclaimed: readonly ScenarioRef[]): ChangeLoopInput {
	// `group` is a placeholder: resolving checks the budget and fills the judge script, as for one group.
	const resolved = resolveGroupOptions({ ...options, group: 1 });
	const script = readScript(resolved.script);
	const groupScript = "bundled" in resolved.groupScript ? readFileSync(BUNDLED_SCRIPTS.group, "utf8") : readSource(resolved.groupScript);
	const change = readChange(resolved.change);
	const groups = groupNumbers(change.tasks);
	if (groups.length === 0) throw new TaskLoopStartError(`no group in ${change.tasksLabel}`);
	for (const n of groups) findGroup(change.tasks, n, change.tasksLabel);
	const checks = [...(options.checks ?? [])];
	if (checks.length === 0) throw new TaskLoopStartError("a group needs at least one check");
	return {
		groups,
		proposal: change.proposal,
		design: change.design,
		deltas: concatDeltas(change.deltas),
		tasksText: change.tasks,
		...(change.tasksPath !== undefined ? { tasksPath: change.tasksPath } : {}),
		script,
		groupScript,
		workspace: options.workspace,
		budget: { maxIterations: resolved.budget.maxIterations, maxReworks: resolved.budget.maxReworks },
		checks,
		changeChecks: [...changeChecksOf(options)],
		allow: [...(options.allow ?? [])],
		escalateTo: options.escalateTo ?? DEFAULT_ESCALATE_TO,
		unclaimed: [...unclaimed],
		...(options.model !== undefined ? { model: options.model } : {}),
		...delegatesOf(options),
		...(options.worktree !== undefined ? { worktree: { path: options.worktree.path, branch: options.worktree.branch } } : {}),
	};
}

/** The group loop's input for `group`: the change's shared input, and the group's heading and tasks as tasks.md had them at the start. */
export function groupLoopInputFor(input: ChangeLoopInput, group: number): GroupLoopInput {
	const { groups: _groups, changeChecks: _changeChecks, unclaimed: _unclaimed, resume: _resume, ...shared } = input;
	const found = findGroup(input.tasksText, group);
	return { ...shared, group: found.number, groupTitle: found.title, tasks: found.tasks };
}

// ── The durable task ────────────────────────────────────────────────────────

/** The checkpoint as pi-durable stores it: JSON, narrowed per phase so each handler's task type is not `never`. */
export type StoredChangeCheckpoint = { [P in ChangePhase]: JsonObject & { phase: P } }[ChangePhase];

/** Copy only the fields that are present; `undefined` is never written. */
export function encodeChangeCheckpoint(cp: ChangeCheckpoint): JsonObject {
	return {
		phase: cp.phase,
		queue: [...cp.queue],
		entries: cp.entries,
		...(cp.child !== undefined
			? { child: { group: cp.child.group, ...(cp.child.id !== undefined ? { id: cp.child.id } : {}) } }
			: {}),
	};
}

function stored(cp: ChangeCheckpoint): StoredChangeCheckpoint {
	return encodeChangeCheckpoint(cp) as StoredChangeCheckpoint;
}

/** Pops the queue head into `group`, or goes to `check` when the queue is empty. No model request, no command. */
export function nextChangeCheckpoint(cp: ChangeCheckpoint): ChangeCheckpoint {
	const { child: _child, ...kept } = cp;
	const [head, ...rest] = cp.queue;
	return head === undefined ? { ...kept, phase: "check", queue: [] } : { ...kept, phase: "group", queue: rest, child: { group: head } };
}

/** The entry for `group` with `outcome` as its latest run: replaced in place, or appended; `runs` counted. */
export function recordGroupEntry(entries: readonly ChangeEntry[], group: number, outcome: ChangeEntry["outcome"]): ChangeEntry[] {
	const runs = (entries.find((e) => e.group === group)?.runs ?? 0) + 1;
	const entry: ChangeEntry = { group, outcome, runs };
	return entries.some((e) => e.group === group) ? entries.map((e) => (e.group === group ? entry : e)) : [...entries, entry];
}

/**
 * The checkpoint a run answering a blocked change starts from: the entries carried (so the blocked
 * group's `runs` goes on), the groups not yet reached queued, and `groupRun`, the blocked group's
 * new run that `answerGroupEscalation` started, already stored as the child to await.
 */
export function resumeChangeCheckpoint(
	input: Pick<ChangeLoopInput, "groups">,
	result: ChangeLoopResult,
	groupRun: TaskId,
): ChangeCheckpoint {
	if (result.blocked === null) throw new Error("the change loop was not blocked by a group");
	const entries = (result.outcome.result?.groups ?? []) as ChangeEntry[];
	const queue = input.groups.filter((g) => !entries.some((e) => e.group === g));
	return { phase: "group", queue, entries, child: { group: result.blocked.group, id: groupRun } };
}

/** The one target the change check judges. */
export const CHANGE_TARGET: Target = { check: "change" };

/** The change check as an ontology `Iteration`: a `CheckEvidence` per command, met only when every one exits 0. */
export function changeCheckIteration(runs: readonly CheckRun[]): Iteration {
	const evidence = checkEvidence(runs);
	const base = { n: 1, plan: "", actions: [], evidence };
	if (runs.every((r) => r.exitCode === 0)) return { ...base, verdict: { met: true, satisfied: [CHANGE_TARGET], unmet: [] }, feedback: [] };
	const reason = `change check failed:\n${formatCheckOutput(runs)}`;
	return {
		...base,
		verdict: { met: false, satisfied: [], unmet: [{ target: CHANGE_TARGET, reason }] },
		feedback: [feedbackFor({ kind: "code-defect", target: CHANGE_TARGET, evidence, message: reason })],
	};
}

const ChangeLoopOutcome = LoopOutcome(ChangeOutcome);

type ChangeStatus = "converged" | "blocked" | "failed";

function buildChangeOutcome(
	status: ChangeStatus,
	entries: readonly ChangeEntry[],
	iterations: readonly Iteration[],
	extra: { input: Pick<ChangeLoopInput, "unclaimed">; escalation?: Escalation },
): LoopOutcome<ChangeOutcome> & JsonObject {
	const result = { groups: [...entries], unclaimed: [...extra.input.unclaimed] };
	return (
		status === "blocked"
			? { status, iterations: [...iterations], result, escalation: extra.escalation as Escalation }
			: { status, iterations: [...iterations], result }
	) as unknown as LoopOutcome<ChangeOutcome> & JsonObject;
}

/**
 * The terminal result, checked against the ontology before it is stored. An outcome the ontology
 * refuses is replaced by a `failed` one noting it; if that is refused too, this throws so the
 * durable task records the error.
 */
export function finishChange(
	status: ChangeStatus,
	entries: readonly ChangeEntry[],
	iterations: readonly Iteration[],
	extra: { input: Pick<ChangeLoopInput, "unclaimed">; escalation?: Escalation; notes?: string[]; blocked?: { group: number; loop: number } },
): ChangeLoopResult {
	const notes = extra.notes ?? [];
	const outcome = buildChangeOutcome(status, entries, iterations, extra);
	if (check(ChangeLoopOutcome, outcome)) return { outcome, notes, blocked: extra.blocked ?? null };
	const reason = explain(ChangeLoopOutcome, outcome).join("; ");
	const failed: ChangeLoopResult = {
		outcome: buildChangeOutcome("failed", entries, iterations, { input: extra.input }),
		notes: [...notes, `the change's ${status} outcome broke the ontology: ${reason}`],
		blocked: null,
	};
	if (!check(ChangeLoopOutcome, failed.outcome)) {
		throw new Error(`the change loop built an outcome the ontology refuses: ${explain(ChangeLoopOutcome, failed.outcome).join("; ")}`);
	}
	return failed;
}

/** The terminal result once the change check ran: converged only when it passed and every group was entered. */
export function checkedChange(input: Pick<ChangeLoopInput, "groups" | "unclaimed">, entries: readonly ChangeEntry[], runs: readonly CheckRun[]): ChangeLoopResult {
	const iteration = changeCheckIteration(runs);
	const missing = input.groups.filter((g) => !entries.some((e) => e.group === g));
	if (missing.length > 0) {
		return finishChange("failed", entries, [iteration], { input, notes: [`no outcome for group ${missing.join(", ")}`] });
	}
	return iteration.verdict.met
		? finishChange("converged", entries, [iteration], { input })
		: finishChange("failed", entries, [iteration], { input, notes: ["the change check failed"] });
}

type ChangePhases = TaskDefinition<ChangeLoopInput, StoredChangeCheckpoint, ChangeLoopResult, object>["phases"];

/**
 * The check phase over `loopWorkspace(input, bound)`. Nothing is stored before the checks
 * finish, so a process that dies here reruns them all.
 */
function checkPhase(bound?: Workspace): ChangePhases["check"] {
	return async (task, runtime, context) => {
		const cp = decodeChangeCheckpoint(task.state.checkpoint);
		const runs = await runLoopChecks(loopWorkspace(task.input, bound), task.input.changeChecks);
		const done = checkedChange(task.input, cp.entries, runs);
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
	};
}

/** The change loop task with no bound workspace: its check runs in the input's directory. */
export const ChangeLoopTask: Task<ChangeLoopInput, StoredChangeCheckpoint, ChangeLoopResult, object> = defineTask<
	ChangeLoopInput,
	StoredChangeCheckpoint,
	ChangeLoopResult
>({
	name: CHANGE_LOOP_TASK,
	version: CHANGE_LOOP_VERSION,
	initial: (input) =>
		input.resume !== undefined ? stored(decodeChangeCheckpoint(input.resume.checkpoint)) : stored(initialChangeCheckpoint(input.groups)),
	phases: {
		next: async (task, runtime, context) => {
			const cp = decodeChangeCheckpoint(task.state.checkpoint);
			await runtime.commit(() => ({ status: "running", checkpoint: stored(nextChangeCheckpoint(cp)) }), context);
		},
		// Create the group loop for `child.group` and store its ID in one commit, so a crash leaves
		// both or neither; every later entry (a resume included) waits for the stored ID. A run
		// answering a blocked change starts with the ID already stored.
		group: async (task, runtime, context) => {
			const cp = decodeChangeCheckpoint(task.state.checkpoint);
			const current = cp.child?.group;
			if (current === undefined) throw new Error("change-loop group phase has no current group");

			if (cp.child?.id === undefined) {
				await runtime.commit(async (tx) => {
					const id = await tx.createTask(GroupLoopTask, groupLoopInputFor(task.input, current), {
						ownership: { kind: "task", taskId: runtime.taskId },
					});
					return {
						status: "waiting",
						checkpoint: stored({ ...cp, child: { group: current, id } }),
						on: [id],
						policy: "allSettled",
					};
				}, context);
				return;
			}

			const id = cp.child.id;
			const settled = await runtime.waitForTask(id as TaskId<GroupLoopResult>, context);
			const ended = settled.state.outcome;
			const outcome: ChangeEntry["outcome"] =
				ended.status === "completed" ? ended.result.outcome : ({ status: "failed", iterations: [] } as ChangeEntry["outcome"]);
			const entries = recordGroupEntry(cp.entries, current, outcome);

			if (outcome.status === "converged") {
				const { child: _child, ...kept } = cp;
				await runtime.commit(() => ({ status: "running", checkpoint: stored({ ...kept, phase: "next", entries }) }), context);
				return;
			}
			const done =
				outcome.status === "blocked"
					? finishChange("blocked", entries, [], {
							input: task.input,
							escalation: { ...outcome.escalation, level: "change" },
							blocked: { group: current, loop: id as unknown as number },
						})
					: finishChange("failed", entries, [], { input: task.input, notes: [`group ${current} ended ${outcome.status}`] });
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
		},
		check: checkPhase(),
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
	},
});

/** Brings the `agentscript.change-loop` task. Installed beside `groupLoopExtensions`, whose group loops are its children. */
export const ChangeLoop: Extension = defineExtension({ name: CHANGE_LOOP_TASK, tasks: [ChangeLoopTask] });

/** `ChangeLoop` with its check bound to `workspace`. pi-durable runs a task's phases from the installed definition. */
export function boundChangeLoop(workspace: Workspace): Extension {
	const definition = ChangeLoopTask.definition;
	const task = defineTask<ChangeLoopInput, StoredChangeCheckpoint, ChangeLoopResult>({
		...definition,
		phases: { ...definition.phases, check: checkPhase(workspace) },
	});
	return defineExtension({ name: CHANGE_LOOP_TASK, tasks: [task] });
}
