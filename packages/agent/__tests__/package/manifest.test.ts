import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// dist/ is built by the suite's global setup (`pnpm build`).
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = join(PKG_DIR, "..", "..");
const MANIFEST_TEXT = readFileSync(join(PKG_DIR, "package.json"), "utf8");
const manifest = JSON.parse(MANIFEST_TEXT);

const ENTRIES = ["authoring", "interpreter", "pi", "claude-code", "durable", "node", "cloudflare", "openspec", "task"];
// One entry per layer, then the command.
const EXPORTS = [...ENTRIES, "cli"];
const SF = {
	"@sf-agentscript/agentforce-dialect": "2.53.0",
	"@sf-agentscript/agentscript-dialect": "3.4.0",
	"@sf-agentscript/language": "3.2.3",
	"@sf-agentscript/parser-javascript": "3.1.3",
};
const PEERS = {
	"@earendil-works/pi-ai": "^1.1.0",
	"@earendil-works/pi-durable": "^1.1.0",
	"@earendil-works/chord": "^1.1.0",
	agents: "^0.28.0",
};

// [directory under packages/, package name]: the two that publish.
const PACKAGES = [
	["agent", "@specsesh/agent"],
	["specsesh", "specsesh"],
] as const;
const REPO_URL = "git+https://github.com/jtaylorcpp/specsesh-agent.git";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(path) : [path];
	});
}

