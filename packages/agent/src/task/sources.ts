/**
 * Reading every source once, when the loop starts. What comes out is text, and
 * it is what the durable task stores: a resumed loop reads no file.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { capabilityOfPath, type Delta } from "./deltas.js";
import { TaskLoopStartError } from "./errors.js";
import { BUNDLED_SCRIPTS, type ChangeSource, type Source } from "./options.js";

/** A change's artifacts as text. `tasksPath` is set when tasks.md came from a file, which only then may be ticked. */
export interface LoadedChange {
	readonly proposal: string;
	readonly design: string;
	readonly deltas: readonly Delta[];
	readonly tasks: string;
	/** Absolute. */
	readonly tasksPath?: string;
	/** How tasks.md is named in messages: its path as given, or `tasks.md` for text. */
	readonly tasksLabel: string;
}

/** A source's text. A path that cannot be read refuses the start, naming it as given. */
export function readSource(source: Source): string {
	if ("text" in source) return source.text;
	try {
		return readFileSync(source.path, "utf8");
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));
		throw new TaskLoopStartError(`cannot read ${source.path} (${reason}); the loop was not started`);
	}
}

/** The script's text: the given source, or the bundled `task.agent`. */
export function readScript(script: Source | undefined): string {
	return script === undefined ? readFileSync(BUNDLED_SCRIPTS.task, "utf8") : readSource(script);
}

export function readChange(change: ChangeSource): LoadedChange {
	if ("dir" in change) return readChangeDir(change.dir);
	return {
		proposal: readSource(change.proposal),
		design: change.design === undefined ? "" : readSource(change.design),
		deltas: change.deltas.map((source, i) => ({
			capability: "path" in source ? capabilityOfPath(source.path) : `delta ${i + 1}`,
			text: readSource(source),
		})),
		tasks: readSource(change.tasks),
		...("path" in change.tasks ? { tasksPath: resolve(change.tasks.path) } : {}),
		tasksLabel: "path" in change.tasks ? change.tasks.path : "tasks.md",
	};
}

function readChangeDir(dir: string): LoadedChange {
	const required = (name: string) => {
		const path = join(dir, name);
		if (!existsSync(path)) throw new TaskLoopStartError(`${path} does not exist; the loop was not started`);
		return path;
	};
	const proposal = required("proposal.md");
	const tasks = required("tasks.md");
	const specs = join(dir, "specs");
	const files = existsSync(specs) ? specFiles(specs) : [];
	if (files.length === 0) {
		throw new TaskLoopStartError(`${join(specs, "<capability>", "spec.md")} does not exist: the change has no delta; the loop was not started`);
	}
	const deltas = files
		.map((file) => ({ capability: relative(specs, join(file, "..")).split(sep).join("/"), path: file }))
		.sort((a, b) => (a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0))
		.map(({ capability, path }) => ({ capability, text: readSource({ path }) }));
	const design = join(dir, "design.md");
	return {
		proposal: readSource({ path: proposal }),
		design: existsSync(design) ? readSource({ path: design }) : "",
		deltas,
		tasks: readSource({ path: tasks }),
		tasksPath: resolve(tasks),
		tasksLabel: tasks,
	};
}

function specFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return specFiles(path);
		return entry.name === "spec.md" ? [path] : [];
	});
}
