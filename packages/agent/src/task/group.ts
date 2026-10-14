/**
 * Starting a group loop, the part that needs no harness: the group's options, every
 * source read once into the durable input, and the group found in tasks.md.
 * A refusal creates nothing and calls no model.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	defineExtension,
	defineTask,
	type Extension,
	type JsonObject,
	type ModelRef,
	type Task,
	type TaskDefinition,
	type TaskId,
} from "@earendil-works/pi-durable";
import {
	GroupOutcome,
	LoopOutcome,
	check,
	explain,
	feedbackFor,
	type Action,
	type Escalation,
	type Feedback,
	type Finding,
	type FindingKind,
	type Iteration,
	type Recipient,
	type Target,
	type TaskOutcome,
} from "../openspec/index.js";
import { AgentScriptRun, type DelegateGrants, type RunInput, type Workspace } from "../durable/index.js";
import type { RunResult } from "../interpreter/index.js";
import { checkEvidence, runLoopChecks, type CheckRun } from "./checks.js";
import { amendPathChoices } from "./contract.js";
import { concatDeltas } from "./deltas.js";
import { TaskLoopStartError } from "./errors.js";
import { GROUP_NEXT_ACTIONS, readGroupVerdict, seedGroupJudge, type GroupVerdict } from "./group-judge.js";
import type { TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { TaskLoopTask, loopWorkspace, subagentsOf } from "./loop.js";
import {
	BUNDLED_SCRIPTS,
	DEFAULT_ESCALATE_TO,
	DEFAULT_MAX_ITERATIONS,
	type LoopWorktree,
	type Source,
	type TaskLoopOptions,
} from "./options.js";
import { readChange, readScript, readSource } from "./sources.js";
import { delegatesOf } from "./start.js";
import { untick } from "./tick.js";

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
	/** Absolute; set only when the change came from a directory, which an applied amendment re-reads the deltas from. */
	readonly changeDir?: string;
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
	readonly delegates?: DelegateGrants;
	readonly worktree?: LoopWorktree;
	/** Set only on a run that answers a blocked group loop: the encoded checkpoint it starts from, and the loop it answers. */
	readonly resume?: { readonly checkpoint: JsonObject; readonly answers: number };
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
		...("dir" in options.change ? { changeDir: resolve(options.change.dir) } : {}),
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
		...delegatesOf(options),
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
	/** One ontology `Iteration` per finished check round, appended in the commit that ends the round. */
	iterations: Iteration[];
	carried?: string;
	child?: { task: string; id?: TaskId };
	/** Every check's result, set by the `check` phase when it hands a failure to the judge. */
	checkOutput?: CheckRun[];
	/** An answered judge escalation's decision, kept from `check` to `judge`, where it is appended to `check_output`. */
	decision?: string;
};

/** The checkpoint as pi-durable stores it: JSON, narrowed per phase so each handler's task type is not `never`. */
export type StoredGroupCheckpoint = { [P in GroupPhase]: JsonObject & { phase: P } }[GroupPhase];

/** Copy only the fields that are present; `undefined` is never written. */
export function encodeCheckpoint(cp: GroupCheckpoint): JsonObject {
	return {
		phase: cp.phase,
		queue: [...cp.queue],
		entries: cp.entries,
		reworks: cp.reworks,
		iterations: cp.iterations as unknown as JsonValue,
		...(cp.carried !== undefined ? { carried: cp.carried } : {}),
		...(cp.child !== undefined
			? { child: { task: cp.child.task, ...(cp.child.id !== undefined ? { id: cp.child.id } : {}) } }
			: {}),
		...(cp.checkOutput !== undefined
			? { checkOutput: cp.checkOutput.map((r) => ({ command: r.command, exitCode: r.exitCode, output: r.output })) }
			: {}),
		...(cp.decision !== undefined ? { decision: cp.decision } : {}),
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
	if (o.iterations !== undefined && !Array.isArray(o.iterations)) return malformed("iterations");
	if (o.carried !== undefined && typeof o.carried !== "string") return malformed("carried");
	if (o.decision !== undefined && typeof o.decision !== "string") return malformed("decision");
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
		iterations: (o.iterations ?? []) as unknown as Iteration[],
		...(typeof o.carried === "string" ? { carried: o.carried } : {}),
		...(child !== undefined
			? { child: { task: (child as JsonObject).task as string, ...(typeof (child as JsonObject).id === "number" ? { id: (child as JsonObject).id as TaskId } : {}) } }
			: {}),
		...(checkOutput !== undefined ? { checkOutput: checkOutput as unknown as CheckRun[] } : {}),
		...(typeof o.decision === "string" ? { decision: o.decision } : {}),
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
		iterations: [],
	};
}

