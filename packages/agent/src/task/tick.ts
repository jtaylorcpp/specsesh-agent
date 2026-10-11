/**
 * Ticking a converged task in a tasks.md given by path: that line's `- [ ]`
 * becomes `- [x]` and no other byte moves. Never from text, never in doubt,
 * never the other way.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tickLine, untickLine } from "./tasks-md.js";

export interface Tick {
	readonly ticked: boolean;
	/** Why nothing was written; absent when the line was ticked. */
	readonly note?: string;
}

export function tickTask(tasksPath: string | undefined, task: string): Tick {
	if (tasksPath === undefined) return { ticked: false, note: `task ${task} converged; tasks.md was given as text, so nothing was written` };
	let text: string;
	try {
		text = readFileSync(tasksPath, "utf8");
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code ?? String(error);
		return { ticked: false, note: `task ${task} converged, but ${tasksPath} cannot be read (${reason}); nothing was written` };
	}
	const ticked = tickLine(text, task);
	if ("reason" in ticked) {
		return {
			ticked: false,
			note:
				ticked.reason === "ticked"
					? `task ${task} is already ticked in ${tasksPath}; nothing was written`
					: `task ${task} is no longer in ${tasksPath}; nothing was written`,
		};
	}
	writeFileSync(tasksPath, ticked.text);
	return { ticked: true };
}

export interface Untick {
	readonly unticked: boolean;
	/** Why nothing was written; absent when the line was unticked. */
	readonly note?: string;
}

/**
 * A group loop's rework reopens a task: that line's `- [x]` becomes `- [ ]`, from a
 * tasks.md given by path only. This is the one place anything unticks; the task loop never does.
 * Writing the same file twice is harmless, so a rerun after a crash repeats it.
 */
export function untick(tasksPath: string | undefined, task: string): Untick {
	if (tasksPath === undefined) return { unticked: false, note: `task ${task} reopened; tasks.md was given as text, so nothing was written` };
	let text: string;
	try {
		text = readFileSync(tasksPath, "utf8");
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code ?? String(error);
		return { unticked: false, note: `task ${task} reopened, but ${tasksPath} cannot be read (${reason}); nothing was written` };
	}
	const unticked = untickLine(text, task);
	if ("reason" in unticked) {
		return {
			unticked: false,
			note:
				unticked.reason === "unticked"
					? `task ${task} is already unticked in ${tasksPath}; nothing was written`
					: `task ${task} is no longer in ${tasksPath}; nothing was written`,
		};
	}
	writeFileSync(tasksPath, unticked.text);
	return { unticked: true };
}
