/**
 * package/explain: `specsesh language [topic]`, through `runLanguage`. The route from `main`
 * comes with the wiring task; the topic texts come with `add-agent-language-docs`, so these
 * tests point `dir` at a temp directory rather than at what ships.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLanguage } from "../../src/cli/explain.js";
import { SUPPORTED_CONSTRUCTS } from "../../src/interpreter/subset.js";

const TOPICS = ["overview", "config", "system", "variables", "subagents", "prompts", "interpolation", "logic", "outputs", "actions", "run", "refused", "subset"];

/** Runs `runLanguage` with `out` and `err` collecting lines, over `dir` (default an empty temp directory). */
async function run(argv: string[], dir = mkdtempSync(join(tmpdir(), "language-"))) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await runLanguage(argv, { out: (line) => out.push(line), err: (line) => err.push(line), dir });
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("specsesh language prints the reference by topic", () => {
	it("Scenario: Subset matches the interpreter", async () => {
		const { code, stdout } = await run(["subset", "--json"]);
		expect(code).toBe(0);
		const entries = JSON.parse(stdout) as Array<{ id: string }>;
		expect(entries.map((e) => e.id)).toEqual(SUPPORTED_CONSTRUCTS.map((c) => c.id));
	});

	it("Scenario: Topic list", async () => {
		const { code, stdout } = await run([]);
		expect(code).toBe(0);
		const lines = stdout.split("\n");
		expect(lines).toHaveLength(TOPICS.length);
		lines.forEach((line, i) => expect(line).toMatch(new RegExp(`^- \`${TOPICS[i]}\` — \\S`)));

		const json = JSON.parse((await run(["--json"])).stdout) as Array<{ name: string; summary: string }>;
		expect(json.map((t) => t.name)).toEqual(TOPICS);
		for (const t of json) expect(t.summary).not.toBe("");
	});

	it("a topic file's first line is its summary", async () => {
		const dir = mkdtempSync(join(tmpdir(), "language-"));
		writeFileSync(join(dir, "config.md"), "# Name the agent in its config block.\n\nMore.\n");
		const { stdout } = await run([], dir);
		expect(stdout.split("\n")[1]).toBe("- `config` — Name the agent in its config block.");
	});

	it("an unknown topic exits 2 and lists the topics", async () => {
		const { code, stdout, stderr } = await run(["nope"]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
		expect(stderr).toBe(`unknown topic "nope"; topics: ${TOPICS.join(", ")}`);
	});

	it("a topic prints its file as is", async () => {
		const dir = mkdtempSync(join(tmpdir(), "language-"));
		writeFileSync(join(dir, "logic.md"), "Logic lines.\n\n```agent\nset @variables.x = 1\n```\n");
		expect((await run(["logic"], dir)).stdout).toBe("Logic lines.\n\n```agent\nset @variables.x = 1\n```");
		expect(JSON.parse((await run(["logic", "--json"], dir)).stdout)).toEqual({
			topic: "logic",
			markdown: "Logic lines.\n\n```agent\nset @variables.x = 1\n```\n",
		});
	});

	it("a topic whose file has not shipped prints the subset table and a README pointer", async () => {
		const { code, stdout } = await run(["variables"]);
		expect(code).toBe(0);
		expect(stdout).toContain("`variables` topic has not shipped");
		for (const c of SUPPORTED_CONSTRUCTS) expect(stdout).toContain(`| \`${c.id}\` |`);
		expect(stdout).toMatch(/README: .*README\.md$/);
	});

	it("subset is a table generated from the interpreter", async () => {
		const lines = (await run(["subset"])).stdout.split("\n");
		expect(lines[0]).toBe("| id | construct | node kinds |");
		expect(lines.slice(2).map((l) => /^\| `([^`]+)` \|/.exec(l)?.[1])).toEqual(SUPPORTED_CONSTRUCTS.map((c) => c.id));
	});

	it("an unknown option or a second topic prints usage and exits 2", async () => {
		expect((await run(["--nope"])).code).toBe(2);
		const { code, stderr } = await run(["config", "logic"]);
		expect(code).toBe(2);
		expect(stderr).toBe("usage: specsesh language [topic] [--json]");
	});
});
