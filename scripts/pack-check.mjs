// Proves the packed @specsesh/agent installs and runs the way an outside project would use it.
//
//   pnpm pack:check                      build, pack, install into empty projects, import, run
//   node scripts/pack-check.mjs --tarball <file.tgz>   check an existing tarball (no build, no self-test)
//
// Prints `ok <step>` per step and exits 0, or names the first step that failed and exits 1.
// No live model: the durable run goes through the claude-code provider to a fake `claude` on PATH.
// Needs the npm registry for the package's dependencies and peers. Temp directories are removed.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(ROOT, "packages", "agent");
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
const NODE_ENTRIES = Object.keys(manifest.exports).filter((key) => key !== "./cloudflare");
// The peers a Node consumer of every entry but ./cloudflare installs, at the versions the tests run on.
const NODE_PEERS = ["@earendil-works/pi-ai", "@earendil-works/pi-durable", "@earendil-works/chord"].map(
	(name) => `${name}@${manifest.devDependencies[name]}`,
);

class StepFailed extends Error {}

const temps = [];
function temp(prefix) {
	const dir = mkdtempSync(join(tmpdir(), `specsesh-pack-${prefix}-`));
	temps.push(dir);
	return dir;
}

function step(name, fn) {
	try {
		fn();
	} catch (error) {
		const detail = error instanceof StepFailed ? error.message : (error?.stderr?.toString() || error?.message || String(error));
		throw new StepFailed(`${name}: ${detail.trim()}`);
	}
	console.log(`ok ${name}`);
}

