/**
 * Loops (`openspec/loops`): one feedback-loop shape, used by the task loop, the
 * group loop and the change loop.
 *
 * Nothing here runs a loop. The schemas are the shapes a runner hands across a
 * boundary; the functions are the pure rules a runner applies between
 * iterations (which status a loop ends in, where feedback goes, what a level's
 * targets are).
 */

import Type, { type Static, type TSchema, type TUnsafe } from "typebox";
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

export const Budget = closed({ maxIterations: Type.Integer({ minimum: 1 }), maxWallMs: Type.Optional(Type.Integer({ minimum: 1 })) });
export type Budget = Static<typeof Budget>;

/** For a spec item, `ref` is the serialised reference of that kind. */
export const ContextRef = Type.Refine(
	closed({ kind: literals("file", "capability", "requirement", "scenario", "change", "doc"), ref: Name() }),
	(context) => {
		if (context.kind !== "capability" && context.kind !== "requirement" && context.kind !== "scenario") return true;
		const ref = parseRef(context.ref);
		if (ref === undefined) return false;
		if (context.kind === "capability") return Array.isArray(ref);
		return !Array.isArray(ref) && ("scenario" in ref) === (context.kind === "scenario");
	},
	(context) => `"${context.ref}" is not a serialised ${context.kind} reference`,
);
export type ContextRef = Static<typeof ContextRef>;

export const Action = closed({
	kind: Type.Union([Type.Literal("edit"), Type.Literal("command"), Type.Literal("delegate")]),
	summary: Type.String(),
	refs: Type.Array(Type.String()),
});
export type Action = Static<typeof Action>;

/** `met` is true exactly when `unmet` is empty. */
export const Verdict = Type.Union([
	closed({
		met: Type.Literal(true),
		satisfied: Type.Array(Target),
		unmet: Type.Array(closed({ target: Target, reason: Type.String() }), { maxItems: 0 }),
	}),
	closed({
		met: Type.Literal(false),
		satisfied: Type.Array(Target),
		unmet: Type.Array(closed({ target: Target, reason: Type.String() }), { minItems: 1 }),
	}),
]);
export type Verdict = Static<typeof Verdict>;

export const FeedbackAction = Type.Union([
	Type.Literal("retry"),
	Type.Literal("rework-task"),
	Type.Literal("add-task"),
	Type.Literal("amend-spec"),
	Type.Literal("ask"),
]);
export type FeedbackAction = Static<typeof FeedbackAction>;

export const Feedback = closed({ from: Finding, action: FeedbackAction });
export type Feedback = Static<typeof Feedback>;

export const Recipient = Type.Union([Type.Literal("principal"), Type.Literal("agent")]);
export type Recipient = Static<typeof Recipient>;

export const LoopLevel = Type.Union([Type.Literal("task"), Type.Literal("group"), Type.Literal("change")]);
export type LoopLevel = Static<typeof LoopLevel>;

export const Escalation = closed({ level: LoopLevel, to: Recipient, reason: Type.String(), question: Name() });
export type Escalation = Static<typeof Escalation>;

/** Only the escalation's named recipient may answer it. */
export const EscalationAnswer = Type.Refine(
	closed({ escalation: Escalation, by: Recipient, decision: Type.String(), feedback: Type.Array(Feedback) }),
	(answer) => answer.by === answer.escalation.to,
	(answer) => `the escalation goes to the ${answer.escalation.to}, not the ${answer.by}`,
);
export type EscalationAnswer = Static<typeof EscalationAnswer>;

/** Every unmet target of the verdict has at least one feedback item whose finding names it. */
export const Iteration = Type.Refine(
	closed({
		n: Type.Integer({ minimum: 1 }),
		plan: Type.String(),
		actions: Type.Array(Action),
		evidence: Type.Array(Evidence),
		verdict: Verdict,
		feedback: Type.Array(Feedback),
	}),
	(iteration) =>
		iteration.verdict.unmet.every(({ target }) => iteration.feedback.some((item) => sameValue(item.from.target, target))),
	() => "an unmet target has no feedback",
);
export type Iteration = Static<typeof Iteration>;

