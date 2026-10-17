import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const WORKFLOW = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
const LINES = WORKFLOW.split("\n");

const indent = (line: string): number => line.length - line.trimStart().length;
const isComment = (line: string): boolean => line.trimStart().startsWith("#");
const stripComment = (value: string): string => value.replace(/\s+#.*$/, "").trim();
const unquote = (value: string): string => value.replace(/^(["'])(.*)\1$/, "$2");

// The index of `key:` at exactly `depth` spaces, searching lines [from, to).
const keyAt = (key: string, depth: number, from = 0, to = LINES.length): number => {
	for (let i = from; i < to; i++) {
		const line = LINES[i]!;
		if (indent(line) === depth && new RegExp(`^\\s*["']?${key}["']?:`).test(line)) return i;
	}
	return -1;
};

// The end (exclusive) of the block opened at line `start`: the next non-blank, non-comment line no deeper than it.
const blockEnd = (start: number): number => {
	const base = indent(LINES[start]!);
	for (let i = start + 1; i < LINES.length; i++) {
		const line = LINES[i]!;
		if (line.trim() !== "" && !isComment(line) && indent(line) <= base) return i;
	}
	return LINES.length;
};

// A flat mapping of the `key: value` lines in a block, inline (`{ a: b }`) or nested one level.
const mapping = (start: number): Record<string, string> => {
	const inline = stripComment(LINES[start]!.replace(/^[^:]*:/, ""));
	if (inline !== "") {
		if (!inline.startsWith("{")) return { "": unquote(inline) };
		return Object.fromEntries(
			inline
				.replace(/^\{|\}$/g, "")
				.split(",")
				.filter((pair) => pair.trim() !== "")
				.map((pair) => pair.split(":").map((part) => unquote(part.trim())) as [string, string]),
		);
	}
	const entries: [string, string][] = [];
	for (const line of LINES.slice(start + 1, blockEnd(start))) {
		if (line.trim() === "" || isComment(line)) continue;
		const match = /^\s*["']?([^"':]+)["']?:\s*(.*)$/.exec(line);
		if (match) entries.push([match[1]!, unquote(stripComment(match[2]!))]);
	}
	return Object.fromEntries(entries);
};

// Every command line of every `run:` step, in file order, without blanks or comments.
const runCommands = (): string[] => {
	const commands: string[] = [];
	for (let i = 0; i < LINES.length; i++) {
		const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(LINES[i]!);
		if (!match) continue;
		const value = match[2]!.trim();
		if (!/^[|>][-+]?$/.test(value)) {
			commands.push(value);
			continue;
		}
		const base = indent(LINES[i]!);
		for (i++; i < LINES.length; i++) {
			const line = LINES[i]!;
			if (line.trim() === "") continue;
			if (indent(line) <= base) {
				i--;
				break;
			}
			if (!isComment(line)) commands.push(line.trim());
		}
	}
	return commands;
};

describe("package/release: Publishing is trusted publishing with provenance", () => {
	it("Scenario: The job may mint an OIDC token and nothing more", () => {
		const expected = { "id-token": "write", contents: "read" };
		const jobs = keyAt("jobs", 0);
		expect(jobs).toBeGreaterThanOrEqual(0);
		const publish = keyAt("publish", 2, jobs + 1, blockEnd(jobs));
		expect(publish).toBeGreaterThanOrEqual(0);
		const permissions = keyAt("permissions", 4, publish + 1, blockEnd(publish));
		expect(permissions).toBeGreaterThanOrEqual(0);
		expect(mapping(permissions)).toEqual(expected);
		const topLevel = keyAt("permissions", 0);
		if (topLevel >= 0) expect(mapping(topLevel)).toEqual(expected);
	});

	it("Scenario: No npm token is referenced", () => {
		for (const forbidden of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "secrets."]) expect(WORKFLOW).not.toContain(forbidden);
	});

	it("Scenario: Every publish is public with provenance", () => {
		const publishes = runCommands().filter((command) => /\bnpm publish\b/.test(command));
		expect(publishes.length).toBeGreaterThan(0);
		for (const publish of publishes) {
			expect(publish).toMatch(/(^|\s)--access\s+public(\s|$)/);
			expect(publish).toMatch(/(^|\s)--provenance(\s|$)/);
			expect(publish).toMatch(/(^|\s)--tag\s+(?!-)\S+/);
		}
	});

	it("Scenario: Every action is pinned to a commit", () => {
		const uses = LINES.map((line) => /^\s*(?:- )?uses:\s*(.*)$/.exec(line))
			.filter((match): match is RegExpExecArray => match !== null)
			.map((match) => unquote(stripComment(match[1]!)));
		expect(uses.length).toBeGreaterThan(0);
		for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
	});
});