const GroupLoopOutcome = LoopOutcome(GroupOutcome);

type GroupStatus = "converged" | "blocked" | "exhausted" | "failed";

/**
 * The group's outcome: the checkpoint's iterations, and one entry per task that was ticked or ran,
 * in the group's file order (not insertion order), `runs` 0 for a task ticked before the group loop
 * began. A task not yet reached has no entry.
 */
export function buildGroupOutcome(
	status: GroupStatus,
	checkpoint: Pick<GroupCheckpoint, "entries" | "iterations">,
	extra: { input: Pick<GroupLoopInput, "group" | "tasks">; escalation?: Escalation },
): LoopOutcome<GroupOutcome> & JsonObject {
	const tasks = extra.input.tasks.flatMap((t) => {
		const entry = checkpoint.entries.find((e) => e.task === t.id);
		return entry !== undefined ? [{ task: entry.task, outcome: entry.outcome, runs: entry.runs }] : [];
	});
	const result = { group: extra.input.group, tasks };
	const iterations = checkpoint.iterations;
	return (
		status === "blocked"
			? { status, iterations, result, escalation: extra.escalation as Escalation }
			: { status, iterations, result }
	) as unknown as LoopOutcome<GroupOutcome> & JsonObject;
}

/**
 * The terminal result, checked against the ontology before it is stored. An outcome the ontology
 * refuses is replaced by a `failed` one noting it; if that is refused too, this throws so the
 * durable task records the error.
 */
export function finishGroup(
	status: GroupStatus,
	checkpoint: Pick<GroupCheckpoint, "entries" | "iterations">,
	extra: { input: Pick<GroupLoopInput, "group" | "tasks">; escalation?: Escalation; notes?: string[] },
): GroupLoopResult {
	const notes = extra.notes ?? [];
	const done: GroupLoopResult = { outcome: buildGroupOutcome(status, checkpoint, extra), notes };
	if (check(GroupLoopOutcome, done.outcome)) return done;
	const reason = explain(GroupLoopOutcome, done.outcome).join("; ");
	const failed: GroupLoopResult = {
		outcome: buildGroupOutcome("failed", checkpoint, { input: extra.input }),
		notes: [...notes, `the group's ${status} outcome broke the ontology: ${reason}`],
	};
	if (!check(GroupLoopOutcome, failed.outcome)) {
		throw new Error(`the group loop built an outcome the ontology refuses: ${explain(GroupLoopOutcome, failed.outcome).join("; ")}`);
	}
	return failed;
}

/** The one target every group check round judges. */
export const roundTarget = (groupNumber: number): Target => ({ check: `group ${groupNumber}` });

/**
 * Round `round` of group `groupNumber`'s check as an ontology `Iteration`: no actions, one `CheckEvidence`
 * per check, and a verdict on `{ check: "group <groupNumber>" }` (the same target every round), met only
 * when every check exits 0. An unmet round has one
 * finding and its feedback, chosen by the judge's verdict: `rework` is a `code-defect` / `rework-task`
 * (the message names the task), `ask` a `needs-decision` / `ask`, `amend-spec` a `spec-defect` /
 * `amend-spec`. With no verdict, or one outside the contract, the finding is an `environment` one.
 */
