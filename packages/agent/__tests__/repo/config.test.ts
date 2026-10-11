import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveRunSettings } from "../../src/task/config.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("task/headless: This repo ships a config for its own tasks", () => {
	it("Scenario: The shipped config is valid", () => {
		const config = loadConfig(join(REPO, "packages", "agent"));
		expect(config.path).toBe(join(REPO, "agentscript.config.json"));
		expect(config.task).toEqual({
			changesDir: "openspec/changes",
			db: ".agentscript/task-loops.sqlite",
			provider: "claude-code",
			model: "claude-haiku-4-5",
			delegateModel: "sonnet",
			script: "task-delegate",
			checks: ["pnpm check", "pnpm test"],
			allow: ["pnpm", "node"],
			maxIterations: 3,
			escalateTo: "principal",
			delegateContext: ["CLAUDE.md"],
			requireCleanTree: true,
			worktreeSetup: ["pnpm install --frozen-lockfile --offline"],
		});
		// Every value resolves: the script is the bundled task-delegate, the context file exists.
		const settings = resolveRunSettings({}, {}, config, REPO);
		expect(settings.script.label).toBe("task-delegate");
		expect(readFileSync(settings.delegateContext[0] as string, "utf8")).toContain("# agentscript");
	});
});

describe("task/headless: The repo wires the runner in", () => {
	it("Scenario: The database directory is ignored", () => {
		const lines = readFileSync(join(REPO, ".gitignore"), "utf8").split("\n");
		expect(lines).toContain(".agentscript/");
	});

	it("the root scripts run the built bin, with run implied", () => {
		const scripts = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["task"]).toBe("node scripts/task.mjs");
		expect(scripts["test:live"]).toBe("pnpm --filter @specsesh/agent test:live");
		const dir = mkdtempSync(join(tmpdir(), "task-wrapper-"));
		try {
			const wrapper = join(REPO, "scripts", "task.mjs");
			const status = spawnSync(process.execPath, [wrapper, "status", "--db", join(dir, "none.sqlite")], { cwd: dir, encoding: "utf8" });
			expect(status.stdout.trim()).toBe(`no loops in ${join(dir, "none.sqlite")}`);
			// `<change> <task>` becomes `run <change> <task>`: here refused for its missing database, by run's usage.
			const run = spawnSync(process.execPath, [wrapper, "some-change", "1.1"], { cwd: dir, encoding: "utf8" });
			expect(run.status).toBe(2);
			expect(run.stderr).toContain("run needs --db");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLAUDE.md says how to run a task", () => {
		const text = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
		const section = text.slice(text.indexOf("## Running a task"));
		expect(text).toContain("## Running a task");
		for (const needle of ["pnpm task <change-id> <task-id>", "--next", "--worktree", "git worktree remove", "pnpm task status", "pnpm task answer", "--allow-dirty", "never commits"]) {
			expect(section, needle).toContain(needle);
		}
	});
});
