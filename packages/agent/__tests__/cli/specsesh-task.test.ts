/**
 * package/command: `specsesh task` inserts `run` before a change, as `pnpm task` does, and
 * passes a task command through. Each side runs `agentscript-task`'s `main` in its own temp
 * repository, and temp paths are replaced with `<tmp>` before comparing.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main as taskMain } from "../../src/bin/agentscript-task.js";
import { main, type CliDeps } from "../../src/cli/index.js";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh repository with an empty `openspec/changes/` and a config naming a database, so `run` gets as far as the change. */
function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "specsesh-task-"));
	dirs.push(dir);
	mkdirSync(join(dir, "openspec", "changes"), { recursive: true });
	writeFileSync(join(dir, "agentscript.config.json"), JSON.stringify({ task: { db: "loops.sqlite" } }));
	return dir;
}

/** `deps` in a fresh repository whose `out` and `err` collect lines, with `<tmp>` for the repository's path. */
function capture() {
	const cwd = repo();
	const out: string[] = [];
	const err: string[] = [];
	const deps: CliDeps = { cwd, env: {}, out: (line) => out.push(line), err: (line) => err.push(line) };
	const text = (lines: string[]) => lines.join("\n").replaceAll(cwd, "<tmp>");
	return { cwd, deps, out: () => text(out), err: () => text(err) };
}

describe("task implies run as pnpm task does", () => {
	it("Scenario: A change and a task id imply run", async () => {
		const routed = capture();
		const direct = capture();
		const code = await main(["task", "no-such-change", "1.1"], routed.deps);
		expect(code).toBe(await taskMain(["run", "no-such-change", "1.1"], direct.deps));
		expect(code).not.toBe(0);
		expect(routed.err()).toContain('no change "no-such-change"');
		expect(routed.err()).toBe(direct.err());
		expect(routed.out()).toBe(direct.out());
	});

	it("Scenario: A task command passes through", async () => {
		const routed = capture();
		const direct = capture();
		const asRun = capture();
		const code = await main(["task", "status", "--db", join(routed.cwd, "missing.db")], routed.deps);
		expect(code).toBe(await taskMain(["status", "--db", join(direct.cwd, "missing.db")], direct.deps));
		expect(routed.out()).toBe(direct.out());
		expect(routed.err()).toBe(direct.err());
		// Not of `run`: had `run` been inserted, the result would be this one.
		const runCode = await taskMain(["run", "status", "--db", join(asRun.cwd, "missing.db")], asRun.deps);
		expect([runCode, asRun.out(), asRun.err()]).not.toEqual([code, routed.out(), routed.err()]);
	});
});