export function roundIteration(args: {
	readonly groupNumber: number;
	readonly round: number;
	readonly checks: readonly CheckRun[];
	readonly verdict?: GroupVerdict;
}): Iteration {
	const { groupNumber, round, checks: checkResults, verdict } = args;
	const evidence = checkEvidence(checkResults);
	const target = roundTarget(groupNumber);
	const base = { n: round, plan: "", actions: [] as Action[], evidence };
	if (checkResults.every((r) => r.exitCode === 0)) {
		return { ...base, verdict: { met: true, satisfied: [target], unmet: [] }, feedback: [] };
	}
	const failing = formatCheckOutput(checkResults);
	const reason = `group check failed:\n${failing}`;
	const finding = (kind: FindingKind, message: string): Finding => ({ kind, target, evidence, message });
	let feedback: Feedback;
	switch (verdict?.kind) {
		case "rework":
			feedback = { from: finding("code-defect", `rework ${verdict.task}: ${verdict.feedback}`), action: "rework-task" };
			break;
		case "ask":
		case "amend-spec":
			feedback = feedbackFor(
				finding(verdict.kind === "ask" ? "needs-decision" : "spec-defect", verdict.question.trim() || (failing.split("\n")[0] ?? reason)),
			);
			break;
		case "contract-broken":
			feedback = feedbackFor(finding("environment", `the group script broke its contract: ${verdict.reason}`));
			break;
		default:
			feedback = feedbackFor(finding("environment", reason));
	}
	return { ...base, verdict: { met: false, satisfied: [], unmet: [{ target, reason }] }, feedback: [feedback] };
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
		...(input.delegates !== undefined ? { delegates: input.delegates } : {}),
		...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
		carried,
		earlier: [],
	};
}

/** The terminal result for a task that did not converge, checked against the ontology. */
export function endedGroup(
	input: Pick<GroupLoopInput, "group" | "tasks">,
	cp: Pick<GroupCheckpoint, "entries" | "iterations">,
	task: string,
	outcome: GroupEntry["outcome"],
): GroupLoopResult {
	return outcome.status === "blocked"
		? finishGroup("blocked", cp, { input, escalation: { ...outcome.escalation, level: "group" } })
		: finishGroup("failed", cp, { input, notes: [`task ${task} ended ${outcome.status}`] });
}

/** The failing checks only, each as `$ <command>`, `exit <code>`, then its output. Empty when all passed. */
export function formatCheckOutput(runs: readonly CheckRun[]): string {
	return runs
		.filter((r) => r.exitCode !== 0)
		.map((r) => `$ ${r.command}\nexit ${r.exitCode}\n${r.output}`)
		.join("\n\n");
}

/** The terminal result when every check passed: the checkpoint's iterations plus the met round. */
export function convergedGroup(
	input: Pick<GroupLoopInput, "group" | "tasks">,
	cp: Pick<GroupCheckpoint, "entries" | "iterations">,
	runs: readonly CheckRun[],
): GroupLoopResult {
	const iterations = [...cp.iterations, roundIteration({ groupNumber: input.group, round: cp.iterations.length + 1, checks: runs })];
	return finishGroup("converged", { entries: cp.entries, iterations }, { input });
}

/** What the judge phase does with a verdict: go round again with this checkpoint, or end. */
export type JudgeDecision =
	| { readonly kind: "rework"; readonly task: string; readonly checkpoint: GroupCheckpoint }
	| { readonly kind: "end"; readonly done: GroupLoopResult };

/** The checkpoint with this round's iteration, built from the check results the `judge` checkpoint kept. */
function withRound(input: Pick<GroupLoopInput, "group">, cp: GroupCheckpoint, verdict?: GroupVerdict): GroupCheckpoint {
	const round = cp.iterations.length + 1;
	return {
		...cp,
		iterations: [...cp.iterations, roundIteration({ groupNumber: input.group, round, checks: cp.checkOutput ?? [], verdict })],
	};
}

