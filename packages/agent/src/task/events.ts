/**
 * Progress as JSON Lines: one event per stderr line, after the resume hint.
 *
 *   loop-started       change, task, script, at
 *   iteration-started  iteration, at
 *   action             iteration, kind, summary, refs
 *   evidence           iteration, kind, and the evidence's own fields
 *   verdict            iteration, met, unmet, next
 *   loop-ended         status, iterations, ticked, changed
 *   warning            message
 *
 * The events come from the loop's durable record: `LoopWatcher` polls the
 * checkpoint while the loop runs and reads the outcome when it settles. An
 * iteration's actions, evidence and verdict are known once it is judged, so
 * they arrive together, always after its `iteration-started`.
 */

import type { Context } from "@earendil-works/chord";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import type { Iteration, LoopOutcome, TaskOutcome } from "../openspec/index.js";
import type { LoopCheckpoint } from "./loop-input.js";

export type TaskEvent =
	| { event: "loop-started"; loop: number; change: string; task: string; script: string; at: string }
	| { event: "iteration-started"; loop: number; iteration: number; at: string }
	| { event: "action"; loop: number; iteration: number; kind: string; summary: string; refs: string[] }
	| ({ event: "evidence"; loop: number; iteration: number; kind: string } & Record<string, unknown>)
	| { event: "verdict"; loop: number; iteration: number; met: boolean; unmet: string; next: string }
	| { event: "loop-ended"; loop: number; status: string; iterations: number; ticked: boolean; changed: string[] }
	| { event: "warning"; loop: number; message: string };

export const now = (): string => new Date().toISOString();

/** Writes events, one JSON object per line. */
export type EventSink = (event: TaskEvent) => void;

export function jsonLines(write: (line: string) => void): EventSink {
	return (event) => write(JSON.stringify(event));
}

/** An iteration's actions, evidence and verdict, as events. */
export function iterationEvents(loop: number, iteration: Iteration): TaskEvent[] {
	const n = iteration.n;
	const events: TaskEvent[] = [];
	for (const action of iteration.actions) {
		events.push({ event: "action", loop, iteration: n, kind: action.kind, summary: action.summary, refs: [...action.refs] });
	}
	for (const evidence of iteration.evidence) {
		events.push({ event: "evidence", loop, iteration: n, ...(evidence as Record<string, unknown>), kind: evidence.kind });
	}
	const verdict = iteration.verdict;
	events.push({
		event: "verdict",
		loop,
		iteration: n,
		met: verdict.met,
		unmet: verdict.unmet.map((u) => u.reason).join("; "),
		next: verdict.met ? "done" : (iteration.feedback[0]?.action ?? "retry"),
	});
	return events;
}

/**
 * Turns a running loop's record into events, each exactly once and in order,
 * however often or rarely it is polled.
 */
export class LoopWatcher {
	/** The highest iteration announced with `iteration-started`. */
	private started: number;
	/** The highest iteration whose actions, evidence and verdict were emitted. */
	private reported: number;

	constructor(
		private readonly loop: number,
		private readonly emit: EventSink,
		/** Iterations an earlier run of the loop already recorded (an answered escalation's). */
		earlier = 0,
	) {
		this.started = earlier;
		this.reported = earlier;
	}

	private start(n: number): void {
		while (this.started < n) {
			this.started += 1;
			this.emit({ event: "iteration-started", loop: this.loop, iteration: this.started, at: now() });
		}
	}

	private report(iterations: readonly Iteration[]): void {
		for (const iteration of iterations) {
			if (iteration.n <= this.reported) continue;
			this.start(iteration.n);
			for (const event of iterationEvents(this.loop, iteration)) this.emit(event);
			this.reported = iteration.n;
		}
	}

	/** A checkpoint read while the loop runs. */
	observe(checkpoint: LoopCheckpoint): void {
		this.report(checkpoint.iterations);
		if (checkpoint.phase !== "iterate") this.start(checkpoint.iterations.length + 1);
	}

	/** The settled outcome: whatever iterations were not reported yet. */
	finish(outcome: LoopOutcome<TaskOutcome>): void {
		this.report(outcome.iterations);
	}

	/** Poll the loop's record every `intervalMs` until stopped. */
	watch(harness: Harness, id: TaskId<unknown>, context: Context, intervalMs = 200): () => Promise<void> {
		let stopped = false;
		let pending: Promise<void> = Promise.resolve();
		const tick = async () => {
			const record = await harness.getTask(id, context).catch(() => undefined);
			const state = record?.state;
			if (state !== undefined && "checkpoint" in state && state.checkpoint !== undefined) {
				this.observe(state.checkpoint as unknown as LoopCheckpoint);
			}
		};
		const timer = setInterval(() => {
			if (stopped) return;
			pending = pending.then(tick);
		}, intervalMs);
		return async () => {
			stopped = true;
			clearInterval(timer);
			await pending;
		};
	}
}
