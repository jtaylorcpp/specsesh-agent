import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("task/headless: The repo wires the runner in (its own task loop is paused; see parked.md)", () => {
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

});
