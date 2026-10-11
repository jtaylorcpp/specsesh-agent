/**
 * Loops (`openspec/loops`): one feedback-loop shape, used by the task loop, the
 * group loop and the change loop.
 *
 * Nothing here runs a loop. The schemas are the shapes a runner hands across a
 * boundary; the functions are the pure rules a runner applies between
 * iterations (which status a loop ends in, where feedback goes, what a level's
 * targets are).
 */

import { z } from "zod";
import { Evidence, Finding, Target, satisfies } from "./evidence.js";
import {
	type Change,
	type RequirementRef,
	ScenarioRef,
	type Task,
	TaskId,
	type TaskGroup,
	type TaskList,
	type Capability,
	deltaScenarios,
	formatRef,
	parseRef,
	unclaimedScenarios,
} from "./model.js";
import { Name, closed, literals, sameValue } from "./schema.js";

// ── Shapes ──────────────────────────────────────────────────────────────────

export const Budget = closed({ maxIterations: z.int().min(1), maxWallMs: z.int().min(1).optional() });
export type Budget = z.infer<typeof Budget>;

/** For a spec item, `ref` is the serialised reference of that kind. */
export const ContextRef = closed({
	kind: literals("file", "capability", "requirement", "scenario", "change", "doc"),
	ref: Name(),
}).superRefine((context, ctx) => {
	if (context.kind !== "capability" && context.kind !== "requirement" && context.kind !== "scenario") return;
	const ref = parseRef(context.ref);
	const matches =
		ref !== undefined &&
		(context.kind === "capability" ? Array.isArray(ref) : !Array.isArray(ref) && ("scenario" in ref) === (context.kind === "scenario"));
	if (!matches) ctx.addIssue({ code: "custom", message: `"${context.ref}" is not a serialised ${context.kind} reference` });
});
export type ContextRef = z.infer<typeof ContextRef>;

export const Action = closed({ kind: literals("edit", "command", "delegate"), summary: z.string(), refs: z.array(z.string()) });
export type Action = z.infer<typeof Action>;

const Unmet = closed({ target: Target, reason: z.string() });

/** `met` is true exactly when `unmet` is empty. */
export const Verdict = z.union([
	closed({ met: z.literal(true), satisfied: z.array(Target), unmet: z.array(Unmet).max(0) }),
	closed({ met: z.literal(false), satisfied: z.array(Target), unmet: z.array(Unmet).min(1) }),
]);
export type Verdict = z.infer<typeof Verdict>;

export const FeedbackAction = literals("retry", "rework-task", "add-task", "amend-spec", "ask");
export type FeedbackAction = z.infer<typeof FeedbackAction>;

export const Feedback = closed({ from: Finding, action: FeedbackAction });
export type Feedback = z.infer<typeof Feedback>;

export const Recipient = literals("principal", "agent");
export type Recipient = z.infer<typeof Recipient>;

export const LoopLevel = literals("task", "group", "change");
export type LoopLevel = z.infer<typeof LoopLevel>;

export const Escalation = closed({ level: LoopLevel, to: Recipient, reason: z.string(), question: Name() });
export type Escalation = z.infer<typeof Escalation>;

/** Only the escalation's named recipient may answer it. */
export const EscalationAnswer = closed({
	escalation: Escalation,
	by: Recipient,
	decision: z.string(),
	feedback: z.array(Feedback),
}).superRefine((answer, ctx) => {
	if (answer.by !== answer.escalation.to) {
		ctx.addIssue({ code: "custom", message: `the escalation goes to the ${answer.escalation.to}, not the ${answer.by}` });
	}
});
export type EscalationAnswer = z.infer<typeof EscalationAnswer>;

/** Every unmet target of the verdict has at least one feedback item whose finding names it. */
export const Iteration = closed({
	n: z.int().min(1),
	plan: z.string(),
	actions: z.array(Action),
	evidence: z.array(Evidence),
	verdict: Verdict,
	feedback: z.array(Feedback),
}).superRefine((iteration, ctx) => {
	if (!iteration.verdict.unmet.every(({ target }) => iteration.feedback.some((item) => sameValue(item.from.target, target)))) {
		ctx.addIssue({ code: "custom", message: "an unmet target has no feedback" });
	}
});
export type Iteration = z.infer<typeof Iteration>;