/** The group ends `status` with the round recorded; used by the judge phase for every ending. */
export function endedRound(
	input: GroupLoopInput,
	cp: GroupCheckpoint,
	status: "blocked" | "exhausted" | "failed",
	notes: string[],
	verdict?: GroupVerdict,
	escalation?: Escalation,
): GroupLoopResult {
	return finishGroup(status, withRound(input, cp, verdict), { input, notes, ...(escalation !== undefined ? { escalation } : {}) });
}

/**
 * The judge phase's mapping, pure. A verdict outside the contract fails the group before
 * the rework budget is looked at; `entries` are kept as they are on every ending but a rework.
 * Every ending, and a rework, appends the round's `Iteration` with its finding and feedback.
 */
export function decideJudge(verdict: GroupVerdict, cp: GroupCheckpoint, input: GroupLoopInput): JudgeDecision {
	const checkOutput = formatCheckOutput(cp.checkOutput ?? []);
	switch (verdict.kind) {
		case "contract-broken":
			return {
				kind: "end",
				done: endedRound(input, cp, "failed", [`the group script broke its contract: ${verdict.reason}`], verdict),
			};
		case "ask":
		case "amend-spec": {
			const escalation: Escalation = {
				level: "group",
				to: input.escalateTo,
				reason: verdict.kind === "amend-spec" ? "spec-defect: amend-spec" : "needs-decision: ask",
				question: verdict.question.trim() || (checkOutput.split("\n")[0] ?? "") || `How should group ${input.group} proceed?`,
				// Only `amend-spec` carries an amendment; without one, the key is absent, not undefined.
				...(verdict.kind === "amend-spec" && verdict.amendment !== undefined ? { amendment: verdict.amendment } : {}),
			};
			const notes = verdict.kind === "amend-spec" && verdict.amendmentNote !== undefined ? [verdict.amendmentNote] : [];
			return { kind: "end", done: endedRound(input, cp, "blocked", notes, verdict, escalation) };
		}
		case "rework": {
			if (cp.reworks >= input.budget.maxReworks) {
				return {
					kind: "end",
					done: endedRound(input, cp, "exhausted", [`group ${input.group} used its ${input.budget.maxReworks} reworks`], verdict),
				};
			}
			const { child: _child, checkOutput: _checkOutput, decision: _decision, ...kept } = withRound(input, cp, verdict);
			const checkpoint: GroupCheckpoint = {
				...kept,
				phase: "next",
				queue: [...cp.queue, verdict.task],
				reworks: cp.reworks + 1,
				carried: `${checkOutput}\n\n${verdict.feedback}`,
			};
			return { kind: "rework", task: verdict.task, checkpoint };
		}
	}
}

/** The judge's seed: the group, each task's last status, and every check's result. */
function judgeSeed(cp: GroupCheckpoint, input: GroupLoopInput) {
	const seed = seedGroupJudge({
		group: input.group,
		title: input.groupTitle,
		tasks: input.tasks.map((t) => ({
			id: t.id,
			text: t.text,
			status: cp.entries.find((e) => e.task === t.id)?.outcome.status ?? "pending",
		})),
		proposal: input.proposal,
		deltas: input.deltas,
		checks: cp.checkOutput ?? [],
		reworks: cp.reworks,
	});
	return cp.decision === undefined
		? seed
		: { ...seed, check_output: `${seed.check_output}\n\nAnswer to the escalation: ${cp.decision}` };
}

/** Pops the queue head into `task`, or goes to `check` when the queue is empty. No model request, no command. */
export function nextCheckpoint(cp: GroupCheckpoint): GroupCheckpoint {
	const { child: _child, ...kept } = cp;
	const [head, ...rest] = cp.queue;
	return head === undefined
		? { ...kept, phase: "check", queue: [] }
		: { ...kept, phase: "task", queue: rest, child: { task: head } };
}

type GroupPhases = TaskDefinition<GroupLoopInput, StoredGroupCheckpoint, GroupLoopResult, object>["phases"];

/**
 * The check phase over `loopWorkspace(input, bound)`. Nothing is stored before the checks
 * finish, so a process that dies here reruns them all.
 */
