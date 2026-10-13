/**
 * The capabilities a repo already has: every `openspec/specs/<area>/<name>/spec.md`,
 * by path, and each one's `## Purpose` paragraph. The proposal stage seeds `base`
 * with these lines and its gate checks named paths against them.
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
