/**
 * Starting a group loop, the part that needs no harness: the group's options, every
 * source read once into the durable input, and the group found in tasks.md.
 * A refusal creates nothing and calls no model.
 */

import { readFileSync } from "node:fs";
import {
	defineExtension,
	defineTask,
	type Extension,
	type JsonObject,
	type ModelRef,
	type Task,
	type TaskId,
} from "@earendil-works/pi-durable";
import { GroupOutcome, LoopOutcome, check, explain, type Escalation, type Recipient, type TaskOutcome } from "../openspec/index.js";
import { DEFAULT_TIMEOUT_MS, runArgv, splitCommand } from "../durable/index.js";
import { concatDeltas } from "./deltas.js";
import { TaskLoopStartError } from "./errors.js";
import type { TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { TaskLoopTask } from "./loop.js";
import {
	BUNDLED_SCRIPTS,
	DEFAULT_ESCALATE_TO,
	DEFAULT_MAX_ITERATIONS,
	type LoopWorktree,
	type Source,
	type TaskLoopOptions,
} from "./options.js";
import { readChange, readScript, readSource } from "./sources.js";

/** Any JSON value; pi-durable exports `JsonObject` but not its value type. */
type JsonValue = JsonObject[string];

export const DEFAULT_MAX_REWORKS = 2;

/** The task-loop options with a group in place of the task, a judge script and a rework budget. */
export type GroupLoopOptions = Omit<TaskLoopOptions, "task" | "budget"> & {
	/** The group's number: the `2` of `## 2. Title` and of `2.1`. */
	readonly group: number;
	/** The group judge's Agent Script. Defaults to the bundled `group.agent`. */
	readonly groupScript?: Source;
	readonly budget?: { readonly maxIterations?: number; readonly maxReworks?: number };
};

/** The options with every default filled and the numbers checked. */
export interface ResolvedGroupOptions extends Omit<GroupLoopOptions, "groupScript" | "budget"> {
	readonly groupScript: Source | { readonly bundled: "group" };
	readonly budget: { readonly maxIterations: number; readonly maxReworks: number };
}

export interface GroupTask {
	readonly id: string;
	readonly text: string;
	readonly ticked: boolean;
}

export interface FoundGroup {
	readonly number: number;
	readonly title: string;
	readonly tasks: readonly GroupTask[];
}

/** The durable input of `agentscript.group-loop`: every source already read into text. */
export interface GroupLoopInput {
	readonly group: number;
	readonly groupTitle: string;
	/** The group's task lines, in file order. */
	readonly tasks: readonly GroupTask[];
	readonly proposal: string;
	readonly design: string;
	/** Every delta, concatenated with capability headings. */
	readonly deltas: string;
	readonly tasksText: string;
	/** Absolute; set only when tasks.md came from a file, which only then is ticked. */
	readonly tasksPath?: string;
	/** The task script every child task loop runs. */
	readonly script: string;
	readonly groupScript: string;
	readonly workspace: string;
	readonly budget: { readonly maxIterations: number; readonly maxReworks: number };
	readonly checks: readonly string[];
	readonly allow: readonly string[];
	readonly escalateTo: Recipient;
	readonly model?: ModelRef;
	readonly delegateModel?: string;
	readonly delegateContext?: readonly string[];
	readonly worktree?: LoopWorktree;
}

function positiveInteger(name: string, value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new TaskLoopStartError(`${name} must be a positive integer, got ${String(value)}`);
	}
	return value;
}

/** Validate the numbers and fill the defaults. */
export function resolveGroupOptions(options: GroupLoopOptions): ResolvedGroupOptions {
	const group = positiveInteger("group", options.group);
	const maxIterations = positiveInteger("budget.maxIterations", options.budget?.maxIterations ?? DEFAULT_MAX_ITERATIONS);
	const maxReworks = positiveInteger("budget.maxReworks", options.budget?.maxReworks ?? DEFAULT_MAX_REWORKS);
	return { ...options, group, groupScript: options.groupScript ?? { bundled: "group" }, budget: { maxIterations, maxReworks } };
}

/** The group judge script's text: the given source, or the bundled `group.agent`. */
function readGroupScript(script: ResolvedGroupOptions["groupScript"]): string {
	if ("bundled" in script) return readFileSync(BUNDLED_SCRIPTS.group, "utf8");
	return readSource(script);
}

const GROUP_HEADING = /^## (\d+)\.\s*(.*)$/;

/**
 * The group's heading and task lines. An unknown number refuses, listing every group
 * the file holds; a group without task lines refuses too.
 */
