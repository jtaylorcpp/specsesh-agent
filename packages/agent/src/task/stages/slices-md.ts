/**
 * A slices.md draft: the ordered changes an oversized intent is cut into, one
 * line each, `` <n>. `<change-id>`: <intent> ``, this change first. Reading is
 * pure string parsing; `sliceIssues` is the gate's check of what was read.
 */

import type { StageIssue } from "../spec-stage.js";

const SLICES = "slices.md";
const LINE = /^(\d+)\. `([a-z0-9-]+)`: (.+)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface Slice {
	/** The number the line gives itself. */
	readonly n: number;
	readonly id: string;
	/** The intent, trimmed and otherwise verbatim. */
	readonly intent: string;
	/** The line's 1-based line number. */
	readonly line: number;
}

export interface Slices {
	readonly entries: readonly Slice[];
	/** Every non-blank line that is not a slice, headings and comments included. */
	readonly malformed: readonly { readonly line: number; readonly text: string }[];
}

/** Every slice line in document order, and every other non-blank line as malformed. */
export function readSlices(markdown: string): Slices {
	const entries: Slice[] = [];
	const malformed: { line: number; text: string }[] = [];
	markdown.split("\n").forEach((raw, index) => {
		const text = raw.trimEnd();
		if (text === "") return;
		const match = LINE.exec(text);
		if (match) entries.push({ n: Number(match[1]), id: match[2] as string, intent: (match[3] as string).trim(), line: index + 1 });
		else malformed.push({ line: index + 1, text });
	});
	return { entries, malformed };
}

const error = (message: string): StageIssue => ({ level: "ERROR", path: SLICES, message });

/**
 * One `ERROR` per malformed line, per number out of sequence, per id that is
 * not kebab-case, repeated or already used, and one for fewer than two entries
 * or a first id other than `changeId`. `existing` holds the ids of every change
 * and archived change; this change's own id is allowed as the first entry.
 */
export function sliceIssues(slices: Slices, changeId: string, existing: Iterable<string>): StageIssue[] {
	const used = new Set(existing);
	const issues = slices.malformed.map(({ line }) => error(`slices.md line ${line} does not match \`<n>. \\\`<change-id>\\\`: <intent>\``));
	slices.entries.forEach(({ n, line }, i) => {
		if (n !== i + 1) issues.push(error(`slices.md line ${line}: expected ${i + 1}, got ${n}`));
	});
	if (slices.entries.length < 2) issues.push(error("slices.md must list at least two changes, this one first"));
	const first = slices.entries[0];
	if (first !== undefined && first.id !== changeId) issues.push(error(`slices.md must start with \`${changeId}\` (found \`${first.id}\`)`));
	const seen = new Set<string>();
	slices.entries.forEach(({ id, line }, i) => {
		if (!KEBAB.test(id)) issues.push(error(`slices.md line ${line}: \`${id}\` is not a kebab-case change id`));
		if (seen.has(id)) issues.push(error(`slices.md line ${line}: \`${id}\` is listed more than once`));
		seen.add(id);
		if (used.has(id) && !(i === 0 && id === changeId)) issues.push(error(`slices.md: \`${id}\` is already used by a change or archived change`));
	});
	return issues;
}
