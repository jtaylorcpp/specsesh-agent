import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextTask, openChanges, resolveChange } from "../../src/task/resolve.js";
import { cli, fauxModels, storedLoops, workdir } from "./cli-helpers.js";
import { baselineDir, cleanTemps, temp, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

/** A root whose `openspec/changes/` holds `fixture-live-task` (a tiny change), `other` and an `archive/`. */
function changesRoot(config: Record<string, unknown> | null = { db: ".agentscript/task-loops.sqlite" }) {
	const root = temp("task-resolve-");
	const changes = join(root, "openspec", "changes");
	cpSync(tinyChange(), join(changes, "fixture-live-task"), { recursive: true });
	mkdirSync(join(changes, "other"), { recursive: true });
	mkdirSync(join(changes, "archive", "2026-01-01-old"), { recursive: true });
	if (config !== null) writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task: config }));
	return { root, changes };
}

describe("task/headless: A change is given by id or by path", () => {
	it("Scenario: An id resolves under changesDir", async () => {
		const { root, changes } = changesRoot();
		expect(resolveChange("fixture-live-task", changes, root)).toEqual({ dir: join(changes, "fixture-live-task"), id: "fixture-live-task" });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", "fixture-live-task", "1.1", "--script", script, ...env.args], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(join(root, ".agentscript", "task-loops.sqlite"));
		expect(inputs[0]?.tasksPath).toBe(join(changes, "fixture-live-task", "tasks.md"));
	});

	it("Scenario: An unknown id lists the open changes", async () => {
		const { root } = changesRoot();
		const r = await cli(["run", "no-such-change", "1.1"], fauxModels(), { cwd: root });
		expect(r.code).toBe(2);
		expect(r.err).toContain("no-such-change");
		expect(r.err).toContain("fixture-live-task, other");
		expect(r.err).not.toContain("archive");
		expect(existsSync(join(root, ".agentscript"))).toBe(false);
	});

	it("a value with a separator, or naming an existing directory, is a path", () => {
		const { root, changes } = changesRoot();
		const dir = tinyChange();
		expect(resolveChange(dir, changes, root).dir).toBe(dir);
		expect(resolveChange("openspec/changes/other", changes, root)).toEqual({ dir: join(changes, "other"), id: "other" });
		mkdirSync(join(root, "here"));
		expect(resolveChange("here", changes, root)).toEqual({ dir: join(root, "here"), id: "here" });
		expect(() => resolveChange("./missing/dir", changes, root)).toThrow(/missing\/dir does not exist/);
		expect(openChanges(join(root, "nowhere"))).toEqual([]);
	});
});

describe("task/headless: --next picks the first unticked task", () => {
	it("Scenario: --next skips ticked tasks", async () => {
		const dir = tinyChange({ tasks: "## 1\n\n- [x] 1.1 done\n- [ ] 1.2 next one\n- [ ] 1.3 later\n" });
		expect(nextTask(dir)).toBe("1.2");
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", dir, "--next", "--db", db, "--script", script, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		expect((await storedLoops(db)).inputs[0]?.task).toBe("1.2");
	});

	it("Scenario: A finished change exits 0 with a message", async () => {
		const { root, changes } = changesRoot();
		writeFileSync(join(changes, "fixture-live-task", "tasks.md"), "## 1\n\n- [x] 1.1 done\n- [x] 1.2 also\n");
		const r = await cli(["run", "fixture-live-task", "--next"], fauxModels(), { cwd: root });
		expect(r.code).toBe(0);
		expect(r.out).toBe("no unticked task in fixture-live-task");
		expect(existsSync(join(root, ".agentscript", "task-loops.sqlite"))).toBe(false);
	});
});

describe("task/cli: run takes a change and a task, with the database from flag or config", () => {
	it("Scenario: No database from flag or config prints usage", async () => {
		const { root } = changesRoot(null);
		const r = await cli(["run", "fixture-live-task", "1.1"], fauxModels(), { cwd: root });
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
	});

	it("Scenario: run without a task id prints usage", async () => {
		const { db } = workdir();
		const r = await cli(["run", baselineDir(), "--db", db]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
		expect(existsSync(db)).toBe(false);
	});

	it("Scenario: A task id and --next together print usage", async () => {
		const { root } = changesRoot();
		const r = await cli(["run", "fixture-live-task", "1.1", "--next", "--db", "loops.sqlite"], fauxModels(), { cwd: root });
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
		expect(existsSync(join(root, "loops.sqlite"))).toBe(false);
	});

	it("Scenario: The config supplies the database", async () => {
		const { root } = changesRoot();
		const sub = join(root, "packages", "agent");
		mkdirSync(sub, { recursive: true });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", "fixture-live-task", "1.1", "--script", script, ...env.args], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		const db = join(root, ".agentscript", "task-loops.sqlite");
		expect((await storedLoops(db)).loops).toHaveLength(1);
		expect(r.errLines[0]).toContain(`--db ${db}`);
	});

	it("a missing change, or an extra positional, prints usage", async () => {
		expect((await cli(["run", "--db", "x"])).code).toBe(2);
		const r = await cli(["run", "a", "1.1", "extra", "--db", "x"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
	});
});