export function findGroup(tasksText: string, n: number, label = "tasks.md"): FoundGroup {
	const lines = tasksText.split(/\r?\n/);
	const numbers: number[] = [];
	let title: string | undefined;
	let inGroup = false;
	const taskLine = new RegExp(`^\\s*- \\[( |x|X)\\] (${n}\\.\\d+)\\b\\s*(.*)$`);
	const tasks: GroupTask[] = [];
	for (const line of lines) {
		if (line.startsWith("## ")) {
			const heading = GROUP_HEADING.exec(line);
			if (heading !== null) numbers.push(Number(heading[1]));
			inGroup = heading !== null && Number(heading[1]) === n && title === undefined;
			if (inGroup) title = (heading as RegExpExecArray)[2] as string;
			continue;
		}
		if (!inGroup) continue;
		const m = taskLine.exec(line);
		if (m !== null) tasks.push({ id: m[2] as string, text: m[3] as string, ticked: m[1] !== " " });
	}
	if (title === undefined) {
		throw new TaskLoopStartError(`no group ${n} in ${label}; groups: ${numbers.length > 0 ? numbers.join(", ") : "none"}`);
	}
	if (tasks.length === 0) throw new TaskLoopStartError(`group ${n} has no tasks`);
	return { number: n, title, tasks };
}

/** Read every source once and find the group. Nothing is read again after this. */
export function readGroupInput(options: ResolvedGroupOptions): GroupLoopInput {
	const script = readScript(options.script);
	const groupScript = readGroupScript(options.groupScript);
	const change = readChange(options.change);
	const found = findGroup(change.tasks, options.group, change.tasksLabel);
	return {
		group: found.number,
		groupTitle: found.title,
		tasks: found.tasks,
		proposal: change.proposal,
		design: change.design,
		deltas: concatDeltas(change.deltas),
		tasksText: change.tasks,
		...(change.tasksPath !== undefined ? { tasksPath: change.tasksPath } : {}),
		script,
		groupScript,
		workspace: options.workspace,
		budget: { maxIterations: options.budget.maxIterations, maxReworks: options.budget.maxReworks },
		checks: [...(options.checks ?? [])],
		allow: [...(options.allow ?? [])],
		escalateTo: options.escalateTo ?? DEFAULT_ESCALATE_TO,
		...(options.model !== undefined ? { model: options.model } : {}),
		...(options.delegateModel !== undefined ? { delegateModel: options.delegateModel } : {}),
		...(options.delegateContext !== undefined ? { delegateContext: [...options.delegateContext] } : {}),
		...(options.worktree !== undefined ? { worktree: { path: options.worktree.path, branch: options.worktree.branch } } : {}),
	};
}

/**
 * Every refusal that needs no harness, in order: the options, the sources, the group,
 * the checks. Returns the durable input; a refusal means nothing was created.
 */
export function validateGroupStart(options: GroupLoopOptions): GroupLoopInput {
	const input = readGroupInput(resolveGroupOptions(options));
	if (input.checks.length === 0) throw new TaskLoopStartError("a group needs at least one check");
	return input;
}

// ── The durable task ────────────────────────────────────────────────────────

export const GROUP_LOOP_NAME = "agentscript.group-loop";
export const GROUP_LOOP_VERSION = 1;
export const GROUP_LOOP = GROUP_LOOP_NAME;

export type GroupPhase = "next" | "task" | "check" | "judge";

const GROUP_PHASES: readonly GroupPhase[] = ["next", "task", "check", "judge"];

/** One row per task: its latest task-loop outcome and how many task loops this group ran for it. */
export type GroupEntry = {
	task: string;
	outcome: LoopOutcome<TaskOutcome> & JsonObject;
	runs: number;
};

/**
 * The checkpoint as code reads it. `child.task` is the task the `task` phase works;
 * `child.id` is its task loop, committed before it is awaited. pi-durable only ever
 * sees the encoded form (`encodeCheckpoint`).
 */
export type GroupCheckpoint = {
	phase: GroupPhase;
	queue: string[];
	entries: GroupEntry[];
	reworks: number;
	carried?: string;
	child?: { task: string; id?: TaskId };
	/** Every check's result, set by the `check` phase when it hands a failure to the judge. */
	checkOutput?: CheckRun[];
};

/** One group check's result: the command as configured, its exit code and its stdout and stderr combined. */
export type CheckRun = { command: string; exitCode: number; output: string };