export const LoopInput = <Goal extends TSchema>(goal: Goal) =>
	closed({ goal, context: Type.Array(ContextRef), budget: Budget, carried: Type.Array(Feedback) });
export type LoopInput<Goal> = Static<ReturnType<typeof LoopInput<TUnsafe<Goal>>>>;

const numberedFromOne = (outcome: { iterations: readonly { n: number }[] }) =>
	outcome.iterations.every((iteration, i) => iteration.n === i + 1);

/**
 * How a loop ended. `result` is present when it converged; `escalation` exactly
 * when it is blocked. Iterations are numbered from 1, one apart.
 */
const loopOutcomes = <Out extends TSchema>(out: Out) =>
	Type.Union([
		closed({ status: Type.Literal("converged"), iterations: Type.Array(Iteration), result: out }),
		closed({
			status: Type.Literal("blocked"),
			iterations: Type.Array(Iteration),
			result: Type.Optional(out),
			escalation: Escalation,
		}),
		closed({
			status: Type.Union([Type.Literal("exhausted"), Type.Literal("failed")]),
			iterations: Type.Array(Iteration),
			result: Type.Optional(out),
		}),
	]);

export const LoopOutcome = <Out extends TSchema>(out: Out) =>
	Type.Refine<ReturnType<typeof loopOutcomes<Out>>, { iterations: readonly { n: number }[] }>(
		loopOutcomes(out),
		numberedFromOne,
		() => "iterations are not numbered 1, 2, 3, …",
	);
export type LoopOutcome<Out> = Static<ReturnType<typeof LoopOutcome<TUnsafe<Out>>>>;

/** One run of a loop: what it was given and how it ended. The iterations are the outcome's. */
export const Loop = <Goal extends TSchema, Out extends TSchema>(goal: Goal, out: Out) =>
	closed({ input: LoopInput(goal), output: LoopOutcome(out) });
export type Loop<Goal, Out> = Static<ReturnType<typeof Loop<TUnsafe<Goal>, TUnsafe<Out>>>>;

export const LoopStatus = literals("converged", "blocked", "exhausted", "failed");
export type LoopStatus = Static<typeof LoopStatus>;

export const TaskOutcome = closed({ task: TaskId, ticked: Type.Boolean() });
export type TaskOutcome = Static<typeof TaskOutcome>;

/** One entry per task (its latest run), each id within the group. */
export const GroupOutcome = Type.Refine(
	closed({
		group: Type.Integer({ minimum: 1 }),
		tasks: Type.Array(
			closed({ task: TaskId, outcome: LoopOutcome(TaskOutcome), runs: Type.Integer({ minimum: 1 }) }),
		),
	}),
	(outcome) =>
		outcome.tasks.every((entry) => entry.task.startsWith(`${outcome.group}.`)) &&
		new Set(outcome.tasks.map((entry) => entry.task)).size === outcome.tasks.length,
	() => "a task is listed twice, or outside its group",
);
export type GroupOutcome = Static<typeof GroupOutcome>;

/** One entry per group, in ascending order; `unclaimed` is what no task claimed when execution started. */
export const ChangeOutcome = Type.Refine(
	closed({
		groups: Type.Array(
			closed({
				group: Type.Integer({ minimum: 1 }),
				outcome: LoopOutcome(GroupOutcome),
				runs: Type.Integer({ minimum: 1 }),
			}),
		),
		unclaimed: Type.Array(ScenarioRef),
	}),
	(outcome) => outcome.groups.every((entry, i) => i === 0 || entry.group > outcome.groups[i - 1]!.group),
	() => "group entries are not unique and ascending",
);
export type ChangeOutcome = Static<typeof ChangeOutcome>;

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
