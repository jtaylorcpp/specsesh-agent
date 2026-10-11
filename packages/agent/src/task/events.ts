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
import type { GroupOutcome, Iteration, LoopOutcome, LoopStatus, TaskOutcome } from "../openspec/index.js";
import type { LoopCheckpoint } from "./loop-input.js";

export type TaskEvent =
	| { event: "loop-started"; loop: number; group?: number; change: string; task: string; script: string; at: string }
	| { event: "iteration-started"; loop: number; group?: number; iteration: number; at: string }
	| { event: "action"; loop: number; group?: number; iteration: number; kind: string; summary: string; refs: string[] }
	| ({ event: "evidence"; loop: number; group?: number; iteration: number; kind: string } & Record<string, unknown>)
	| { event: "verdict"; loop: number; group?: number; iteration: number; met: boolean; unmet: string; next: string }
	| { event: "loop-ended"; loop: number; group?: number; status: string; iterations: number; ticked: boolean; changed: string[] }
	| { event: "warning"; loop: number; message: string };

/**
 * A group loop's events, on top of its child task loops' (`loop` is the group loop's id):
 *
 *   group-started  change, group, tasks, at
 *   group-check    commands, passed
 *   rework         task, reason
 *   group-ended    status, tasks, changed
 */
export type GroupEvent =
	| { event: "group-started"; loop: number; change: string; group: number; tasks: string[]; at: string }
	| { event: "group-check"; loop: number; commands: { command: string; exitCode: number }[]; passed: boolean }
	| { event: "rework"; loop: number; task: string; reason: string }
	| {
			event: "group-ended";
			loop: number;
			status: LoopStatus;
			tasks: { task: string; status: LoopStatus; runs: number }[];
			changed: string[];
	  };

export type StreamEvent = TaskEvent | GroupEvent;

export const now = (): string => new Date().toISOString();

/** Writes events, one JSON object per line. */
export type EventSink = (event: StreamEvent) => void;

export const groupStarted = (loop: number, change: string, group: number, tasks: readonly string[], at = now()): GroupEvent => ({
	event: "group-started",
	loop,
	change,
	group,
	tasks: [...tasks],
	at,
});

export const groupCheck = (loop: number, commands: readonly { command: string; exitCode: number }[], passed: boolean): GroupEvent => ({
	event: "group-check",
	loop,
	commands: commands.map(({ command, exitCode }) => ({ command, exitCode })),
	passed,
});

export const rework = (loop: number, task: string, reason: string): GroupEvent => ({ event: "rework", loop, task, reason });

export const groupEnded = (
	loop: number,
	status: LoopStatus,
	tasks: readonly { task: string; status: LoopStatus; runs: number }[],
	changed: readonly string[],
): GroupEvent => ({ event: "group-ended", loop, status, tasks: tasks.map(({ task, status, runs }) => ({ task, status, runs })), changed: [...changed] });

/** `group-ended` from a settled group loop: each task's status is its own last run's. */
export function groupEndedFromOutcome(loop: number, outcome: LoopOutcome<GroupOutcome>, changed: readonly string[]): GroupEvent {
	const tasks = (outcome.result?.tasks ?? []).map((entry) => ({ task: entry.task, status: entry.outcome.status, runs: entry.runs }));
	return groupEnded(loop, outcome.status, tasks, changed);
}

/**
 * A sink that stamps `group` on every task event passed through it. Group
 * events and warnings pass unchanged. The group loop hands each child task
 * loop its sink wrapped this way.
 */
export function withGroup(sink: EventSink, group: number): EventSink {
	return (event) => {
		switch (event.event) {
			case "loop-started":
			case "iteration-started":
			case "action":
			case "evidence":
			case "verdict":
			case "loop-ended":
				sink({ ...event, group });
				return;
			default:
				sink(event);
		}
	};
}

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

	private readonly loop: number;
	private readonly emit: EventSink;

	constructor(
		loop: number,
		emit: EventSink,
		/** Iterations an earlier run of the loop already recorded (an answered escalation's). */
		earlier = 0,
	) {
		this.loop = loop;
		this.emit = emit;
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
