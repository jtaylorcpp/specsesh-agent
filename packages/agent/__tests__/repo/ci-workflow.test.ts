// CI on pull requests and main (#48): the checks a change must pass, on release.yml's rules: every
// action pinned to a commit, read-only permissions, and nothing that could reach a secret.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".github", "workflows");
const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8");
const CI = read("ci.yml");
const LINES = CI.split("\n");

const indent = (line: string): number => line.length - line.trimStart().length;
const meaningful = (line: string): boolean => line.trim() !== "" && !line.trimStart().startsWith("#");
const bare = (value: string): string => value.replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");

/** The meaningful lines under the line at `start`, up to the next one no deeper than it. */
const under = (start: number): string[] => {
	const block: string[] = [];
	for (const line of LINES.slice(start + 1)) {
		if (!meaningful(line)) continue;
		if (indent(line) <= indent(LINES[start]!)) break;
		block.push(line);
	}
	return block;
};

/** Each `uses:` value of a workflow, as `action@ref`. */
const usesOf = (text: string): string[] =>
	text
		.split("\n")
		.map((line) => /^\s*(?:- )?uses:\s*(.*)$/.exec(line)?.[1])
		.filter((value): value is string => value !== undefined)
		.map(bare);

describe("repo/ci: pull requests and main run the checks", () => {
	it("runs on every pull request and on pushes to main, and on nothing else", () => {
		const on = LINES.findIndex((line) => /^["']?on["']?:/.test(line));
		expect(on).toBeGreaterThanOrEqual(0);
		const block = under(on);
		const triggers = block.filter((line) => indent(line) === 2).map((line) => line.trim().replace(/:.*$/, ""));
		expect(triggers.sort()).toEqual(["pull_request", "push"]);
		expect(block.map((line) => line.trim()).join(" ")).toMatch(/push: branches: \[\s*["']?main["']?\s*\]$/);
	});

	it("runs exactly the checks, install first", () => {
		const commands = LINES.map((line) => /^\s*(?:- )?run:\s*(.*)$/.exec(line)?.[1]).filter((value): value is string => value !== undefined);
		expect(commands.map(bare)).toEqual([
			"pnpm install --frozen-lockfile",
			"pnpm check",
			"pnpm test",
			"pnpm docs:check",
			"node scripts/parity.mjs --check",
		]);
	});

	it("may only read the repository, and every permissions block says so", () => {
		// Any `permissions:`, inline (`write-all`) or a block, at the top or in a job.
		const blocks = LINES.flatMap((line, i) => (/^\s*permissions:/.test(line) ? [i] : []));
		expect(blocks.length).toBeGreaterThan(0);
		expect(LINES[blocks[0]!]).toBe("permissions:");
		for (const start of blocks) {
			expect(bare(LINES[start]!)).toBe("permissions:");
			expect(under(start).map((line) => bare(line))).toEqual(["contents: read"]);
		}
	});

	it("reaches no secret, publishes nothing, and keeps no token in the checkout", () => {
		for (const forbidden of ["secrets.", "pull_request_target", "id-token", "npm publish", "NODE_AUTH_TOKEN", "NPM_TOKEN"]) {
			expect(CI, forbidden).not.toContain(forbidden);
		}
		const checkout = LINES.findIndex((line) => /uses:\s*actions\/checkout@/.test(line));
		expect(under(checkout).map((line) => line.trim())).toEqual(["with:", "persist-credentials: false"]);
	});
});

describe("repo/workflows: every workflow pins its actions the same way", () => {
	const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));

	it("pins every action of every workflow to a commit", () => {
		expect(files).toEqual(expect.arrayContaining(["ci.yml", "release.yml"]));
		for (const name of files) {
			const uses = usesOf(read(name));
			expect(uses.length, name).toBeGreaterThan(0);
			for (const action of uses) expect(action, `${name}: ${action}`).toMatch(/@[0-9a-f]{40}$/);
		}
	});

	it("pins an action to one commit across workflows, so a bump moves them together", () => {
		const pins = new Map<string, Set<string>>();
		for (const name of files) {
			for (const action of usesOf(read(name))) {
				const [path, ref] = action.split("@") as [string, string];
				pins.set(path, (pins.get(path) ?? new Set()).add(ref));
			}
		}
		for (const [path, refs] of pins) expect([...refs], path).toHaveLength(1);
	});
});
