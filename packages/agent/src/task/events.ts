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
import type { Cursor, Harness, Storage, TaskId } from "@earendil-works/pi-durable";
import type { GroupOutcome, Iteration, LoopOutcome, LoopStatus, TaskOutcome } from "../openspec/index.js";
import { decodeCheckpoint, initialGroupCheckpoint, type GroupCheckpoint, type GroupLoopInput } from "./group.js";
import type { LoopCheckpoint, TaskLoopResult } from "./loop-input.js";
import { TASK_LOOP } from "./loop.js";
import type { StageOutcome } from "./spec-loop.js";

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

/**
 * A spec loop's events (`loop` is the spec loop's id), one `stage-draft` per gate round:
 *
 *   stage-started   change, stage, script, at
 *   stage-draft     draft, written, issues
 *   stage-review    files, question
 *   stage-question  question
 *   stage-ended     status, drafts, approved
 */
export type SpecEvent =
	| { event: "stage-started"; loop: number; change: string; stage: string; script: string; at: string }
	| { event: "stage-draft"; loop: number; draft: number; written: string[]; issues: { level: string; path: string; message: string }[] }
	| { event: "stage-review"; loop: number; files: string[]; question: string }
	| { event: "stage-question"; loop: number; question: string }
	| { event: "stage-ended"; loop: number; status: LoopStatus; drafts: number; approved: boolean };

export type StreamEvent = TaskEvent | GroupEvent | SpecEvent;

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

export const stageStarted = (loop: number, change: string, stage: string, script: string, at = now()): SpecEvent => ({
	event: "stage-started",
	loop,
	change,
	stage,
	script,
	at,
});

/** A spec loop's iteration as its `stage-draft`: the paths its round wrote and its gate's issues. */
export function stageDraft(loop: number, iteration: Iteration): SpecEvent {
	const written = iteration.actions.filter((action) => action.kind === "edit").flatMap((action) => action.refs);
	const issues = iteration.evidence.flatMap((evidence) =>
		evidence.kind === "validation" ? evidence.report.issues.map(({ level, path, message }) => ({ level, path, message })) : [],
	);
	return { event: "stage-draft", loop, draft: iteration.n, written, issues };
}

/** `stage-review` or `stage-question` for a blocked spec loop; none for any other end. */
export function stageOutcome(loop: number, outcome: LoopOutcome<StageOutcome>): SpecEvent | undefined {
	if (outcome.status !== "blocked") return undefined;
	const { reason, question } = outcome.escalation;
	if (reason === "review") return { event: "stage-review", loop, files: [...(outcome.result?.files ?? [])], question };
	return { event: "stage-question", loop, question };
}

export const stageEnded = (loop: number, outcome: LoopOutcome<StageOutcome>): SpecEvent => ({
	event: "stage-ended",
	loop,
	status: outcome.status,
	drafts: outcome.iterations.length,
	approved: outcome.status === "converged" && outcome.result.approved,
});

/**
 * A settled spec loop's whole stream, in order: `stage-started`, a `stage-draft` per
 * iteration after the `earlier` ones (an answered run's, already streamed), then
 * `stage-review` or `stage-question` when it blocked, then `stage-ended`.
 */
