/**
 * One iteration as the ontology records it: the run read back into a plan, the
 * host actions' `Action`s and `Evidence`, a verdict on the task's one target,
 * and the feedback an unmet verdict carries.
 */

import type { RunResult } from "../interpreter/index.js";
import {
	Action,
	Evidence,
	check,
	feedbackFor,
	type Finding,
	type FindingKind,
	type Iteration,
	type Target,
} from "../openspec/index.js";

/** What the await phase reads from a settled child run, small enough for a checkpoint. */
export type IterationRead =
	| {
			readonly ok: true;
			readonly plan: string;
			readonly actions: Action[];
			readonly evidence: Evidence[];
			readonly met: boolean;
			readonly unmet: string;
			readonly nextAction: string;
			readonly question: string;
			readonly amendPath: string;
			readonly amendText: string;
	  }
	| {
			readonly ok: false;
			readonly plan: string;
			readonly actions: Action[];
			readonly evidence: Evidence[];
			/** Why the run did not complete. */
			readonly message: string;
			/** Set when a host action's failure ended the run, so the loop retries it within budget. */
			readonly actionFailed?: true;
	  };

/** The single target every verdict of the task's loop judges. */
export const taskTarget = (task: string): Target => ({ check: `task ${task}` });

/**
 * A completed run's final variables and host records, or why there are none.
 * `entries` is the run's subagents in the order they ran.
 */
export function readRun(result: RunResult | undefined, failure: string | undefined, entries: readonly string[]): IterationRead {
	const plan = typeof result?.variables["plan"] === "string" ? result.variables["plan"] : "";
	const { actions, evidence } = result === undefined ? { actions: [], evidence: [] } : hostRecords(result, entries);
	if (result === undefined || result.kind !== "completed") {
		const failed = result === undefined ? undefined : failedActionOf(result);
		const message = failed?.message ?? failure ?? runFailure(result);
		return { ok: false, plan, actions, evidence, message, ...(failed !== undefined ? { actionFailed: true as const } : {}) };
	}
	const v = result.variables;
	return {
		ok: true,
		plan,
		actions,
		evidence,
		met: v["met"] === true,
		unmet: String(v["unmet"] ?? ""),
		nextAction: String(v["next_action"] ?? ""),
		question: String(v["question"] ?? ""),
		amendPath: String(v["amend_path"] ?? ""),
		amendText: String(v["amend_text"] ?? ""),
	};
}

/**
 * The failed host action that ended a run, if one did. `steps` and `actions` are
 * separate lists, but a failed step stops the run and so does a failed action, so
 * a failed run whose last step did not fail ended on its last action.
 */
export function failedActionOf(result: RunResult): { action: string; message: string } | undefined {
	if (result.kind !== "failed" || result.steps.at(-1)?.outcome.kind === "failed") return undefined;
	const last = result.actions.at(-1);
	if (last === undefined || last.result.ok) return undefined;
	return { action: last.call.action, message: last.result.message };
}

function runFailure(result: RunResult | undefined): string {
	if (result === undefined) return "the run did not complete";
	const step = result.steps.at(-1)?.outcome;
	if (step?.kind === "failed") return `the run ended ${result.kind}: ${step.category}: ${step.message}`;
	const action = result.actions.at(-1)?.result;
	if (action?.ok === false) return `the run ended ${result.kind}: ${action.message}`;
	return `the run ended ${result.kind}`;
}

/**
 * Every `{ action, evidence }` record the run's host actions attached, entry
 * subagent by entry subagent: a subagent's `run` calls, then its steps' tool
 * calls. A record the ontology refuses is skipped.
 */
function hostRecords(result: RunResult, entries: readonly string[]): { actions: Action[]; evidence: Evidence[] } {
	const actions: Action[] = [];
	const evidence: Evidence[] = [];
	const take = (record: unknown) => {
		if (typeof record !== "object" || record === null) return;
		const { action, evidence: items } = record as { action?: unknown; evidence?: unknown };
		if (!check(Action, action) || !Array.isArray(items) || !items.every((item) => check(Evidence, item))) return;
		actions.push(action as Action);
		evidence.push(...(items as Evidence[]));
	};
	for (const subagent of new Set(entries)) {
		for (const report of result.actions) if (report.subagent === subagent) take(report.result.record);
		for (const step of result.steps) {
			if (step.subagent !== subagent) continue;
			for (const call of step.outcome.toolCalls ?? []) take(call.record);
		}
	}
	return { actions, evidence };
}

/** The finding kind an unmet iteration carries; `feedbackFor` turns it into the action. */
export function findingKind(read: IterationRead): FindingKind {
	if (!read.ok) return "environment";
	if (read.nextAction === "retry") return "code-defect";
	if (read.nextAction === "ask") return "needs-decision";
	if (read.nextAction === "amend-spec") return "spec-defect";
	return "environment";
}

/** The iteration `n` of the task's loop, from what its run read back. `message` overrides the unmet reason. */
export function recordIteration(n: number, task: string, read: IterationRead, message?: string): Iteration {
	const target = taskTarget(task);
	const base = { n, plan: read.plan, actions: read.actions, evidence: read.evidence };
	if (read.ok && read.met) return { ...base, verdict: { met: true, satisfied: [target], unmet: [] }, feedback: [] };
	const reason = message ?? (read.ok ? read.unmet : read.message);
	const finding: Finding = {
		kind: findingKind(read),
		target,
		evidence: read.ok
			? [...read.evidence, { kind: "review", reviewer: "agent", verdict: "changes", notes: read.unmet }]
			: [...read.evidence, { kind: "check", command: "agentscript.run", exitCode: 1, output: read.message }],
		message: reason,
	};
	return { ...base, verdict: { met: false, satisfied: [], unmet: [{ target, reason }] }, feedback: [feedbackFor(finding)] };
}
