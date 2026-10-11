// The pack check: the packed @specsesh/agent installs and runs the way an outside project would use it.
//
//   pnpm pack:check     (vitest.pack.config.ts runs this file alone)
//
// Not part of `pnpm test`: installing the tarball needs the npm registry for the package's
// dependencies and peers. No live model: the durable run goes through the claude-code provider
// to a fake `claude` on PATH. dist/ is built by the global setup (`pnpm build`).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("The package exports exactly seven entry points", () => {
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

describe("The bin is the compiled CLI", () => {
	it("Scenario: The installed bin needs no tsx", () => {
		expect(existsSync(join(full, "node_modules", "tsx"))).toBe(false);
		const r = spawnSync("npx", ["--no-install", "agentscript-pi", "models", "claude-code"], { cwd: full, encoding: "utf8" });
		expect(r.status, r.stderr).toBe(0);
		expect(r.stdout.startsWith("any id or alias")).toBe(true);
	});
});
