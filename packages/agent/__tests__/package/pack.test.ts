// The pack check: the packed @specsesh/agent installs and runs the way an outside project would use it.
//
//   pnpm pack:check     (vitest.pack.config.ts runs this file alone)
//
// Not part of `pnpm test`: installing the tarball needs the npm registry for the package's
// dependencies and peers. No live model: the durable run goes through the claude-code provider
// to a fake `claude` on PATH. dist/ is built by the global setup (`pnpm build`).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
const NODE_ENTRIES = Object.keys(manifest.exports).filter((key) => key !== "./cloudflare");
// The peers a Node consumer of every entry but ./cloudflare installs, at the versions the tests run on.
const NODE_PEERS = ["@earendil-works/pi-ai", "@earendil-works/pi-durable", "@earendil-works/chord"].map(
	(name) => `${name}@${manifest.devDependencies[name]}`,
);
const INSTALL_TIMEOUT = 180_000;

const temps: string[] = [];
function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), `specsesh-pack-${prefix}-`));
	temps.push(dir);
	return dir;
}

const sh = (cmd: string, args: string[], cwd: string) =>
	execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Runs a Node ES module from a project directory, so bare imports resolve against its node_modules. */
function node(project: string, source: string) {
	const file = join(project, `check-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
	writeFileSync(file, source);
	return spawnSync(process.execPath, [file], { cwd: project, encoding: "utf8" });
}

/** An empty project with the tarball (and any extra packages) installed. */
function project(name: string, tarball: string, extra: string[] = []): string {
	const dir = temp(name);
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `pack-check-${name}`, private: true, type: "module" }));
	sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball, ...extra], dir);
	return dir;
}

/** Imports every Node entry; throws naming the first that fails. */
function importEntries(dir: string): void {
	for (const entry of NODE_ENTRIES) {
		const specifier = `@specsesh/agent/${entry.slice(2)}`;
		const r = node(dir, `const m = await import(${JSON.stringify(specifier)}); if (Object.keys(m).length === 0) throw new Error("no exports");\n`);
		if (r.status !== 0) {
			throw new Error(`entry ${entry} (${specifier}) does not import: ${r.stderr.trim().split("\n").slice(0, 6).join(" | ")}`);
		}
	}
}

/** One text step, for the core with no peers. */
const ONE_STEP_AGENT = `config:
    agent_name: "pack-check-core"

subagent greet:
    description: "Say hi"

    reasoning:
        instructions: ->
            | Say hi.
`;

const PACK_CHECK_AGENT = `config:
    agent_name: "pack-check"

system:
    instructions: |
        You answer in one short line.

variables:
    greeting: mutable string = ""
        description: "the greeting the model wrote"

subagent greet:
    description: "Write the greeting"

    reasoning:
        instructions: ->
            | Write a one-line greeting.
            set @variables.greeting = @outputs.greeting

subagent sign_off:
    description: "Close"

    reasoning:
        instructions: ->
            | Write a one-line sign-off after: {!@variables.greeting}
`;

/** A `claude` stand-in: a structured answer when asked for a schema, text otherwise. */
const FAKE_CLAUDE = `#!${process.execPath}
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", () => {
	const structured = args.includes("--json-schema");
	console.log(JSON.stringify({
		type: "result", subtype: "success", is_error: false, num_turns: 1,
		result: structured ? "{}" : "Goodbye from the fake claude.",
		...(structured ? { structured_output: { greeting: "Hello from the fake claude." } } : {}),
		usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0,
	}));
});
`;

let tarball: string;
let packedPaths: string[];
let bare: string;
let full: string;

beforeAll(() => {
	const packDir = temp("tarball");
	const [report] = JSON.parse(sh("npm", ["pack", "--json", "--pack-destination", packDir], PKG_DIR)) as {
		filename: string;
		files: { path: string }[];
	}[];
	tarball = join(packDir, report!.filename);
	packedPaths = report!.files.map((file) => file.path);
	bare = project("bare", tarball);
	full = project("full", tarball, NODE_PEERS);
}, INSTALL_TIMEOUT);

afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("pack:check proves the tarball installs and runs", () => {
	it("Scenario: A clean tarball passes", () => {
		// The tarball: only the build, the readme and the license.
		expect(packedPaths).toEqual(expect.arrayContaining(["package.json", "README.md", "LICENSE"]));
		for (const path of packedPaths) {
			expect(["package.json", "README.md", "LICENSE"].includes(path) || path.startsWith("dist/"), path).toBe(true);
			expect(path.endsWith(".ts") && !path.endsWith(".d.ts"), `${path} is TypeScript source`).toBe(false);
		}
		// Installed with the Node peers, every entry but ./cloudflare (workerd only) imports.
		expect(() => importEntries(full)).not.toThrow();
	});

	it(
		"Scenario: A broken entry fails by name",
		() => {
			const work = temp("broken");
			sh("tar", ["-xzf", tarball, "-C", work], work);
			const pkgJson = join(work, "package", "package.json");
			const broken = JSON.parse(readFileSync(pkgJson, "utf8"));
			broken.exports["./pi"] = { types: "./dist/pi/missing.d.ts", import: "./dist/pi/missing.js" };
			writeFileSync(pkgJson, JSON.stringify(broken, null, 2));
			const brokenTarball = join(work, "broken.tgz");
			sh("tar", ["-czf", brokenTarball, "-C", work, "package"], work);
			const dir = project("broken", brokenTarball, NODE_PEERS);
			expect(() => importEntries(dir)).toThrow(/entry \.\/pi /);
		},
		INSTALL_TIMEOUT,
	);

	it("runs the installed agentscript-durable on a faux model to completed", () => {
		const fakeBin = join(full, "fake-bin");
		mkdirSync(fakeBin, { recursive: true });
		writeFileSync(join(fakeBin, "claude"), FAKE_CLAUDE);
		chmodSync(join(fakeBin, "claude"), 0o755);
		writeFileSync(join(full, "pack-check.agent"), PACK_CHECK_AGENT);
		const env: Record<string, string | undefined> = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` };
		for (const key of Object.keys(env)) if (/_API_KEY$|_TOKEN$/.test(key) || key.startsWith("AGENTSCRIPT_")) delete env[key];
		const r = spawnSync(
			join(full, "node_modules", ".bin", "agentscript-durable"),
			["run", "pack-check.agent", "--db", "runs.sqlite", "--provider", "claude-code", "--model", "claude-haiku-4-5", "--json"],
			{ cwd: full, env, encoding: "utf8", timeout: 60_000 },
		);
		expect(r.status, r.stderr).toBe(0);
		const result = JSON.parse(r.stdout);
		expect(result.kind).toBe("completed");
		expect(result.variables.greeting).toBe("Hello from the fake claude.");
	}, 60_000);
});

