/**
 * Today's tasks.md line format, `- [ ] <id> <text>` or `- [x] <id> <text>`:
 * finding a task by id, listing the ids, and ticking one line in place.
 */

import { TaskLoopStartError } from "./errors.js";

const TASK_LINE = /^- \[( |x)\] ([1-9][0-9]*\.[1-9][0-9]*) (.*)$/gm;

export interface TaskLine {
	readonly id: string;
	readonly done: boolean;
	readonly text: string;
	/** Offset of the line's first character in the file. */
	readonly offset: number;
}

/** Every task line, in file order. */
export function taskLines(tasksMd: string): TaskLine[] {
	return [...tasksMd.matchAll(TASK_LINE)].map((m) => ({
		id: m[2] as string,
		done: m[1] === "x",
		text: m[3] as string,
		offset: m.index,
	}));
}

/** The task's text, without checkbox and id. An unknown id refuses, listing every id the file holds. */
export function findTask(tasksMd: string, id: string, label: string): string {
	const lines = taskLines(tasksMd);
	const line = lines.find((l) => l.id === id);
	if (line === undefined) {
		const ids = lines.map((l) => l.id);
		throw new TaskLoopStartError(
			`task ${id} is not in ${label}; the tasks it holds are ${ids.length > 0 ? ids.join(", ") : "none"}`,
		);
	}
	return line.text;
}

/**
 * The file with only the task's `- [x]` turned into `- [ ]`, or why it was left
 * alone: the line is already unticked, or no longer there.
 */
export function untickLine(tasksMd: string, id: string): { text: string } | { reason: "unticked" | "missing" } {
	const line = taskLines(tasksMd).find((l) => l.id === id);
	if (line === undefined) return { reason: "missing" };
	if (!line.done) return { reason: "unticked" };
	const box = line.offset + "- [".length;
	return { text: `${tasksMd.slice(0, box)} ${tasksMd.slice(box + 1)}` };
}

/**
 * The file with only the task's `- [ ]` turned into `- [x]`, or why it was left
 * alone: the line is already ticked, or no longer there.
 */
export function tickLine(tasksMd: string, id: string): { text: string } | { reason: "ticked" | "missing" } {
	const line = taskLines(tasksMd).find((l) => l.id === id);
	if (line === undefined) return { reason: "missing" };
	if (line.done) return { reason: "ticked" };
	const box = line.offset + "- [".length;
	return { text: `${tasksMd.slice(0, box)}x${tasksMd.slice(box + 1)}` };
}