function sh(cmd, args, cwd, env = process.env) {
	return execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Runs a Node ES module from a project directory, so bare imports resolve against its node_modules. */
function node(project, source, env = process.env) {
	const file = join(project, `check-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
	writeFileSync(file, source);
	return spawnSync(process.execPath, [file], { cwd: project, env, encoding: "utf8" });
}

function project(name, tarball, extra = []) {
	const dir = temp(name);
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `pack-check-${name}`, private: true, type: "module" }));
	sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball, ...extra], dir);
	return dir;
}

/** Imports every Node entry; throws naming the first that fails. */
function importEntries(dir) {
	for (const entry of NODE_ENTRIES) {
		const specifier = `@specsesh/agent/${entry.slice(2)}`;
		const r = node(dir, `const m = await import(${JSON.stringify(specifier)}); if (Object.keys(m).length === 0) throw new Error("no exports");\n`);
		if (r.status !== 0) throw new StepFailed(`entry ${entry} (${specifier}) does not import: ${r.stderr.trim().split("\n").slice(0, 6).join(" | ")}`);
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

/** A \`claude\` stand-in: a structured answer when asked for a schema, text otherwise. */
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

function main(argv) {
	const tarballArg = argv[0] === "--tarball" ? argv[1] : undefined;
	let tarball = tarballArg;

	if (tarball === undefined) {
		step("build", () => sh("pnpm", ["build"], PKG_DIR));
		const packDir = temp("tarball");
		step("pack", () => {
			const [report] = JSON.parse(sh("npm", ["pack", "--json", "--pack-destination", packDir], PKG_DIR));
			tarball = join(packDir, report.filename);
			const paths = report.files.map((file) => file.path);
			const bad = paths.filter(
				(path) =>
					!(["package.json", "README.md", "LICENSE"].includes(path) || path.startsWith("dist/")) ||
					(path.endsWith(".ts") && !path.endsWith(".d.ts")),
			);
			if (bad.length > 0) throw new StepFailed(`the tarball holds ${bad.join(", ")}`);
			for (const required of ["package.json", "README.md", "LICENSE"]) {
				if (!paths.includes(required)) throw new StepFailed(`the tarball has no ${required}`);
			}
		});
	}

	// --- No peers installed: the core alone.
	let bare;
	step("install without peers", () => {
		bare = project("bare", tarball);
		const present = ["@earendil-works", "agents", "tsx"].filter((name) => existsSync(join(bare, "node_modules", name)));
		if (present.length > 0) throw new StepFailed(`installed without asking: ${present.join(", ")}`);
	});

	step("Scenario: A script runs with no peers", () => {
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
		if (r.status !== 0 || r.stdout.trim() !== "completed") throw new StepFailed(`exit ${r.status}: ${r.stdout}${r.stderr}`);
	});

	for (const [name, specifier] of [
		["Scenario: A deep import is refused", "@specsesh/agent/dist/interpreter/run.js"],
		["Scenario: The bare package name is not importable", "@specsesh/agent"],
	]) {
		step(name, () => {
			const r = node(bare, `await import(${JSON.stringify(specifier)});\n`);
			if (r.status === 0 || !r.stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED")) {
				throw new StepFailed(`importing ${specifier} did not fail with ERR_PACKAGE_PATH_NOT_EXPORTED (exit ${r.status}): ${r.stderr}`);
			}
		});
	}

	// --- With the Node peers: every entry but ./cloudflare (workerd only), and both bins.
	let full;
	step("install with peers", () => {
		full = project("full", tarball, NODE_PEERS);
	});
	step("import every Node entry", () => importEntries(full));

	step("Scenario: The installed bin needs no tsx", () => {
		if (existsSync(join(full, "node_modules", "tsx"))) throw new StepFailed("tsx is installed");
		const r = spawnSync("npx", ["--no-install", "agentscript-pi", "models", "claude-code"], { cwd: full, encoding: "utf8" });
		if (r.status !== 0 || !r.stdout.startsWith("any id or alias")) throw new StepFailed(`exit ${r.status}: ${r.stdout}${r.stderr}`);
	});

	step("agentscript-durable run on a faux model", () => {
		const fakeBin = join(full, "fake-bin");
		mkdirSync(fakeBin);
		writeFileSync(join(fakeBin, "claude"), FAKE_CLAUDE);
		chmodSync(join(fakeBin, "claude"), 0o755);
		writeFileSync(join(full, "pack-check.agent"), PACK_CHECK_AGENT);
		const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` };
		for (const key of Object.keys(env)) if (/_API_KEY$|_TOKEN$/.test(key) || key.startsWith("AGENTSCRIPT_")) delete env[key];
		const r = spawnSync(
			join(full, "node_modules", ".bin", "agentscript-durable"),
			["run", "pack-check.agent", "--db", "runs.sqlite", "--provider", "claude-code", "--model", "claude-haiku-4-5", "--json"],
			{ cwd: full, env, encoding: "utf8" },
		);
		const result = r.status === 0 ? JSON.parse(r.stdout) : undefined;
		if (result?.kind !== "completed" || result.variables?.greeting !== "Hello from the fake claude.") {
			throw new StepFailed(`exit ${r.status}: ${r.stdout}${r.stderr}`);
		}
	});

	if (tarballArg !== undefined) return;

	// --- The check itself: a tarball whose export target is missing must fail, naming the entry.
	step("Scenario: A broken entry fails by name", () => {
		const work = temp("broken");
		sh("tar", ["-xzf", tarball, "-C", work], work);
		const pkgJson = join(work, "package", "package.json");
		const broken = JSON.parse(readFileSync(pkgJson, "utf8"));
		broken.exports["./pi"] = { types: "./dist/pi/missing.d.ts", import: "./dist/pi/missing.js" };
		writeFileSync(pkgJson, JSON.stringify(broken, null, 2));
		const brokenTarball = join(work, "broken.tgz");
		sh("tar", ["-czf", brokenTarball, "-C", work, "package"], work);
		const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--tarball", brokenTarball], { encoding: "utf8" });
		if (r.status === 0) throw new StepFailed("a tarball with a missing ./pi target passed");
		if (!r.stderr.includes("entry ./pi")) throw new StepFailed(`the failure does not name ./pi: ${r.stderr}`);
	});
}

let code = 0;
try {
	main(process.argv.slice(2));
} catch (error) {
	console.error(`FAILED ${error instanceof Error ? error.message : String(error)}`);
	code = 1;
} finally {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