export const LoopInput = <Goal extends z.ZodType>(goal: Goal) =>
	closed({ goal, context: z.array(ContextRef), budget: Budget, carried: z.array(Feedback) });
export type LoopInput<Goal> = z.infer<ReturnType<typeof LoopInput<z.ZodType<Goal>>>>;

/**
 * How a loop ended. `result` is present when it converged; `escalation` exactly
 * when it is blocked. Iterations are numbered from 1, one apart.
 */
export const LoopOutcome = <Out extends z.ZodType>(out: Out) =>
	z
		.union([
			closed({ status: z.literal("converged"), iterations: z.array(Iteration), result: out }),
			closed({ status: z.literal("blocked"), iterations: z.array(Iteration), result: out.optional(), escalation: Escalation }),
			closed({ status: literals("exhausted", "failed"), iterations: z.array(Iteration), result: out.optional() }),
		])
		.superRefine((outcome, ctx) => {
			if (!outcome.iterations.every((iteration, i) => iteration.n === i + 1)) {
				ctx.addIssue({ code: "custom", message: "iterations are not numbered 1, 2, 3, …" });
			}
		});
export type LoopOutcome<Out> = z.infer<ReturnType<typeof LoopOutcome<z.ZodType<Out>>>>;

/** One run of a loop: what it was given and how it ended. The iterations are the outcome's. */
export const Loop = <Goal extends z.ZodType, Out extends z.ZodType>(goal: Goal, out: Out) =>
	closed({ input: LoopInput(goal), output: LoopOutcome(out) });
export type Loop<Goal, Out> = z.infer<ReturnType<typeof Loop<z.ZodType<Goal>, z.ZodType<Out>>>>;

export const LoopStatus = literals("converged", "blocked", "exhausted", "failed");
export type LoopStatus = z.infer<typeof LoopStatus>;

export const TaskOutcome = closed({ task: TaskId, ticked: z.boolean() });
export type TaskOutcome = z.infer<typeof TaskOutcome>;

/** One entry per task (its latest run), each id within the group. */
export const GroupOutcome = closed({
	group: z.int().min(1),
	tasks: z.array(closed({ task: TaskId, outcome: LoopOutcome(TaskOutcome), runs: z.int().min(1) })),
}).superRefine((outcome, ctx) => {
	const within = outcome.tasks.every((entry) => entry.task.startsWith(`${outcome.group}.`));
	if (!within || new Set(outcome.tasks.map((entry) => entry.task)).size !== outcome.tasks.length) {
		ctx.addIssue({ code: "custom", message: "a task is listed twice, or outside its group" });
	}
});
export type GroupOutcome = z.infer<typeof GroupOutcome>;

/** One entry per group, in ascending order; `unclaimed` is what no task claimed when execution started. */
export const ChangeOutcome = closed({
	groups: z.array(closed({ group: z.int().min(1), outcome: LoopOutcome(GroupOutcome), runs: z.int().min(1) })),
	unclaimed: z.array(ScenarioRef),
}).superRefine((outcome, ctx) => {
	if (!outcome.groups.every((entry, i) => i === 0 || entry.group > outcome.groups[i - 1]!.group)) {
		ctx.addIssue({ code: "custom", message: "group entries are not unique and ascending" });
	}
});
export type ChangeOutcome = z.infer<typeof ChangeOutcome>;

// ── Rules ───────────────────────────────────────────────────────────────────

/** The action a finding calls for: a spec defect amends the spec, a needed decision asks, anything else retries. */
export function feedbackFor(finding: Finding): Feedback {
	const action = finding.kind === "spec-defect" ? "amend-spec" : finding.kind === "needs-decision" ? "ask" : "retry";
	return { from: finding, action };
}

const stops = (item: Feedback) => item.action === "ask" || item.action === "amend-spec";

