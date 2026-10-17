/**
 * change/cli: the old `agentscript-change` bin and `pnpm change` run the same command as
 * `specsesh change`. Both bins run as child processes from the repo root, on the built `dist`
 * (built first when missing, as `package/specsesh.test.ts` does).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const OLD_BIN = join(ROOT, "packages", "agent", "dist", "bin", "agentscript-change.js");
const SPECSESH_BIN = join(ROOT, "packages", "specsesh", "bin", "specsesh.js");
const CLI = join(ROOT, "packages", "agent", "dist", "cli", "index.js");

describe("change/cli: The old bin and pnpm change run the same command", () => {
	beforeAll(() => {
		if (!existsSync(OLD_BIN) || !existsSync(CLI)) {
			execFileSync("pnpm", ["--filter", "@specsesh/agent", "build"], { cwd: ROOT, stdio: "inherit" });
		}
	}, 120_000);

	it("Scenario: The old bin prints the specsesh usage", () => {
		const old = spawnSync(process.execPath, [OLD_BIN], { cwd: ROOT, input: "", encoding: "utf8" });
		const specsesh = spawnSync(process.execPath, [SPECSESH_BIN, "change"], { cwd: ROOT, input: "", encoding: "utf8" });
		expect(old.status, old.stderr).toBe(2);
		expect(specsesh.status, specsesh.stderr).toBe(2);
		expect(old.stderr).toBe(specsesh.stderr);
		expect(old.stderr.startsWith("usage:")).toBe(true);
		expect(old.stderr).toContain("specsesh change draft <change>");
		expect(old.stderr).not.toContain("agentscript-change");
		expect(old.stderr).not.toContain("pnpm change");
	});

	it("Scenario: pnpm change runs specsesh change", () => {
		const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["change"]).toBe("node packages/specsesh/bin/specsesh.js change");
	});
});