/** Exit code recorded for a command that could not be spawned, as a shell reports a missing command. */
export const SPAWN_FAILED_EXIT_CODE = 127;

/** The checkpoint as pi-durable stores it: JSON, narrowed per phase so each handler's task type is not `never`. */
export type StoredGroupCheckpoint = { [P in GroupPhase]: JsonObject & { phase: P } }[GroupPhase];

/** Copy only the fields that are present; `undefined` is never written. */
export function encodeCheckpoint(cp: GroupCheckpoint): JsonObject {
	return {
		phase: cp.phase,
		queue: [...cp.queue],
		entries: cp.entries,
		reworks: cp.reworks,
		...(cp.carried !== undefined ? { carried: cp.carried } : {}),
		...(cp.child !== undefined
			? { child: { task: cp.child.task, ...(cp.child.id !== undefined ? { id: cp.child.id } : {}) } }
			: {}),
		...(cp.checkOutput !== undefined
			? { checkOutput: cp.checkOutput.map((r) => ({ command: r.command, exitCode: r.exitCode, output: r.output })) }
			: {}),
	};
}

/** Check the required fields of a stored checkpoint; anything else throws `group-loop checkpoint malformed: <field>`. */
export function decodeCheckpoint(raw: JsonValue): GroupCheckpoint {
	const malformed = (field: string): never => {
		throw new Error(`group-loop checkpoint malformed: ${field}`);
	};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return malformed("checkpoint");
	const o = raw as JsonObject;
	const phase = o.phase;
	if (typeof phase !== "string" || !GROUP_PHASES.includes(phase as GroupPhase)) return malformed("phase");
	const queue = o.queue;
	if (!Array.isArray(queue) || !queue.every((id) => typeof id === "string")) return malformed("queue");
	if (!Array.isArray(o.entries)) return malformed("entries");
	if (typeof o.reworks !== "number") return malformed("reworks");
	if (o.carried !== undefined && typeof o.carried !== "string") return malformed("carried");
	const child = o.child;
	if (child !== undefined) {
		if (child === null || typeof child !== "object" || Array.isArray(child) || typeof child.task !== "string") {
			return malformed("child");
		}
		if (child.id !== undefined && typeof child.id !== "number") return malformed("child");
	}
	const checkOutput = o.checkOutput;
	if (
		checkOutput !== undefined &&
		(!Array.isArray(checkOutput) ||
			!checkOutput.every(
				(r) =>
					r !== null &&
					typeof r === "object" &&
					!Array.isArray(r) &&
					typeof r.command === "string" &&
					typeof r.exitCode === "number" &&
					typeof r.output === "string",
			))
	) {
		return malformed("checkOutput");
	}
	return {
		phase: phase as GroupPhase,
		queue: queue as string[],
		entries: o.entries as unknown as GroupEntry[],
		reworks: o.reworks,
		...(typeof o.carried === "string" ? { carried: o.carried } : {}),
		...(child !== undefined
			? { child: { task: (child as JsonObject).task as string, ...(typeof (child as JsonObject).id === "number" ? { id: (child as JsonObject).id as TaskId } : {}) } }
			: {}),
		...(checkOutput !== undefined ? { checkOutput: checkOutput as unknown as CheckRun[] } : {}),
	};
}

/** The checkpoint in the form `commit` and `initial` take. */
function stored(cp: GroupCheckpoint): StoredGroupCheckpoint {
	return encodeCheckpoint(cp) as StoredGroupCheckpoint;
}

/** The group loop's durable result: the ontology's outcome, and notes it has no field for. */
export interface GroupLoopResult extends JsonObject {
	outcome: LoopOutcome<GroupOutcome> & JsonObject;
	notes: string[];
}

/**
 * The task whose loop blocked the group, or `null` when none did (the judge blocked it).
 * A terminal task keeps no checkpoint, so this is read from the result: only a blocking
 * task's entry has status `blocked`, and the group ends at the first one.
 */
export function blockedBy(outcome: GroupLoopResult["outcome"]): string | null {
	if (outcome.status !== "blocked") return null;
	const result = outcome.result as unknown as GroupOutcome;
	return result.tasks.find((t) => t.outcome.status === "blocked")?.task ?? null;
}

/**
 * The first checkpoint: the unticked tasks queued in file order, and every ticked
 * task entered as converged with `runs` 0 (an earlier run converged it; no new loop).
 */
