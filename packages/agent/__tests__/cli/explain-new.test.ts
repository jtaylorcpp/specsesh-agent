/**
 * package/explain: `specsesh new agent`, through `runNew` and then `runCheck`. The route
 * from `main` comes with the wiring task.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEW_TEMPLATE, NEW_USAGE, checkSource, runCheck, runNew } from "../../src/cli/explain.js";

/** Runs `runNew` in `cwd` with `out` and `err` collecting lines. */
async function run(argv: string[], cwd: string) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await runNew(argv, { cwd, out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

async function check(file: string) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await runCheck([file], { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

const empty = () => mkdtempSync(join(tmpdir(), "specsesh-new-"));

describe("specsesh new agent scaffolds a script that checks", () => {
	it("Scenario: Scaffold then check", async () => {
		const dir = empty();
		const { code, stdout, stderr } = await run(["agent", "triage"], dir);
		expect(stderr).toBe("");
		expect(code).toBe(0);
		const file = join(dir, "triage.agent");
		expect(stdout).toContain(`wrote ${file}`);
		const text = readFileSync(file, "utf8");
		expect(text).toContain('agent_name: "triage"');
		expect(text).not.toContain("{{AGENT_NAME}}");
		expect(await check(file)).toEqual({ code: 0, stdout: "", stderr: "" });
	});

	it("Scenario: No overwrite", async () => {
		const dir = empty();
		const file = join(dir, "triage.agent");
		writeFileSync(file, "sentinel");
		const { code, stderr } = await run(["agent", "triage"], dir);
		expect(code).toBe(1);
		expect(stderr).toContain(file);
		expect(readFileSync(file, "utf8")).toBe("sentinel");
	});

	it("--out writes to the named path", async () => {
		const dir = empty();
		mkdirSync(join(dir, "sub"));
		const { code } = await run(["agent", "triage", "--out", "sub/x.agent"], dir);
		expect(code).toBe(0);
		expect(existsSync(join(dir, "triage.agent"))).toBe(false);
		expect(readFileSync(join(dir, "sub", "x.agent"), "utf8")).toContain('agent_name: "triage"');
	});

	it("the raw template checks, placeholder and all", () => {
		expect(checkSource(NEW_TEMPLATE, readFileSync(NEW_TEMPLATE, "utf8"))).toEqual([]);
	});

	it("with no arguments, or a bad name, it prints its usage and exits 2", async () => {
		expect(NEW_USAGE).toBe("usage: specsesh new agent <name> [--out <path>]");
		for (const argv of [[], ["agent"], ["script", "x"], ["agent", "1bad"], ["agent", "x", "--out"]]) {
			const dir = empty();
			const { code, stdout, stderr } = await run(argv, dir);
			expect(code, argv.join(" ")).toBe(2);
			expect(stdout).toBe("");
			expect(stderr).toContain(NEW_USAGE);
		}
	});
});
