/**
 * package/explain: `specsesh agent check`, through `main`.
 */

import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_DELEGATES, BUNDLED_DIR } from "../../src/cli/bundled.js";
import { CHECK_USAGE, checkSource } from "../../src/cli/explain.js";
import { main } from "../../src/cli/index.js";

/** Runs `main(["agent", "check", …argv])` with `out` and `err` collecting lines. */
async function run(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(["agent", "check", ...argv], { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** Writes `source` to a fresh temp directory and returns its path. */
function scratch(name: string, source: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "specsesh-check-")), name);
	writeFileSync(path, source);
	return path;
}

const HEADER = 'config:\n    agent_name: "x"\n    description: "d"\n\n';

describe("specsesh agent check validates scripts without running them", () => {
	it("Scenario: Bundled scripts pass", async () => {
		const files = readdirSync(BUNDLED_DIR)
			.filter((f) => f.endsWith(".agent"))
			.map((f) => join(BUNDLED_DIR, f));
		expect(files.length).toBeGreaterThan(0);
		const { code, stdout, stderr } = await run(files);
		expect(stdout).toBe("");
		expect(stderr).toBe("");
		expect(code).toBe(0);
		// The delegate scripts ship as source text, not files.
		for (const [name, source] of Object.entries(BUNDLED_DELEGATES)) expect(checkSource(name, source)).toEqual([]);
	});

	it("Scenario: Unsupported construct named", async () => {
		// Line 9, column 20: `@context` inside the interpolation.
		const file = scratch(
			"context.agent",
			`${HEADER}subagent t:\n    description: "d"\n    reasoning:\n        instructions: ->\n            | Hi {!@context.foo}.\n`,
		);
		const { code, stdout } = await run([file]);
		expect(code).toBe(1);
		expect(stdout).toBe(
			`${file}:9:20  @context, in subagent "t", is unsupported by this runtime (see \`specsesh agent language subset\`) [construct: @context]`,
		);
		const json = await run([file, "--json"]);
		expect(json.code).toBe(1);
		expect(JSON.parse(json.stdout)).toEqual([expect.objectContaining({ file, line: 9, col: 20, construct: "@context" })]);
	});

	it("Scenario: Syntax error located", async () => {
		// Line 6: `stage` has a modifier and a default but no type.
		const file = scratch(
			"untyped.agent",
			`${HEADER}variables:\n    stage: mutable = "a"\n\nsubagent t:\n    description: "d"\n    reasoning:\n        instructions: ->\n            | Draft {!@variables.stage}.\n`,
		);
		const { code, stdout } = await run([file]);
		expect(code).toBe(1);
		const lines = stdout.split("\n");
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(line.startsWith(`${file}:6:`)).toBe(true);
	});

	it("Scenario: check with no files", async () => {
		const { code, stdout, stderr } = await run([]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
		expect(stderr).toBe(CHECK_USAGE);
		expect(CHECK_USAGE).toBe("usage: specsesh agent check <file.agent>…");
	});

	it("an unreadable file is a problem, and the other files are still checked", async () => {
		const missing = join(mkdtempSync(join(tmpdir(), "specsesh-check-")), "missing.agent");
		const good = join(BUNDLED_DIR, "task.agent");
		const { code, stdout } = await run([missing, good]);
		expect(code).toBe(1);
		expect(stdout).toMatch(new RegExp(`^${missing.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}  cannot read: `));
		expect(stdout.split("\n")).toHaveLength(1);
	});

	it("an undeclared variable is a problem", async () => {
		const file = scratch(
			"undeclared.agent",
			`${HEADER}subagent t:\n    description: "d"\n    reasoning:\n        instructions: ->\n            | Hi {!@variables.nope}.\n`,
		);
		const { code, stdout } = await run([file]);
		expect(code).toBe(1);
		expect(stdout).toContain("@variables.nope");
	});
});
