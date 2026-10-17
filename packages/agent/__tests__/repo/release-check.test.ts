import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "release-check.mjs");

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const temp = (prefix: string): string => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};

// A fixture tree holding just the two manifests the check reads.
const makeRoot = (agentVersion: string, specseshVersion: string): string => {
	const root = temp("release-check-");
	mkdirSync(join(root, "packages", "agent"), { recursive: true });
	mkdirSync(join(root, "packages", "specsesh"), { recursive: true });
	writeFileSync(join(root, "packages", "agent", "package.json"), JSON.stringify({ name: "@specsesh/agent", version: agentVersion }));
	writeFileSync(
		join(root, "packages", "specsesh", "package.json"),
		JSON.stringify({ name: "specsesh", version: specseshVersion, dependencies: { "@specsesh/agent": "workspace:*" } }),
	);
	return root;
};

// A bin directory whose `npm` only prints a version.
const fakeNpm = (version: string): string => {
	const bin = temp("release-check-npm-");
	const npm = join(bin, "npm");
	writeFileSync(npm, `#!/bin/sh\necho ${version}\n`);
	chmodSync(npm, 0o755);
	return bin;
};

const runCheck = (args: string[], { root, npmVersion }: { root: string; npmVersion: string }) => {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], {
		env: { ...process.env, RELEASE_CHECK_ROOT: root, PATH: fakeNpm(npmVersion) + delimiter + process.env["PATH"] },
		encoding: "utf8",
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("package/release: The release check holds the tag to both versions", () => {
	it("Scenario: A matching tag passes", () => {
		const result = runCheck(["v0.2.0"], { root: makeRoot("0.2.0", "0.2.0"), npmVersion: "11.6.0" });
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe("latest");
	});

	it("Scenario: A tag that differs from a manifest is refused", () => {
		const result = runCheck(["v0.2.1"], { root: makeRoot("0.2.0", "0.2.0"), npmVersion: "11.6.0" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("v0.2.1");
		expect(result.stderr).toContain("0.2.0");
	});

	it("Scenario: Unequal manifest versions are refused", () => {
		const result = runCheck(["v0.2.0"], { root: makeRoot("0.2.0", "0.1.0"), npmVersion: "11.6.0" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("@specsesh/agent");
		expect(result.stderr).toContain("specsesh");
		expect(result.stderr).toContain("0.2.0");
		expect(result.stderr).toContain("0.1.0");
	});

	it("Scenario: An old npm is refused", () => {
		const result = runCheck(["v0.2.0"], { root: makeRoot("0.2.0", "0.2.0"), npmVersion: "10.9.2" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("10.9.2");
		expect(result.stderr).toContain("11.5.1");
	});
});
