/**
 * The judge phase's mapping, pure: an iteration's read-back becomes the next
 * iteration or the loop's outcome. Which status the loop ends in is the
 * ontology's `outcomeStatus`, over this run's iterations and budget.
 */

import { outcomeStatus, type Escalation, type Iteration, type LoopOutcome, type TaskOutcome } from "../openspec/index.js";
import { NEXT_ACTIONS } from "./contract.js";
import { recordIteration, type IterationRead } from "./iteration.js";
import type { TaskLoopInput } from "./loop-input.js";

export type JudgeDecision =
	| { readonly kind: "iterate"; readonly iterations: Iteration[]; readonly carried: string }
	/** Converged: the caller ticks, then completes the outcome with its result. */
	| { readonly kind: "converged"; readonly iterations: Iteration[] }
	/** Met, with checks configured: the caller moves to the gate with the checkpoint's iterations; nothing is recorded. */
	| { readonly kind: "gate" }
	| { readonly kind: "end"; readonly outcome: LoopOutcome<TaskOutcome>; readonly notes: string[] };

export function judgeIteration(input: TaskLoopInput, iterations: readonly Iteration[], read: IterationRead): JudgeDecision {
	const n = iterations.length + 1;
	const brokeContract = read.ok && !read.met && !(NEXT_ACTIONS as readonly string[]).includes(read.nextAction);
	const contractNote = read.ok
		? `the script broke the task-script contract: next_action is ${JSON.stringify(read.nextAction)}, not one of ${NEXT_ACTIONS.map((a) => JSON.stringify(a)).join(", ")}`
		: "";
	const iteration = recordIteration(n, input.task, read, brokeContract ? contractNote : undefined);
	const all = [...iterations, iteration];
	// The budget is this run's: an answered escalation's run starts with its earlier iterations already recorded.
	const thisRun = all.slice(input.earlier.length);

	if (!read.ok && read.actionFailed !== true) return { kind: "end", outcome: { status: "failed", iterations: all }, notes: [read.message] };
	if (!read.ok) {
		// A failed host action (a delegate timeout, say) is an unmet iteration with `retry` feedback: it costs one iteration.
		return outcomeStatus(thisRun, input.budget) === undefined
			? { kind: "iterate", iterations: all, carried: read.message }
			: { kind: "end", outcome: { status: "exhausted", iterations: all }, notes: [read.message] };
	}
	if (brokeContract) return { kind: "end", outcome: { status: "failed", iterations: all }, notes: [contractNote] };

	if (read.met && input.checks.length > 0) return { kind: "gate" };

	const status = outcomeStatus(thisRun, input.budget);
	switch (status) {
		case undefined:
			return { kind: "iterate", iterations: all, carried: read.unmet };
		case "converged":
			return { kind: "converged", iterations: all };
		case "blocked": {
			let escalation: Escalation = {
				level: "task",
				to: input.escalateTo,
				reason: read.unmet,
				question: read.question || read.unmet || `How should task ${input.task} proceed?`,
			};
			const notes: string[] = [];
			// Only `amend-spec` carries an amendment; the path is checked before the text, so one note at most.
			if (read.nextAction === "amend-spec") {
				if (read.amendPath === "") notes.push("amendment dropped: amend_path is empty");
				else if (read.amendText.trim() === "") notes.push("amendment dropped: amend_text is empty");
				else escalation = { ...escalation, amendment: { delta: read.amendPath, text: read.amendText } };
			}
			return { kind: "end", outcome: { status: "blocked", iterations: all, escalation }, notes };
		}
		default:
			return { kind: "end", outcome: { status, iterations: all }, notes: [] };
	}
}
