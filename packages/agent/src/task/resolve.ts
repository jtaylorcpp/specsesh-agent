/**
 * Which change and which task `run` works: a change by id under `changesDir`
 * or by path, and a task by id or the first unticked one (`--next`).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { taskLines } from "./tasks-md.js";

/** The change `run` was given, or why it cannot be found. Exit 2. */
export class ChangeNotFoundError extends Error {
	override readonly name = "ChangeNotFoundError";
}

export interface ResolvedChange {
	/** Absolute. */
	readonly dir: string;
	/** The directory's name: what branches, worktrees and events call it. */
	readonly id: string;
}

const isDirectory = (path: string) => existsSync(path) && statSync(path).isDirectory();

/** The open changes: directories under `changesDir` other than `archive`, sorted. */
export function openChanges(changesDir: string): string[] {
	if (!isDirectory(changesDir)) return [];
	return readdirSync(changesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "archive")
		.map((entry) => entry.name)
		.sort();
}

/**
 * A value with a path separator, or naming an existing directory, is a path
 * (relative to `cwd`); anything else is an id under `changesDir`.
 */
export function resolveChange(value: string, changesDir: string, cwd: string): ResolvedChange {
	const asPath = resolve(cwd, value);
	if (value.includes("/") || value.includes(sep) || isDirectory(asPath)) {
		if (!isDirectory(asPath)) throw new ChangeNotFoundError(`the change directory ${value} does not exist`);
		return { dir: asPath, id: basename(asPath) };
	}
	const dir = join(changesDir, value);
	if (!isDirectory(dir)) {
		const open = openChanges(changesDir);
		throw new ChangeNotFoundError(
			`no change "${value}" in ${changesDir}; open changes: ${open.length > 0 ? open.join(", ") : "none"}`,
		);
	}
	return { dir, id: value };
}

/** The id of the first `- [ ]` task in the change's tasks.md, in file order, or undefined when every task is ticked. */
export function nextTask(changeDir: string): string | undefined {
	const path = join(changeDir, "tasks.md");
	if (!existsSync(path)) throw new ChangeNotFoundError(`${path} does not exist, so there is no next task`);
	return taskLines(readFileSync(path, "utf8")).find((line) => !line.done)?.id;
}