export function initialGroupCheckpoint(tasks: readonly { id: string; ticked: boolean }[]): GroupCheckpoint {
	return {
		phase: "next",
		queue: tasks.filter((t) => !t.ticked).map((t) => t.id),
		entries: tasks
			.filter((t) => t.ticked)
			.map((t) => ({
				task: t.id,
				outcome: { status: "converged", iterations: [], result: { task: t.id, ticked: true } },
				runs: 0,
			})),
		reworks: 0,
	};
}

const GroupLoopOutcome = LoopOutcome(GroupOutcome);

function notYet(phase: GroupPhase, task: string): never {
	throw new Error(`group-loop phase ${phase} not implemented yet (task ${task})`);
}

/**
 * The group's result: one entry per task in file order, `runs` 0 for a task ticked
 * before the group loop began. A task not yet reached has no entry.
 */
export function groupOutcome(
	input: Pick<GroupLoopInput, "group" | "tasks">,
	entries: readonly GroupEntry[],
	status: "converged" | "blocked" | "failed",
	escalation?: Escalation,
): LoopOutcome<GroupOutcome> & JsonObject {
	const tasks = input.tasks.flatMap((t) => {
		const entry = entries.find((e) => e.task === t.id);
		return entry !== undefined ? [{ task: entry.task, outcome: entry.outcome, runs: entry.runs }] : [];
	});
	const result = { group: input.group, tasks };
	return (
		status === "blocked"
			? { status, iterations: [], result, escalation: escalation as Escalation }
			: { status, iterations: [], result }
	) as unknown as LoopOutcome<GroupOutcome> & JsonObject;
}

/** The entry for `task` with `outcome` as its latest run: replaced in place, or appended; `runs` counted. */
export function recordEntry(entries: readonly GroupEntry[], task: string, outcome: GroupEntry["outcome"]): GroupEntry[] {
	const runs = (entries.find((e) => e.task === task)?.runs ?? 0) + 1;
	const entry: GroupEntry = { task, outcome, runs };
	return entries.some((e) => e.task === task) ? entries.map((e) => (e.task === task ? entry : e)) : [...entries, entry];
}

/** The task loop's input for `task`: the group's sources and options, and the rework text it carries. */
export function taskLoopInputFor(input: GroupLoopInput, task: string, carried: string): TaskLoopInput {
	return {
		task,
		taskText: input.tasks.find((t) => t.id === task)?.text ?? "",
		proposal: input.proposal,
		design: input.design,
		deltas: input.deltas,
		...(input.tasksPath !== undefined ? { tasksPath: input.tasksPath } : {}),
		script: input.script,
		workspace: input.workspace,
		budget: { maxIterations: input.budget.maxIterations },
		checks: input.checks,
		allow: input.allow,
		escalateTo: input.escalateTo,
		...(input.model !== undefined ? { model: input.model } : {}),
		...(input.delegateModel !== undefined ? { delegateModel: input.delegateModel } : {}),
		...(input.delegateContext !== undefined ? { delegateContext: input.delegateContext } : {}),
		...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
		carried,
		earlier: [],
	};
}

/** The terminal result for a task that did not converge, checked against the ontology. */
export function endedGroup(
	input: Pick<GroupLoopInput, "group" | "tasks">,
	entries: readonly GroupEntry[],
	task: string,
	outcome: GroupEntry["outcome"],
): GroupLoopResult {
	const done: GroupLoopResult =
		outcome.status === "blocked"
			? { outcome: groupOutcome(input, entries, "blocked", { ...outcome.escalation, level: "group" }), notes: [] }
			: { outcome: groupOutcome(input, entries, "failed"), notes: [`task ${task} ended ${outcome.status}`] };
	if (!check(GroupLoopOutcome, done.outcome)) {
		throw new Error(`the group loop built an outcome the ontology refuses: ${explain(GroupLoopOutcome, done.outcome).join("; ")}`);
	}
	return done;
}

/**
 * Run every check in order over the workspace, none skipped after a failure. Each command is
 * split into an argv and spawned with no shell. One that cannot start is a failure (127, the
 * spawn error as output); one that times out is a failure too (-1). Nothing here throws.
 */