export function specEvents(
	loop: number,
	start: { readonly change: string; readonly stage: string; readonly script: string; readonly at?: string },
	outcome: LoopOutcome<StageOutcome>,
	earlier = 0,
): SpecEvent[] {
	const events = [stageStarted(loop, start.change, start.stage, start.script, start.at)];
	for (const iteration of outcome.iterations) if (iteration.n > earlier) events.push(stageDraft(loop, iteration));
	const blocked = stageOutcome(loop, outcome);
	if (blocked !== undefined) events.push(blocked);
	events.push(stageEnded(loop, outcome));
	return events;
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

/** A child task loop of a group, as the watcher reads it from storage. */
type ChildRecord = {
	readonly id: number;
	readonly input: { readonly task: string; readonly earlier?: readonly unknown[] };
	readonly state: { readonly status: string; readonly checkpoint?: unknown; readonly outcome?: { readonly status: string; readonly result?: unknown } };
};

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEarlierTask(v: unknown): v is { task: string; earlier?: readonly unknown[] } {
	return isObject(v) && typeof v.task === "string" && (v.earlier === undefined || Array.isArray(v.earlier));
}

export interface GroupWatchOptions {
	readonly change: string;
	/** The script label child `loop-started` events carry. */
	readonly script: string;
	/** Called as a child's `loop-started` is emitted; the function it returns lists what that loop changed. */
	readonly track?: () => () => string[];
}

/**
 * Turns a running group loop's record into events, each exactly once and in order:
 * `group-started`, then each child task loop's events (tagged with the group) and
 * each check round's `group-check` (and `rework`) as the group's work reached them,
 * then `group-ended`. Children are the task loops the group owns, in creation order,
 * so a child the poll never saw running is still reported, from its settled record.
 *
 * A round follows exactly the children that ran before it: the starting queue plus
 * one rework child per earlier round.
 */
export class GroupWatcher {
	private readonly loop: number;
	private readonly group: number;
	private readonly tasks: readonly string[];
	private readonly emit: EventSink;
	private readonly options: GroupWatchOptions;
	/** Rounds an answered escalation's earlier run already recorded. */
	private readonly earlier: number;
	/** Children the starting checkpoint queued. */
	private readonly base: number;
	private reported: number;
	private done = 0;
	private current?: { id: number; watcher: LoopWatcher; changed: () => string[] };

	constructor(loop: number, input: GroupLoopInput, emit: EventSink, options: GroupWatchOptions) {
		this.loop = loop;
		this.group = input.group;
		this.tasks = input.tasks.map((t) => t.id);
		this.emit = emit;
		this.options = options;
		const start = input.resume !== undefined ? decodeCheckpoint(input.resume.checkpoint) : initialGroupCheckpoint(input.tasks);
		this.earlier = start.iterations.length;
		this.reported = this.earlier;
		this.base = start.queue.length + (start.phase === "task" && start.child?.id === undefined ? 1 : 0);
	}

	start(): void {
		this.emit(groupStarted(this.loop, this.options.change, this.group, this.tasks));
	}

	private async children(storage: Storage, context: Context): Promise<ChildRecord[]> {
		const found: ChildRecord[] = [];
		let cursor: Cursor | undefined;
		do {
			const page = await storage.scanTasks({ kind: TASK_LOOP }, 100, cursor, context);
			for (const record of page.items) {
				if (record.owner !== undefined && Number(record.owner) === this.loop) {
					const { input, state } = record;
					if (!isEarlierTask(input)) continue;
					found.push({ id: Number(record.id), input, state });
				}
			}
			cursor = page.next;
		} while (cursor !== undefined);
		return found.sort((a, b) => a.id - b.id);
	}

	/** Report one child as far as its record goes; true once it has ended. */
	private feed(child: ChildRecord): boolean {
		const sink = withGroup(this.emit, this.group);
		if (this.current?.id !== child.id) {
			this.current = {
				id: child.id,
				watcher: new LoopWatcher(child.id, sink, child.input.earlier?.length ?? 0),
				changed: this.options.track?.() ?? (() => []),
			};
			sink({ event: "loop-started", loop: child.id, change: this.options.change, task: child.input.task, script: this.options.script, at: now() });
		}
		const { watcher, changed } = this.current;
		const state = child.state;
		if (state.status !== "terminal") {
			if (state.checkpoint !== undefined) watcher.observe(state.checkpoint as LoopCheckpoint);
			return false;
		}
		const ended = state.outcome;
		const outcome = (
			ended?.status === "completed"
				? (ended.result as TaskLoopResult).outcome
				: { status: "failed", iterations: [] }
		) as LoopOutcome<TaskOutcome>;
		watcher.finish(outcome);
		sink({
			event: "loop-ended",
			loop: child.id,
			status: outcome.status,
			iterations: outcome.iterations.length,
			ticked: outcome.status === "converged" ? outcome.result.ticked : false,
			changed: changed(),
		});
		this.current = undefined;
		this.done += 1;
		return true;
	}

	/** Report children until `limit` have ended; false while one is still running. */
	private drain(children: readonly ChildRecord[], limit: number, final: boolean): boolean {
		while (this.done < limit) {
			const child = children[this.done];
			if (child === undefined) return final;
			if (!this.feed(child)) return final;
		}
		return true;
	}

	private reportRound(round: Iteration): void {
		const checks = round.evidence.filter((e) => e.kind === "check") as { command: string; exitCode: number; output: string }[];
		this.emit(groupCheck(this.loop, checks, round.verdict.met));
		const feedback = round.feedback[0];
		if (feedback?.action === "rework-task") {
			const named = /^rework (\S+): ([\s\S]*)$/.exec(feedback.from.message);
			const failing = checks.find((c) => c.exitCode !== 0);
			const firstLine = (failing?.output ?? "").split("\n").find((line) => line.trim() !== "");
			const reason = named?.[2]?.trim() || firstLine || `group ${this.group} check failed`;
			this.emit(rework(this.loop, named?.[1] ?? "", reason));
		}
		this.reported = round.n;
	}

	private advance(children: readonly ChildRecord[], rounds: readonly Iteration[], final: boolean): void {
		for (;;) {
			const bound = this.base + (this.reported - this.earlier);
			const round = rounds.find((r) => r.n === this.reported + 1);
			const limit = round !== undefined || !final ? bound : Number.POSITIVE_INFINITY;
			if (!this.drain(children, limit, final) || round === undefined) return;
			this.reportRound(round);
		}
	}

	/** A group checkpoint read while the loop runs. */
	async observe(storage: Storage, checkpoint: GroupCheckpoint, context: Context): Promise<void> {
		this.advance(await this.children(storage, context), checkpoint.iterations, false);
	}

	/** The settled outcome: whatever children and rounds were not reported yet, then `group-ended`. */
	async finish(storage: Storage, outcome: LoopOutcome<GroupOutcome>, changed: readonly string[], context: Context): Promise<void> {
		this.advance(await this.children(storage, context), outcome.iterations, true);
		this.emit(groupEndedFromOutcome(this.loop, outcome, changed));
	}

	/** Poll the group loop's record every `intervalMs` until stopped. */
	watch(harness: Harness, storage: Storage, id: TaskId<unknown>, context: Context, intervalMs = 200): () => Promise<void> {
		let stopped = false;
		let pending: Promise<void> = Promise.resolve();
		const tick = async () => {
			const record = await harness.getTask(id, context).catch(() => undefined);
			const state = record?.state;
			if (state === undefined || !("checkpoint" in state) || state.checkpoint === undefined) return;
			await this.observe(storage, decodeCheckpoint(state.checkpoint), context).catch(() => undefined);
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
