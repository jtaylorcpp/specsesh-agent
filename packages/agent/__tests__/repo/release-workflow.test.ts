import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const WORKFLOW = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");

const indent = (line: string): number => line.length - line.trimStart().length;
const isComment = (line: string): boolean => line.trimStart().startsWith("#");

// The lines under a top-level `key:` (bare or quoted), up to the next unindented line that isn't a comment.
const topLevelBlock = (text: string, key: string): string[] => {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => new RegExp(`^["']?${key}["']?:`).test(line));
	if (start < 0) return [];
	const block: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() !== "" && indent(line) === 0 && !isComment(line)) break;
		block.push(line);
	}
	return block;
};

// Every command line of every `run:` step, in file order, without blanks or comments.
const runCommands = (text: string): string[] => {
	const lines = text.split("\n");
	const commands: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]!);
		if (!match) continue;
		const value = match[2]!.trim();
		if (!/^[|>][-+]?$/.test(value)) {
			commands.push(value);
			continue;
		}
		const base = indent(lines[i]!);
		for (i++; i < lines.length; i++) {
			const line = lines[i]!;
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

const indexOf = (commands: string[], predicate: RegExp | string): number =>
	commands.findIndex((command) => (typeof predicate === "string" ? command.includes(predicate) : predicate.test(command)));

describe("package/release: A version tag runs the release workflow", () => {
	it("Scenario: Only a version tag triggers it", () => {
		const block = topLevelBlock(WORKFLOW, "on")
			.filter((line) => line.trim() !== "" && !isComment(line))
			.map((line) => line.replace(/\s+#.*$/, ""));
		expect(block.length).toBeGreaterThan(0);
		const flat = block.join(" ").replace(/\s+/g, " ").trim();
		expect(flat).toMatch(/^push:\s*tags:\s*(\[\s*["']?v\*["']?\s*\]|-\s*["']?v\*["']?)$/);
		for (const forbidden of ["branches", "pull_request", "workflow_dispatch"]) expect(flat).not.toContain(forbidden);
	});

	it("Scenario: The checks run before any publish", () => {
		const commands = runCommands(WORKFLOW);
		const firstPublish = indexOf(commands, /\bnpm publish\b/);
		expect(firstPublish).toBeGreaterThanOrEqual(0);
		const checks: (RegExp | string)[] = [
			"pnpm install --frozen-lockfile",
			/(^|\s)pnpm check(\s|$)/,
			/(^|\s)pnpm test(\s|$)/,
			/(^|\s)pnpm pack:check(\s|$)/,
			"node scripts/release-check.mjs",
		];
		for (const check of checks) {
			const at = indexOf(commands, check);
			expect(at, String(check)).toBeGreaterThanOrEqual(0);
			expect(at, String(check)).toBeLessThan(firstPublish);
		}
	});

	it("Scenario: The agent publishes before specsesh", () => {
		const publishes = runCommands(WORKFLOW).filter((command) => /\bnpm publish\b/.test(command));
		expect(publishes).toHaveLength(2);
		expect(publishes[0]).toMatch(/\bspecsesh-agent-[^\s]*\.tgz/);
		expect(publishes[1]).toMatch(/\bspecsesh-[^\s]*\.tgz/);
		expect(publishes[1]).not.toContain("specsesh-agent-");
	});
});

describe("release workflow: the tarballs land where it publishes them from", () => {
	// pnpm resolves --pack-destination against the working directory (the repo root), not the
	// filtered package, so `release` is <root>/release, the directory the publish steps read.
	it("packs both packages into release/ at the repo root", () => {
		const packs = runCommands(WORKFLOW).filter((command) => /\bpnpm\b.*\bpack\s/.test(command));
		expect(packs).toHaveLength(2);
		for (const command of packs) expect(command).toMatch(/--pack-destination release(\s|$)/);
	});
});
