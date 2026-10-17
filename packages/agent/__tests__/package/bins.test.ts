import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = join(AGENT_DIR, "..", "..");
const SCRIPT = join(AGENT_DIR, "scripts", "chmod-bins.mjs");
const manifest = JSON.parse(readFileSync(join(AGENT_DIR, "package.json"), "utf8")) as { bin: Record<string, string> };

describe("package/distribution: Every bin is executable after a build", () => {
	beforeAll(() => {
		if (Object.values(manifest.bin).some((target) => !existsSync(join(AGENT_DIR, target)))) {
			execFileSync("pnpm", ["--filter", "@specsesh/agent", "build"], { cwd: ROOT, stdio: "inherit" });
		} else {
			// `pnpm check` or `pnpm build` ran the script already; running it again is what they do.
			execFileSync(process.execPath, [SCRIPT], { cwd: AGENT_DIR });
		}
	});

	it("Scenario: Every built bin is executable", () => {
		expect(Object.keys(manifest.bin).length).toBeGreaterThan(0);
		for (const target of Object.values(manifest.bin)) {
			expect(statSync(join(AGENT_DIR, target)).mode & 0o111, target).toBe(0o111);
		}
	});

	it("Scenario: A built bin runs directly", () => {
		const ran = spawnSync(join(AGENT_DIR, "dist", "bin", "agentscript-task.js"), [], { encoding: "utf8" });
		expect(ran.error).toBeUndefined();
		expect(ran.status).toBe(2);
		expect(ran.stderr.startsWith("usage:")).toBe(true);
	});

	it("Scenario: A missing bin target is named", () => {
		const dir = mkdtempSync(join(tmpdir(), "chmod-bins-"));
		try {
			const path = join(dir, "package.json");
			writeFileSync(path, JSON.stringify({ name: "x", bin: { gone: "./bin/gone.js" } }));
			const ran = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, CHMOD_BINS_MANIFEST: path } });
			expect(ran.status).toBe(1);
			expect(ran.stderr).toContain("./bin/gone.js");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("Scenario: The specsesh bin is committed executable", () => {
		const line = execFileSync("git", ["ls-files", "-s", "packages/specsesh/bin/specsesh.js"], { cwd: ROOT, encoding: "utf8" });
		expect(line.split(" ")[0]).toBe("100755");
	});
});

describe("package/distribution: The agent readme sends command-line users to specsesh", () => {
	it("Scenario: The install block names specsesh", () => {
		const readme = readFileSync(join(AGENT_DIR, "README.md"), "utf8");
		const block = /```[^\n]*\n([\s\S]*?)```/.exec(readme)?.[1] ?? "";
		for (const needle of ["npm install -g specsesh", "npx specsesh", "npm install @specsesh/agent"]) expect(block, needle).toContain(needle);
	});
});
