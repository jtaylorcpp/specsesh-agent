/**
 * The capabilities a repo already has: every `openspec/specs/<area>/<name>/spec.md`,
 * by path, and each one's `## Purpose` paragraph. The proposal stage seeds `base`
 * with these lines and its gate checks named paths against them. Also the change ids
 * already used under the config's `changesDir`, active or archived.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PURPOSE = /^## Purpose\s*$/;
const HEADING = /^#/;

/** Every `<area>/<name>` with a `spec.md` under `<workspace>/openspec/specs/`, in path order; `[]` when there is no such directory. */
export async function existingCapabilities(workspace: string): Promise<string[]> {
	const specs = join(workspace, "openspec", "specs");
	if (!existsSync(specs)) return [];
	const directories = (dir: string) =>
		readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	return directories(specs)
		.flatMap((area) => directories(join(specs, area)).map((name) => `${area}/${name}`))
		.filter((path) => existsSync(join(specs, path, "spec.md")))
		.sort();
}

const ARCHIVE_DATE = /^\d{4}-\d{2}-\d{2}-/;

/** The names of the directories in `dir`; `[]` when it is missing. */
function subdirectories(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

/** Every change id already used under `changes` (the config's `changesDir`), active or archived (its `YYYY-MM-DD-` prefix removed). */
export async function existingChanges(changes: string): Promise<Set<string>> {
	const ids = new Set(subdirectories(changes).filter((name) => name !== "archive"));
	for (const name of subdirectories(join(changes, "archive"))) ids.add(name.replace(ARCHIVE_DATE, ""));
	return ids;
}

/** One `<area>/<name>: <purpose>` line per existing capability, joined by `\n`; a spec with no Purpose keeps its path. */
export async function capabilityLines(workspace: string): Promise<string> {
	const specs = join(workspace, "openspec", "specs");
	return (await existingCapabilities(workspace))
		.map((path) => `${path}: ${readPurpose(readFileSync(join(specs, path, "spec.md"), "utf8"))}`.trimEnd())
		.join("\n");
}

/** The paragraph after `## Purpose`, up to the next heading or the first blank line after text, on one line; "" when there is none. */
export function readPurpose(markdown: string): string {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex((line) => PURPOSE.test(line));
	if (start === -1) return "";
	const paragraph: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (HEADING.test(line)) break;
		if (line.trim() === "") {
			if (paragraph.length > 0) break;
			continue;
		}
		paragraph.push(line);
	}
	return paragraph.join(" ").replace(/\s+/g, " ").trim();
}
