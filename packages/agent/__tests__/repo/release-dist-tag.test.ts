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
	const root = temp("release-dist-tag-");
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
	const bin = temp("release-dist-tag-npm-");
	const npm = join(bin, "npm");
	writeFileSync(npm, `#!/bin/sh\necho ${version}\n`);
	chmodSync(npm, 0o755);
	return bin;
};

// A specsesh tarball laid out as `npm pack` lays it out, depending on @specsesh/agent at `dep`.
const makeTarball = (dep: string): string => {
	const dir = temp("release-dist-tag-tgz-");
	mkdirSync(join(dir, "package"));
	writeFileSync(
		join(dir, "package", "package.json"),
		JSON.stringify({ name: "specsesh", version: "0.2.0", dependencies: { "@specsesh/agent": dep } }),
	);
	const tgz = join(dir, "specsesh-0.2.0.tgz");
	const tar = spawnSync("tar", ["-czf", tgz, "-C", dir, "package"], { encoding: "utf8" });
	expect(tar.status, tar.stderr).toBe(0);
	return tgz;
};

const runCheck = (args: string[], { root, npmVersion = "11.6.0" }: { root: string; npmVersion?: string }) => {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], {
		env: { ...process.env, RELEASE_CHECK_ROOT: root, PATH: fakeNpm(npmVersion) + delimiter + process.env["PATH"] },
		encoding: "utf8",
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("package/release: The release check picks the dist-tag and checks the packed dependency", () => {
	it("Scenario: A prerelease goes to next", () => {
		const result = runCheck(["v0.2.0-rc.1"], { root: makeRoot("0.2.0-rc.1", "0.2.0-rc.1") });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe("next\n");
	});

	it("Scenario: A release goes to latest", () => {
		const result = runCheck(["v0.2.0"], { root: makeRoot("0.2.0", "0.2.0") });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe("latest\n");
	});

	it("Scenario: A packed range is refused", () => {
		for (const dep of ["workspace:*", "^0.2.0"]) {
			const result = runCheck(["v0.2.0", "--packed", makeTarball(dep)], { root: makeRoot("0.2.0", "0.2.0") });
			expect(result.status, dep).toBe(1);
			expect(result.stderr).toContain(dep);
			expect(result.stdout).toBe("");
		}
	});

	it("a packed dependency pinned to the version passes", () => {
		const result = runCheck(["v0.2.0", "--packed", makeTarball("0.2.0")], { root: makeRoot("0.2.0", "0.2.0") });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe("latest\n");
	});
});