/**
 * The status the loop ends in after `iterations`, or `undefined` while it should
 * go on: `failed` on an error it cannot act on; `converged` when the last
 * verdict is met; `blocked` when the last iteration's feedback asks or amends
 * the spec; `exhausted` when the budget's iterations have all run.
 */
export function outcomeStatus(iterations: readonly Iteration[], budget: Budget, error?: unknown): LoopStatus | undefined {
	if (error !== undefined) return "failed";
	const last = iterations.at(-1);
	if (last === undefined) return undefined;
	if (last.verdict.met) return "converged";
	if (last.feedback.some(stops)) return "blocked";
	if (iterations.length >= budget.maxIterations) return "exhausted";
	return undefined;
}

/**
 * The outcome a loop ends with, or `undefined` while it should go on. A blocked
 * loop's escalation is built from the first feedback that asks or amends, at
 * `level`, to `to` (the principal unless said otherwise), its question the
 * finding's message.
 */
export function concludeLoop<Out>(options: {
	level: LoopLevel;
	iterations: readonly Iteration[];
	budget: Budget;
	result?: Out;
	error?: unknown;
	to?: Recipient;
}): LoopOutcome<Out> | undefined {
	const { level, budget, result, error, to = "principal" } = options;
	const iterations = [...options.iterations];
	const status = outcomeStatus(iterations, budget, error);
	const withResult = result === undefined ? {} : { result };
	switch (status) {
		case undefined:
			return undefined;
		case "converged":
			if (result === undefined) throw new Error("a converged loop needs its result");
			return { status, iterations, result };
		case "blocked": {
			const stop = iterations.at(-1)!.feedback.find(stops)!;
			const escalation: Escalation = {
				level,
				to,
				reason: `${stop.from.kind}: ${stop.action}`,
				question: stop.from.message || `How should the ${level} loop proceed on this ${stop.from.kind}?`,
			};
			return { status, iterations, ...withResult, escalation };
		}
		default:
			return { status, iterations, ...withResult };
	}
}

/** What the next iteration of the same loop receives: the `retry` feedback. */
export const carriedInto = (iteration: Iteration): Feedback[] => iteration.feedback.filter((item) => item.action === "retry");

/**
 * What a finished loop hands its enclosing loop: nothing unless it ended
 * `exhausted` or `blocked`, and never `retry`, which stays inside the loop.
 */
export function handedUp<Out>(outcome: LoopOutcome<Out>): Feedback[] {
	if (outcome.status !== "exhausted" && outcome.status !== "blocked") return [];
	return (outcome.iterations.at(-1)?.feedback ?? []).filter((item) => item.action !== "retry");
}

/**
 * The input of a blocked loop's next run: the same goal, with the answer's
 * feedback added to `carried`. Refuses an answer from anyone but the
 * escalation's recipient. The earlier run's outcome is not touched.
 */
export function resume<Goal>(
	input: LoopInput<Goal>,
	answer: EscalationAnswer,
): { ok: true; value: LoopInput<Goal> } | { ok: false; reason: string } {
	if (answer.by !== answer.escalation.to) {
		return { ok: false, reason: `the escalation goes to the ${answer.escalation.to}, not the ${answer.by}` };
	}
	return { ok: true, value: { ...input, carried: [...input.carried, ...answer.feedback] } };
}

const dedupe = (targets: readonly Target[]): Target[] =>
	targets.filter((target, i) => targets.findIndex((other) => sameValue(other, target)) === i);

/** The task loop's targets: exactly what the task links to. */
export const taskTargets = (task: Task): Target[] => dedupe(task.links.map((link) => link.target));

/** The group loop's targets: everything its tasks link to, plus what earlier groups converged on. */
export const groupTargets = (group: TaskGroup, earlier: readonly Target[] = []): Target[] =>
	dedupe([...group.tasks.flatMap(taskTargets), ...earlier]);

/** The change check's two named checks. */
export const STRICT_VALIDATION: Target = { check: "strict validation" };
export const FULL_SUITE: Target = { check: "full suite" };

