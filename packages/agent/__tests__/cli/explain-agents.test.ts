/**
 * package/explain: `specsesh agent list` and `specsesh agent show`, through `main`. The
 * catalogue itself is covered in `bundled.test.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_DIR } from "../../src/cli/bundled.js";
import { main } from "../../src/cli/index.js";
import { READ_AGENT } from "../../src/durable/delegate-scripts.js";

const SHIPPED = ["task", "task-delegate", "group", "spec-proposal", "spec-design", "spec-specify", "spec-plan", "ci-test-pick"];

/** Runs `main(["agent", …argv])` with `out` and `err` collecting lines and `write` collecting bytes. */
async function run(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const chunks: Uint8Array[] = [];
	const code = await main(["agent", ...argv], {
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		write: (chunk) => chunks.push(chunk),
	});
	return { code, stdout: out.join("\n"), stderr: err.join("\n"), bytes: Buffer.concat(chunks) };
}

describe("specsesh agent show prints a script's source", () => {
	it("Scenario: Show the task agent", async () => {
		const { code, bytes, stdout, stderr } = await run(["show", "task"]);
		expect(code).toBe(0);
		expect(bytes.equals(readFileSync(join(BUNDLED_DIR, "task.agent")))).toBe(true);
		expect(stdout).toBe("");
		expect(stderr).toBe("");
	});

	it("Scenario: Unknown agent", async () => {
		const { code, stderr, bytes } = await run(["show", "nope"]);
		expect(code).toBe(2);
		expect(bytes.length).toBe(0);
		expect(stderr).toContain('unknown agent "nope"');
		for (const name of [...SHIPPED, "read", "edit"]) expect(stderr).toMatch(new RegExp(`(: |, )${name}(,|$)`));
	});

	it("a delegate script prints its source text", async () => {
		const { code, bytes } = await run(["show", "read"]);
		expect(code).toBe(0);
		expect(bytes.toString("utf8")).toBe(READ_AGENT);
	});

	it("--json gives the name, path and source", async () => {
		const { code, stdout } = await run(["show", "task", "--json"]);
		expect(code).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			name: "task",
			path: join(BUNDLED_DIR, "task.agent"),
			source: readFileSync(join(BUNDLED_DIR, "task.agent"), "utf8"),
		});
	});

	it("show with no name, or two, prints its usage and exits 2", async () => {
		for (const argv of [["show"], ["show", "task", "group"], ["show", "--nope"]]) {
			const { code, stderr } = await run(argv);
			expect(code, argv.join(" ")).toBe(2);
			expect(stderr, argv.join(" ")).toContain("usage: specsesh agent show <name> [--json]");
		}
	});
});

describe("specsesh agent list lists the bundled scripts", () => {
	it("--json is the catalogue without the sources", async () => {
		const { code, stdout } = await run(["list", "--json"]);
		expect(code).toBe(0);
		const entries = JSON.parse(stdout) as Array<Record<string, unknown>>;
		expect(entries.map((e) => e["name"])).toEqual(expect.arrayContaining(SHIPPED));
		for (const entry of entries) {
			expect(entry["description"]).not.toBe("");
			expect(entry["runBy"]).not.toBe("");
			expect(entry).not.toHaveProperty("source");
		}
	});

	it("Markdown lists one row per script", async () => {
		const { code, stdout } = await run(["list"]);
		expect(code).toBe(0);
		const lines = stdout.split("\n");
		expect(lines[0]).toBe("| name | description | runs via | reads | writes |");
		for (const name of SHIPPED) expect(lines.some((l) => l.startsWith(`| \`${name}\` |`))).toBe(true);
	});

	it("an extra argument or an unknown option prints usage and exits 2", async () => {
		for (const argv of [["list", "frobnicate"], ["list", "--nope"]]) {
			const { code, stderr } = await run(argv);
			expect(code, argv.join(" ")).toBe(2);
			expect(stderr, argv.join(" ")).toContain("usage: specsesh agent list [--json]");
		}
	});
});