export async function runGroupChecks(
	commands: readonly string[],
	workspace: string,
	signal?: AbortSignal,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CheckRun[]> {
	const runs: CheckRun[] = [];
	for (const command of commands) {
		const ran = await runArgv(splitCommand(command), { cwd: workspace, timeoutMs, signal });
		if (ran.kind === "exited") runs.push({ command, exitCode: ran.code, output: ran.output });
		else if (ran.kind === "timed-out") runs.push({ command, exitCode: -1, output: `${ran.output}\n(timed out after ${timeoutMs}ms)` });
		else runs.push({ command, exitCode: SPAWN_FAILED_EXIT_CODE, output: ran.message });
	}
	return runs;
}

/** The failing checks only, each as `$ <command>`, `exit <code>`, then its output. Empty when all passed. */
export function formatCheckOutput(runs: readonly CheckRun[]): string {
	return runs
		.filter((r) => r.exitCode !== 0)
		.map((r) => `$ ${r.command}\nexit ${r.exitCode}\n${r.output}`)
		.join("\n\n");
}

/** The terminal result when every check passed, checked against the ontology. */
export function convergedGroup(input: Pick<GroupLoopInput, "group" | "tasks">, entries: readonly GroupEntry[]): GroupLoopResult {
	const done: GroupLoopResult = { outcome: groupOutcome(input, entries, "converged"), notes: [] };
	if (!check(GroupLoopOutcome, done.outcome)) {
		throw new Error(`the group loop built an outcome the ontology refuses: ${explain(GroupLoopOutcome, done.outcome).join("; ")}`);
	}
	return done;
}

/** Pops the queue head into `task`, or goes to `check` when the queue is empty. No model request, no command. */
export function nextCheckpoint(cp: GroupCheckpoint): GroupCheckpoint {
	const { child: _child, ...kept } = cp;
	const [head, ...rest] = cp.queue;
	return head === undefined
		? { ...kept, phase: "check", queue: [] }
		: { ...kept, phase: "task", queue: rest, child: { task: head } };
}

export const GroupLoopTask: Task<GroupLoopInput, StoredGroupCheckpoint, GroupLoopResult, object> = defineTask<
	GroupLoopInput,
	StoredGroupCheckpoint,
	GroupLoopResult
>({
	name: GROUP_LOOP_NAME,
	version: GROUP_LOOP_VERSION,
	initial: (input) => stored(initialGroupCheckpoint(input.tasks)),
	phases: {
		next: async (task, runtime, context) => {
			const cp = decodeCheckpoint(task.state.checkpoint);
			await runtime.commit(() => ({ status: "running", checkpoint: stored(nextCheckpoint(cp)) }), context);
		},
		// Create the task loop for `child.task` and store its ID in one commit, so a crash leaves
		// both or neither; every later entry (a resume included) waits for the stored ID.
		task: async (task, runtime, context) => {
			const cp = decodeCheckpoint(task.state.checkpoint);
			const current = cp.child?.task;
			if (current === undefined) throw new Error("group-loop task phase has no current task");

			if (cp.child?.id === undefined) {
				await runtime.commit(async (tx) => {
					const id = await tx.createTask(TaskLoopTask, taskLoopInputFor(task.input, current, cp.carried ?? ""), {
						ownership: { kind: "task", taskId: runtime.taskId },
					});
					return {
						status: "waiting",
						checkpoint: stored({ ...cp, child: { task: current, id } }),
						on: [id],
						policy: "allSettled",
					};
				}, context);
				return;
			}

			const settled = await runtime.waitForTask(cp.child.id as TaskId<TaskLoopResult>, context);
			const ended = settled.state.outcome;
			const outcome: GroupEntry["outcome"] =
				ended.status === "completed"
					? ended.result.outcome
					: ({ status: "failed", iterations: [] } as GroupEntry["outcome"]);
			const entries = recordEntry(cp.entries, current, outcome);

			if (outcome.status === "converged") {
				const { child: _child, carried: _carried, ...kept } = cp;
				await runtime.commit(() => ({ status: "running", checkpoint: stored({ ...kept, phase: "next", entries }) }), context);
				return;
			}
			const done = endedGroup(task.input, entries, current, outcome);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
		},
		// Nothing is stored before the checks finish, so a process that dies here reruns them all.
		check: async (task, runtime, context) => {
			const cp = decodeCheckpoint(task.state.checkpoint);
			const runs = await runGroupChecks(task.input.checks, task.input.workspace);
			if (runs.every((r) => r.exitCode === 0)) {
				const done = convergedGroup(task.input, cp.entries);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
				return;
			}
			await runtime.commit(() => ({ status: "running", checkpoint: stored({ ...cp, phase: "judge", checkOutput: runs }) }), context);
		},
		judge: async () => notYet("judge", "2.3"),
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
	},
});

/** Brings the `agentscript.group-loop` task. Installed beside `taskLoopExtensions`, whose task loops are its children. */
export const GroupLoop: Extension = defineExtension({ name: GROUP_LOOP, tasks: [GroupLoopTask] });