/** The change loop's targets: every delta scenario (claimed or not), strict validation and the full suite. */
export const changeTargets = (change: Change): Target[] => dedupe([...deltaScenarios(change), STRICT_VALIDATION, FULL_SUITE]);

/** The scenario names of a requirement among `capabilities`, for `satisfies`. */
export const scenariosIn =
	(capabilities: readonly Capability[]) =>
	(ref: RequirementRef): string[] | undefined =>
		capabilities
			.find((capability) => sameValue(capability.path, ref.capability))
			?.requirements.find((requirement) => requirement.name === ref.requirement)
			?.scenarios.map((scenario) => scenario.name);

/** True when a context reference to a spec item resolves among `capabilities`; other kinds are not spec items. */
export function resolves(context: ContextRef, capabilities: readonly Capability[]): boolean {
	if (context.kind !== "capability" && context.kind !== "requirement" && context.kind !== "scenario") return true;
	const ref = parseRef(context.ref);
	if (ref === undefined) return false;
	if (Array.isArray(ref)) return capabilities.some((capability) => sameValue(capability.path, ref));
	const scenarios = scenariosIn(capabilities)(ref);
	return scenarios !== undefined && (!("scenario" in ref) || scenarios.includes(ref.scenario));
}

/** Judges `targets` from `evidence` alone. */
export function judge(
	targets: readonly Target[],
	evidence: readonly Evidence[],
	scenariosOf?: (ref: RequirementRef) => readonly string[] | undefined,
): Verdict {
	const satisfied = targets.filter((target) => satisfies(target, evidence, scenariosOf));
	const unmet = targets
		.filter((target) => !satisfied.includes(target))
		.map((target) => ({ target, reason: `no evidence satisfies ${"check" in target ? target.check : formatRef(target)}` }));
	return unmet.length === 0 ? { met: true, satisfied, unmet: [] } : { met: false, satisfied, unmet };
}

/**
 * A group or change check's feedback for its unmet targets: `rework-task` when a
 * task links to the target (its evidence regressed), `add-task` when none does.
 * `evidence` is what the check ran on, and must not be empty.
 */
export function checkFeedback(tasks: readonly Task[], verdict: Verdict, evidence: readonly Evidence[]): Feedback[] {
	if (evidence.length === 0) throw new Error("a check's feedback rests on evidence");
	return verdict.unmet.map(({ target, reason }) => {
		const linked = tasks.some((task) => taskTargets(task).some((t) => sameValue(t, target)));
		return {
			from: { kind: "code-defect", target, evidence: [...evidence], message: reason },
			action: linked ? "rework-task" : "add-task",
		};
	});
}

/** A group outcome with `outcome` as the task's latest run: one entry per task, its `runs` counted. */
export function recordTaskRun(group: GroupOutcome, task: TaskId, outcome: LoopOutcome<TaskOutcome>): GroupOutcome {
	const existing = group.tasks.find((entry) => entry.task === task);
	const entry = { task, outcome, runs: (existing?.runs ?? 0) + 1 };
	const tasks = existing ? group.tasks.map((e) => (e.task === task ? entry : e)) : [...group.tasks, entry];
	return { ...group, tasks };
}

/** A change outcome before any group has run: `unclaimed` fixed from the change as execution starts. */
export const startChangeOutcome = (change: Change): ChangeOutcome => ({ groups: [], unclaimed: unclaimedScenarios(change) });

const setDone = (list: TaskList, id: TaskId, done: boolean): TaskList => ({
	groups: list.groups.map((group) => ({
		...group,
		tasks: group.tasks.map((task) => (task.id === id ? { ...task, done } : task)),
	})),
});

/** Ticks the task only when its loop converged; anything else leaves the list as it was. */
export function tick(list: TaskList, outcome: LoopOutcome<TaskOutcome>): TaskList {
	if (outcome.status !== "converged" || !outcome.result.ticked) return list;
	return setDone(list, outcome.result.task, true);
}

/** `rework-task`: the task is unticked until its loop converges again. */
export const untick = (list: TaskList, id: TaskId): TaskList => setDone(list, id, false);
