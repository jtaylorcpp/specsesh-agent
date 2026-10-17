/**
 * package/explain: `specsesh agents` and `agents show`, through `runAgents`. The route from
 * `main` comes with the wiring task; the catalogue itself is covered in `bundled.test.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_DIR } from "../../src/cli/bundled.js";
import { runAgents } from "../../src/cli/explain.js";
import { READ_AGENT } from "../../src/durable/delegate-scripts.js";

const SHIPPED = ["task", "task-delegate", "group", "spec-proposal", "spec-design", "spec-specify", "spec-plan", "ci-test-pick"];

/** Runs `runAgents` with `out` and `err` collecting lines and `write` collecting bytes. */
async function run(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const chunks: Uint8Array[] = [];
	const code = await runAgents(argv, {
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		write: (chunk) => chunks.push(chunk),
	});
	return { code, stdout: out.join("\n"), stderr: err.join("\n"), bytes: Buffer.concat(chunks) };
}

describe("specsesh agents show prints a script's source", () => {
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

	it("show with no name prints its usage and exits 2", async () => {
		const { code, stderr } = await run(["show"]);
		expect(code).toBe(2);
		expect(stderr).toBe("usage: specsesh agents show <name>");
	});
});

describe("specsesh agents lists the bundled scripts", () => {
	it("--json is the catalogue without the sources", async () => {
		const { code, stdout } = await run(["--json"]);
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
		const { code, stdout } = await run([]);
		expect(code).toBe(0);
		const lines = stdout.split("\n");
		expect(lines[0]).toBe("| name | description | runs via | reads | writes |");
		for (const name of SHIPPED) expect(lines.some((l) => l.startsWith(`| \`${name}\` |`))).toBe(true);
	});

	it("an unknown subcommand or option prints usage and exits 2", async () => {
		expect((await run(["frobnicate"])).code).toBe(2);
		expect((await run(["--nope"])).code).toBe(2);
	});
});