describe("The package exports one entry per layer and the command", () => {
	for (const [name, specifier] of [
		["Scenario: A deep import is refused", "@specsesh/agent/dist/interpreter/run.js"],
		["Scenario: The bare package name is not importable", "@specsesh/agent"],
	] as const) {
		it(name, () => {
			const r = node(bare, `await import(${JSON.stringify(specifier)});\n`);
			expect(r.status).not.toBe(0);
			expect(r.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
		});
	}
});

describe("pack:check proves the tarball installs and runs", () => {
	it("Scenario: The installed task bin prints its usage", () => {
		const r = spawnSync(join(full, "node_modules", ".bin", "agentscript-task"), [], { cwd: full, encoding: "utf8" });
		expect(r.status, r.stderr).toBe(2);
		expect(r.stderr.startsWith("usage:")).toBe(true);
		expect(r.stderr).toContain("agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]");
		// The installed ./task entry finds its bundled script beside the compiled module.
		const s = node(
			full,
			`import { readFileSync } from "node:fs";
import { BUNDLED_SCRIPTS, contractProblems } from "@specsesh/agent/task";
const source = readFileSync(BUNDLED_SCRIPTS.task, "utf8");
if (contractProblems(source).length > 0) throw new Error("the bundled task.agent breaks the contract");
const group = readFileSync(BUNDLED_SCRIPTS.group, "utf8");
console.log(source.includes('agent_name: "task-agent"') && group.includes('agent_name: "group-judge"') ? "found" : "missing");
`,
		);
		expect(s.status, s.stderr).toBe(0);
		expect(s.stdout.trim()).toBe("found");
	});
});

describe("The core entries work with no peer installed", () => {
	it("Scenario: A script runs with no peers", () => {
		for (const name of ["@earendil-works", "agents", "tsx"]) {
			expect(existsSync(join(bare, "node_modules", name)), `${name} was installed`).toBe(false);
		}
		const r = node(
			bare,
			`import { analyze } from "@specsesh/agent/authoring";
import { run } from "@specsesh/agent/interpreter";
const source = ${JSON.stringify(ONE_STEP_AGENT)};
if (analyze(source).diagnostics.some((d) => d.severity === 1)) throw new Error("the script does not lint clean");
const port = { reason: async () => ({ kind: "answered", text: "hi" }) };
const result = await run(source, { port });
console.log(result.kind);
process.exit(result.kind === "completed" ? 0 : 1);
`,
		);
		expect(r.status, r.stderr).toBe(0);
		expect(r.stdout.trim()).toBe("completed");
	});

	it("Scenario: The openspec entry checks a value with no peers", () => {
		const r = node(
			bare,
			`import { Clause, check } from "@specsesh/agent/openspec";
const refused = !check(Clause, { keyword: "BUT", text: "x" });
const accepted = check(Clause, { keyword: "WHEN", text: "x" });
console.log(refused && accepted ? "refused" : "accepted");
process.exit(refused && accepted ? 0 : 1);
`,
		);
		expect(r.status, r.stderr).toBe(0);
		expect(r.stdout.trim()).toBe("refused");
	});
});

/** Every installed version of `name` in a project, from `npm ls --all --json`, deduped copies included. */
function installedVersions(dir: string, name: string): string[] {
	const r = spawnSync("npm", ["ls", name, "--all", "--json"], { cwd: dir, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`npm ls ${name} failed: ${r.stderr.trim()}`);
	const versions: string[] = [];
	const walk = (deps: Record<string, { version?: string; dependencies?: Record<string, unknown> }> = {}) => {
		for (const [dep, node] of Object.entries(deps)) {
			if (dep === name && node.version !== undefined) versions.push(node.version);
			walk(node.dependencies as typeof deps);
		}
	};
	walk(JSON.parse(r.stdout).dependencies);
	return versions;
}

describe("The ontology entry loads from the packed tarball", () => {
	it("Scenario: The ontology loads with no peers installed", () => {
		for (const name of ["@earendil-works", "agents"]) {
			expect(existsSync(join(bare, "node_modules", name)), `${name} was installed`).toBe(false);
		}
		const r = node(
			bare,
			`import { Clause, check, toJSONSchema } from "@specsesh/agent/openspec";
if (!check(Clause, { keyword: "WHEN", text: "x" })) throw new Error("a valid clause is refused");
if (check(Clause, { keyword: "BUT", text: "x" })) throw new Error("an invalid clause is accepted");
if (toJSONSchema(Clause).type !== "object") throw new Error("no JSON Schema");
console.log("done");
`,
		);
		expect(r.status, r.stderr).toBe(0);
		expect(r.stdout.trim()).toBe("done");
	});

	it("Scenario: One schema library beside pi", () => {
		// pi is there, and typebox is installed exactly once, at the pinned version.
		expect(existsSync(join(full, "node_modules", "@earendil-works", "pi-ai"))).toBe(true);
		const versions = installedVersions(full, "typebox");
		expect(versions.length, "npm ls found no typebox").toBeGreaterThan(0);
		expect([...new Set(versions)]).toEqual(["1.3.27"]);
		const r = node(
			full,
			`import * as openspec from "@specsesh/agent/openspec";
import * as pi from "@specsesh/agent/pi";
if (Object.keys(pi).length === 0) throw new Error("./pi has no exports");
if (!openspec.check(openspec.Clause, { keyword: "THEN", text: "x" })) throw new Error("a valid clause is refused");
console.log("done");
`,
		);
		expect(r.status, r.stderr).toBe(0);
		expect(r.stdout.trim()).toBe("done");
	});
});

describe("specsesh tarball", () => {
	const SPECSESH_DIR = join(PKG_DIR, "..", "specsesh");
	let specseshTarball: string;
	let specsesh: string;
	let expectedVersion: string;

	/** Installs the packed agent and specsesh into an empty project; npm must take the agent from its tarball. */
	function specseshProject(sequential: boolean): string {
		const dir = temp(sequential ? "specsesh-sequential" : "specsesh");
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pack-specsesh", private: true }));
		const install = (...tarballs: string[]) =>
			sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...tarballs], dir);
		if (sequential) {
			install(tarball);
			install(specseshTarball);
		} else {
			install(tarball, specseshTarball);
		}
		return dir;
	}

	/** True when the installed @specsesh/agent is the packed tarball, with no registry copy beside it. */
	function agentFromTarball(dir: string): boolean {
		const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
		const resolved = lock.packages?.["node_modules/@specsesh/agent"]?.resolved as string | undefined;
		return (
			resolved !== undefined &&
			resolved.startsWith("file:") &&
			!existsSync(join(dir, "node_modules", "specsesh", "node_modules", "@specsesh", "agent"))
		);
	}

	beforeAll(() => {
		expectedVersion = manifest.version;
		const specseshManifest = JSON.parse(readFileSync(join(SPECSESH_DIR, "package.json"), "utf8"));
		if (specseshManifest.version !== expectedVersion) {
			throw new Error(`specsesh is ${specseshManifest.version}, @specsesh/agent is ${expectedVersion}`);
		}

		const packDir = temp("specsesh-tarball");
		const out = sh("pnpm", ["pack", "--pack-destination", packDir], SPECSESH_DIR);
		const last = out.trim().split("\n").at(-1)?.trim() ?? "";
		if (last.endsWith(".tgz")) {
			specseshTarball = last.startsWith("/") ? last : join(packDir, last);
		} else {
			const found = readdirSync(packDir).filter((file) => /^specsesh-.*\.tgz$/.test(file));
			if (found.length !== 1) throw new Error(`pnpm pack left ${found.length} specsesh tarballs in ${packDir}: ${out.trim()}`);
			specseshTarball = join(packDir, found[0]!);
		}

		let dir: string;
		try {
			dir = specseshProject(false);
		} catch {
			dir = specseshProject(true);
		}
		if (!agentFromTarball(dir)) dir = specseshProject(true);
		if (!existsSync(join(dir, "node_modules", "@specsesh", "agent", "package.json"))) {
			throw new Error(`@specsesh/agent is not installed in ${dir}: npm did not dedupe it from the tarball`);
		}
		if (!agentFromTarball(dir)) throw new Error(`npm installed a registry copy of @specsesh/agent in ${dir}`);
		specsesh = dir;
	}, 2 * INSTALL_TIMEOUT);

	it("Scenario: The installed specsesh prints its version", () => {
		const bin = join(specsesh, "node_modules", ".bin", "specsesh");
		const version = spawnSync(bin, ["--version"], { cwd: specsesh, encoding: "utf8" });
		expect(version.status, `specsesh --version: ${version.stderr}`).toBe(0);
		expect(version.stdout.trim(), `specsesh --version: ${version.stderr}`).toBe(`specsesh ${expectedVersion}`);
		const task = spawnSync(bin, ["task"], { cwd: specsesh, encoding: "utf8" });
		expect(task.status, `specsesh task: ${task.stderr}`).toBe(2);
		expect(task.stderr, "specsesh task").toMatch(/^usage:/);
	});

	it("Scenario: The packed specsesh pins the agent exactly", () => {
		const packed = JSON.parse(sh("tar", ["-xzOf", specseshTarball, "package/package.json"], specsesh));
		const pin = packed.dependencies?.["@specsesh/agent"];
		expect(pin).toBe(expectedVersion);
		expect(String(pin).startsWith("workspace:")).toBe(false);
		expect(packed.bin?.specsesh).toBe("./bin/specsesh.js");
	});
});

describe("The bin is the compiled CLI", () => {
	it("Scenario: The installed bin needs no tsx", () => {
		expect(existsSync(join(full, "node_modules", "tsx"))).toBe(false);
		const r = spawnSync("npx", ["--no-install", "agentscript-pi", "models", "claude-code"], { cwd: full, encoding: "utf8" });
		expect(r.status, r.stderr).toBe(0);
		expect(r.stdout.startsWith("any id or alias")).toBe(true);
	});
});