function checkPhase(bound?: Workspace): GroupPhases["check"] {
	return async (task, runtime, context) => {
		const cp = decodeCheckpoint(task.state.checkpoint);
		const runs = await runLoopChecks(loopWorkspace(task.input, bound), task.input.checks);
		if (runs.every((r) => r.exitCode === 0)) {
			const done = convergedGroup(task.input, cp, runs);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
			return;
		}
		await runtime.commit(() => ({ status: "running", checkpoint: stored({ ...cp, phase: "judge", checkOutput: runs }) }), context);
	};
}

/** The group loop task with no bound workspace: its check runs in the input's directory. */
export const GroupLoopTask: Task<GroupLoopInput, StoredGroupCheckpoint, GroupLoopResult, object> = defineTask<
	GroupLoopInput,
	StoredGroupCheckpoint,
	GroupLoopResult
>({
	name: GROUP_LOOP_NAME,
	version: GROUP_LOOP_VERSION,
	initial: (input) =>
		input.resume !== undefined ? stored(decodeCheckpoint(input.resume.checkpoint)) : stored(initialGroupCheckpoint(input.tasks)),
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
			const done = endedGroup(task.input, { entries, iterations: cp.iterations }, current, outcome);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
		},
		check: checkPhase(),
		// Like `task`: the judge's run is created and its id stored in one commit; a later entry
		// waits for that id, reads the four variables back and decides.
		judge: async (task, runtime, context) => {
			const cp = decodeCheckpoint(task.state.checkpoint);
			const input = task.input;

			if (cp.child?.id === undefined) {
				const runTask = runtime.registry.task(AgentScriptRun.definition.name) as typeof AgentScriptRun | undefined;
				if (runTask === undefined) {
					throw new Error(`${GROUP_LOOP_NAME} needs ${AgentScriptRun.definition.name} installed: install groupLoopExtensions(...)`);
				}
				const runInput: RunInput = {
					source: input.groupScript,
					options: {
						entry: subagentsOf(input.groupScript),
						variables: judgeSeed(cp, input),
						choices: { next_action: [...GROUP_NEXT_ACTIONS], amend_path: amendPathChoices(input.deltas) },
					},
					...(input.model !== undefined ? { model: input.model } : {}),
				};
				await runtime.commit(async (tx) => {
					const id = await tx.createTask(runTask, runInput, { ownership: { kind: "task", taskId: runtime.taskId } });
					return { status: "waiting", checkpoint: stored({ ...cp, child: { task: "judge", id } }), on: [id], policy: "allSettled" };
				}, context);
				return;
			}

			const settled = await runtime.waitForTask(cp.child.id as TaskId<RunResult>, context);
			const ended = settled.state.outcome;
			const ids = input.tasks.map((t) => t.id);
			if (ended.status !== "completed" || ended.result.kind !== "completed") {
				const how = ended.status === "completed" ? ended.result.kind : ended.status;
				const done = endedRound(input, cp, "failed", [`the group judge's run ended ${how}`]);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
				return;
			}
			const decision = decideJudge(readGroupVerdict(ended.result.variables, ids), cp, input);
			if (decision.kind === "end") {
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: decision.done } }), context);
				return;
			}
			untick(input.tasksPath, decision.task);
			await runtime.commit(() => ({ status: "running", checkpoint: stored(decision.checkpoint) }), context);
		},
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
	},
});

/** Brings the `agentscript.group-loop` task. Installed beside `taskLoopExtensions`, whose task loops are its children. */
export const GroupLoop: Extension = defineExtension({ name: GROUP_LOOP, tasks: [GroupLoopTask] });

/** `GroupLoop` with its check bound to `workspace`. pi-durable runs a task's phases from the installed definition. */
export function boundGroupLoop(workspace: Workspace): Extension {
	const definition = GroupLoopTask.definition;
	const task = defineTask<GroupLoopInput, StoredGroupCheckpoint, GroupLoopResult>({
		...definition,
		phases: { ...definition.phases, check: checkPhase(workspace) },
	});
	return defineExtension({ name: GROUP_LOOP, tasks: [task] });
}