describe("Two packages publish at one version under Apache-2.0", () => {
	it("Scenario: Both manifests identify their package", () => {
		for (const [dir, name] of PACKAGES) {
			const pkg = readJson(join(ROOT, "packages", dir, "package.json"));
			expect(pkg.name).toBe(name);
			expect(pkg.license, name).toBe("Apache-2.0");
			expect(pkg.type, name).toBe("module");
			expect(pkg.engines?.node, name).toBe(">=22.19.0");
			expect(pkg.repository, name).toEqual({ type: "git", url: REPO_URL, directory: `packages/${dir}` });
			expect(pkg.private === undefined || pkg.private === false, `${name} is private`).toBe(true);
		}
		const agent = readJson(join(ROOT, "packages", "agent", "package.json"));
		const specsesh = readJson(join(ROOT, "packages", "specsesh", "package.json"));
		expect(agent.version).toMatch(SEMVER);
		expect(specsesh.version).toBe(agent.version);
	});

	it("Scenario: The license files are Apache 2.0", () => {
		for (const [dir] of PACKAGES) {
			const license = readFileSync(join(ROOT, "packages", dir, "LICENSE"), "utf8");
			expect(license, dir).toContain("Apache License");
			expect(license, dir).toContain("Version 2.0, January 2004");
			// The full text, not a stub naming it.
			expect(license, dir).toContain("END OF TERMS AND CONDITIONS");
		}
	});

	it("Scenario: Only the two packages publish", () => {
		const examples = readdirSync(join(ROOT, "examples"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(ROOT, "examples", entry.name, "package.json"))
			.filter((path) => existsSync(path));
		expect(examples.length).toBeGreaterThan(0);
		for (const path of [join(ROOT, "package.json"), ...examples]) {
			expect(readJson(path).private, `${path} is publishable`).toBe(true);
		}
		// And packages/ holds only the two that publish.
		expect(readdirSync(join(ROOT, "packages")).sort()).toEqual(PACKAGES.map(([dir]) => dir).sort());
	});
});

describe("The package exports one entry per layer and the command", () => {
	it("Scenario: The exports map is exact", () => {
		expect(Object.keys(manifest.exports)).toEqual(EXPORTS.map((entry) => `./${entry}`));
		expect(manifest.exports["."]).toBeUndefined();
		expect(manifest.exports["./package.json"]).toBeUndefined();
		expect(manifest.exports["./durable"]).toEqual({
			types: "./dist/durable/index.d.ts",
			import: "./dist/durable/index.js",
		});
		expect(manifest.exports["./node"]).toEqual({
			types: "./dist/node/index.d.ts",
			import: "./dist/node/index.js",
		});
		expect(manifest.exports["./openspec"]).toEqual({
			types: "./dist/openspec/index.d.ts",
			import: "./dist/openspec/index.js",
		});
		expect(manifest.exports["./task"]).toEqual({
			types: "./dist/task/index.d.ts",
			import: "./dist/task/index.js",
		});
		expect(manifest.exports["./cli"]).toEqual({
			types: "./dist/cli/index.d.ts",
			import: "./dist/cli/index.js",
		});
		for (const entry of EXPORTS) {
			expect(manifest.exports[`./${entry}`]).toEqual({
				types: `./dist/${entry}/index.d.ts`,
				import: `./dist/${entry}/index.js`,
			});
		}
	});
});

describe("The tarball holds only the build, the readme and the license", () => {
	it("declares files as dist, docs, templates, README.md and LICENSE", () => {
		expect(manifest.files).toEqual(["dist", "docs", "templates", "README.md", "LICENSE"]);
	});
});

describe("The four CLIs are compiled bins", () => {
	it("Scenario: The bins are wired to compiled files", () => {
		expect(manifest.bin).toEqual({
			"agentscript-pi": "./dist/bin/agentscript-pi.js",
			"agentscript-durable": "./dist/bin/agentscript-durable.js",
			"agentscript-task": "./dist/bin/agentscript-task.js",
			"agentscript-change": "./dist/bin/agentscript-change.js",
		});
		for (const target of Object.values(manifest.bin) as string[]) {
			const path = join(PKG_DIR, target);
			expect(existsSync(path), `${target} is missing`).toBe(true);
			expect(readFileSync(path, "utf8").startsWith("#!/usr/bin/env node\n"), `${target} has no shebang`).toBe(true);
		}
	});

	it("Scenario: tsx is gone", () => {
		expect(MANIFEST_TEXT).not.toMatch(/tsx/);
		const dist = filesUnder(join(PKG_DIR, "dist"));
		expect(dist.length).toBeGreaterThan(0);
		for (const file of dist) expect(readFileSync(file, "utf8"), `${file} mentions tsx`).not.toMatch(/tsx/);
	});
});

describe("Required dependencies are only the exact-pinned language packages and the schema library", () => {
	it("Scenario: The language packages are pinned exactly", () => {
		const sf = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => name.startsWith("@sf-agentscript/")));
		expect(sf).toEqual(SF);
		for (const version of Object.values(sf)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("Scenario: The schema library is the only other dependency", () => {
		expect(manifest.dependencies).toEqual({ ...SF, typebox: "1.3.27" });
		expect(manifest.dependencies.typebox).toMatch(/^\d+\.\d+\.\d+$/);
		expect(manifest.dependencies.zod).toBeUndefined();
	});
});

describe("The layer libraries are optional peers", () => {
	it("Scenario: Every peer is optional", () => {
		expect(manifest.peerDependencies).toEqual(PEERS);
		expect(Object.keys(manifest.peerDependenciesMeta).sort()).toEqual(Object.keys(PEERS).sort());
		for (const name of Object.keys(PEERS)) {
			expect(manifest.peerDependenciesMeta[name]?.optional, `${name} is not optional`).toBe(true);
			// Installed for the workspace's own tests, at the versions they run on.
			expect(manifest.devDependencies[name], `${name} is not a dev dependency`).toMatch(/^\d+\.\d+\.\d+$/);
		}
	});
});

describe("No published text names the old package", () => {
	it("Scenario: The old name is gone", () => {
		const scanned = [
			...filesUnder(join(PKG_DIR, "src")),
			...filesUnder(join(PKG_DIR, "dist")),
			join(PKG_DIR, "README.md"),
			join(PKG_DIR, "package.json"),
		];
		expect(scanned.some((file) => file.includes(`${join(PKG_DIR, "src")}/`))).toBe(true);
		expect(scanned.some((file) => file.includes(`${join(PKG_DIR, "dist")}/`))).toBe(true);
		for (const file of scanned) expect(readFileSync(file, "utf8"), `${file} names @coopcli`).not.toContain("@coopcli");
	});
});

describe("The readme lists the entry points", () => {
	it("Scenario: Every entry is documented", () => {
		const readme = readFileSync(join(PKG_DIR, "README.md"), "utf8");
		expect(readme).toContain("npm install @specsesh/agent");
		const entries = Object.keys(manifest.exports).filter((key) => key !== "./package.json");
		expect(entries).toHaveLength(10);
		for (const entry of entries) expect(readme).toContain(`@specsesh/agent/${entry.slice(2)}`);
		expect(readme).toContain("agentscript-pi");
		expect(readme).toContain("agentscript-durable");
		expect(readme).toContain("agentscript-task");
		expect(readme).toContain("agentscript-change");
		expect(readme).toContain("npx specsesh");
	});
});

describe("The build emits JavaScript and declarations file for file", () => {
	it("Scenario: dist is ignored", () => {
		// Exits 0 when ignored; execFileSync throws otherwise.
		const out = execFileSync("git", ["check-ignore", "packages/agent/dist"], { cwd: ROOT, encoding: "utf8" });
		expect(out.trim()).toBe("packages/agent/dist");
	});
});
