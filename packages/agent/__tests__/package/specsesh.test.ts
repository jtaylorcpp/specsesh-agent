import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPECSESH_DIR = join(AGENT_DIR, "..", "specsesh");
const ROOT = join(AGENT_DIR, "..", "..");
const BIN = join(SPECSESH_DIR, "bin", "specsesh.js");

function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

const agent = readJson(join(AGENT_DIR, "package.json"));
const specsesh = readJson(join(SPECSESH_DIR, "package.json"));
const binText = readFileSync(BIN, "utf8");
const readme = readFileSync(join(SPECSESH_DIR, "README.md"), "utf8");

// The Node dependencies specsesh carries, each at the agent's dev version.
const NODE_DEPS = ["@earendil-works/pi-ai", "@earendil-works/pi-durable", "@earendil-works/chord", "@modelcontextprotocol/sdk"];

function importSpecifiers(source: string): string[] {
	const patterns = [
		/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm,
		/^\s*import\s*['"]([^'"]+)['"]/gm,
		/import\(\s*['"]([^'"]+)['"]/g,
		/require\(\s*['"]([^'"]+)['"]/g,
	];
	const found = new Set<string>();
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) found.add(match[1] as string);
	}
	// A `require(` with a non-literal argument still counts as an import.
	if (/require\(\s*[^'"\s]/.test(source)) found.add("<require>");
	return [...found];
}

describe("specsesh package", () => {
	it("Scenario: The specsesh manifest is exact", () => {
		expect(specsesh.bin).toEqual({ specsesh: "./bin/specsesh.js" });
		expect(specsesh.files).toEqual(["bin", "README.md", "LICENSE"]);
		expect(specsesh.exports).toEqual({ "./package.json": "./package.json" });
		expect(Object.keys(specsesh.dependencies).sort()).toEqual(["@specsesh/agent", ...NODE_DEPS].sort());
		expect(specsesh.dependencies["@specsesh/agent"]).toBe("workspace:*");
		expect(specsesh.peerDependencies).toBeUndefined();
		for (const name of NODE_DEPS) {
			expect(agent.devDependencies[name], name).toBeDefined();
			expect(specsesh.dependencies[name], name).toBe(agent.devDependencies[name]);
		}
	});

	it("Scenario: The bin imports only the cli entry", () => {
		expect(binText.split("\n")[0]).toBe("#!/usr/bin/env node");
		expect(importSpecifiers(binText)).toEqual(["@specsesh/agent/cli"]);
	});

	describe("workspace bin", () => {
		beforeAll(() => {
			const cli = join(AGENT_DIR, agent.exports["./cli"].import);
			if (!existsSync(cli)) {
				execFileSync("pnpm", ["--filter", "@specsesh/agent", "build"], { cwd: ROOT, stdio: "inherit" });
			}
		}, 120_000);

		it("Scenario: The workspace bin prints the version", () => {
			const result = spawnSync(process.execPath, [BIN, "--version"], { cwd: ROOT, encoding: "utf8" });
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout.trim(), result.stderr).toBe(`specsesh ${agent.version}`);
			expect(specsesh.version).toBe(agent.version);
		});
	});

	it("Scenario: The specsesh readme shows how to run it", () => {
		for (const text of [
			"npx specsesh --help",
			"npm install --save-dev specsesh",
			"specsesh agent",
			"specsesh durable",
			"specsesh task",
			"specsesh change",
			"22.19",
		]) {
			expect(readme).toContain(text);
		}
	});
});
