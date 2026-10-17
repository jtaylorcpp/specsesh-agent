import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
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
			model: "opus",
			script: "task-delegate",
			checks: ["pnpm check", "pnpm test"],
			allow: ["pnpm", "node"],
			maxIterations: 8,
			escalateTo: "principal",
			requireCleanTree: true,
			worktreeSetup: ["pnpm install --frozen-lockfile --prefer-offline"],
			deleteFiles: true,
		});
		const raw = JSON.parse(readFileSync(join(REPO, "agentscript.config.json"), "utf8")) as { delegates: unknown };
		expect(raw.delegates).toEqual({ claude_code: { runner: "claude-code", model: "opus", allow: ["pnpm", "node"], context: ["CLAUDE.md"] } });
		// Every value resolves: the script is the bundled task-delegate, the grant's context file exists.
		const settings = resolveRunSettings({}, {}, config, REPO);
		expect(settings.script.label).toBe("task-delegate");
		expect(config.delegates["claude_code"]?.["context"]).toEqual([join(REPO, "CLAUDE.md")]);
		expect(readFileSync(join(REPO, "CLAUDE.md"), "utf8")).toContain("# agentscript");
	});
});

describe("task/headless: The repo wires the runner in", () => {
	// Both bins run from packages/agent/dist.
	beforeAll(() => {
		if (!existsSync(join(REPO, "packages", "agent", "dist", "bin", "agentscript-task.js"))) {
			execFileSync("pnpm", ["--filter", "@specsesh/agent", "build"], { cwd: REPO, stdio: "inherit" });
		}
	}, 120_000);

	it("Scenario: The database directory is ignored", () => {
		const lines = readFileSync(join(REPO, ".gitignore"), "utf8").split("\n");
		expect(lines).toContain(".agentscript/");
	});

	it("Scenario: pnpm task runs specsesh task", () => {
		const scripts = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["task"]).toBe("node packages/specsesh/bin/specsesh.js task");
		const dir = mkdtempSync(join(tmpdir(), "task-script-"));
		try {
			const missing = join(dir, "missing.sqlite");
			const status = spawnSync(process.execPath, ["packages/specsesh/bin/specsesh.js", "task", "status", "--db", missing], { cwd: REPO, encoding: "utf8" });
			expect(status.status).toBe(0);
			expect(status.stdout.trim()).toBe(`no loops in ${missing}`);
			expect(existsSync(missing)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("Scenario: The old task bin prints the specsesh usage", () => {
		const old = spawnSync(process.execPath, ["packages/agent/dist/bin/agentscript-task.js"], { cwd: REPO, encoding: "utf8" });
		const specsesh = spawnSync(process.execPath, ["packages/specsesh/bin/specsesh.js", "task"], { cwd: REPO, encoding: "utf8" });
		expect(old.status, old.stderr).toBe(2);
		expect(specsesh.status, specsesh.stderr).toBe(2);
		expect(old.stderr).toBe(specsesh.stderr);
		expect(old.stderr).toMatch(/^usage:/);
		expect(old.stderr).not.toContain("agentscript-task");
		expect(old.stderr).not.toContain("pnpm task");
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
