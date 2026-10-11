import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));

/** The core: the two directories behind `./authoring` and `./interpreter`. */
const CORE_DIRS = ["src/authoring", "src/interpreter"];

/**
 * Every `.ts` under the given directories, read from DISK.
 *
 * Deliberately not `git ls-files`: a file that is not yet tracked is exactly the
 * one an import boundary needs checked, and a listing that skips it turns this
 * whole suite green by finding nothing to look at.
 */
function walk(dir: string): string[] {
	return readdirSync(join(PKG_DIR, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}
const filesUnder = (...dirs: string[]) => dirs.flatMap((dir) => walk(dir));
const sourceFiles = () => filesUnder("src", "__tests__");

/** A file's source with comments removed, so prose cannot read as code. */
const codeOf = (file: string) =>
	readFileSync(join(PKG_DIR, file), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

const importsOf = (file: string) =>
	[...codeOf(file).matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
		(m) => (m[1] ?? m[2]) as string,
	);

const packageOf = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
const isBuiltin = (spec: string) => spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0]!);

/** Every file the manifest's `exports` map points at, for the given keys (all by default). */
function exportTargets(keys?: readonly string[]): string[] {
	const collect = (value: unknown): string[] => {
		if (typeof value === "string") return [value.replace(/^\.\//, "")];
		if (value === null || typeof value !== "object") return [];
		return Object.values(value as Record<string, unknown>).flatMap(collect);
	};
	const exports = manifest.exports as Record<string, unknown>;
	return Object.entries(exports)
		.filter(([key]) => keys === undefined || keys.includes(key))
		.flatMap(([, value]) => collect(value));
}

/** A built export target mapped back to the source it is compiled from. */
const sourceOf = (target: string) => target.replace(/^dist\//, "src/").replace(/\.d\.ts$|\.js$/, ".ts");

const MODEL_CLIENT = /anthropic|openai|@google\/gen|bedrock|langchain|@ai-sdk|\bollama\b/i;

describe("The authoring entry exports parse, analyse and a document, and nothing that compiles", () => {
	it("Scenario: A consumer imports the authoring surface", async () => {
		const surface = await import("../../src/authoring/index.js");
		expect(Object.keys(surface)).toEqual(
			expect.arrayContaining(["Document", "analyze", "parse", "SUPPORTED_CONSTRUCTS"]),
		);
		const interpreter = await import("../../src/interpreter/index.js");
		expect(surface.SUPPORTED_CONSTRUCTS).toBe(interpreter.SUPPORTED_CONSTRUCTS);
	});

	it("Scenario: No export offers compilation", () => {
		const keys = Object.keys(manifest.exports ?? {});
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) expect(key).not.toMatch(/compile|emit-runtime|salesforce/i);
	});

	it("Scenario: Every advertised entry point exists", () => {
		// dist/ is built by the suite's global setup (`pnpm build`).
		const targets = exportTargets();
		expect(targets.length).toBeGreaterThan(0);
		for (const target of targets) {
			expect(existsSync(join(PKG_DIR, target)), `${target} is missing`).toBe(true);
		}
	});
});

describe("The core package imports only its declared dependencies and stays inside itself", () => {
	it("Scenario: The module graph closes inside the package", () => {
		// Seeded from the MANIFEST, not from one hand-picked entry. Seeded with
		// `src/authoring/index.ts` alone, this walk reached `document.ts` and
		// `subset.ts` and stopped — `run.ts`, `compose.ts`, `scan.ts` and `port.ts`
		// were never traversed.
		const seen = new Set<string>();
		const queue = [...new Set(exportTargets(["./authoring", "./interpreter"]).map(sourceOf))];
		expect(queue.length, "the manifest advertises no core entry points").toBeGreaterThan(1);
		while (queue.length) {
			const file = queue.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			expect(existsSync(join(PKG_DIR, file)), `${file} is missing`).toBe(true);
			for (const spec of importsOf(file)) {
				if (!spec.startsWith(".")) continue;
				queue.push(join(dirname(file), spec.replace(/\.js$/, ".ts")));
			}
		}
		for (const file of seen) {
			expect(CORE_DIRS.some((dir) => file.startsWith(`${dir}/`)), `${file} is outside the core`).toBe(true);
		}
		for (const file of ["src/interpreter/run.ts", "src/interpreter/scan.ts", "src/interpreter/compose.ts"]) {
			expect(seen.has(file), `${file} is never reached from a core entry point`).toBe(true);
		}
	});

	it("Scenario: Only declared dependencies are imported", () => {
		const files = filesUnder(...CORE_DIRS);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			for (const spec of importsOf(file)) {
				if (spec.startsWith(".")) continue;
				expect(
					packageOf(spec).startsWith("@sf-agentscript/") || isBuiltin(spec),
					`${file} imports ${spec}`,
				).toBe(true);
			}
		}
	});

	it("Scenario: No credential is read", () => {
		const files = filesUnder(...CORE_DIRS);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect(codeOf(file), `${file} reads a credential`).not.toMatch(
				/process\.env|API_KEY|apiKey|ANTHROPIC_|OPENAI_|Bearer\s/i,
			);
		}
	});
});

describe("The core package reaches no model on its own", () => {
	it("Scenario: The package imports no model client", () => {
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			expect(name, `${name} is a model client`).not.toMatch(
				/anthropic|openai|@google\/gen|bedrock|langchain|@ai-sdk|\bollama\b|claude-code/i,
			);
		}

		// No SDK import in the core, its tests included — a client imported by a
		// test is a client in the tree.
		const scanned = filesUnder(...CORE_DIRS, "__tests__/core");
		expect(scanned.length).toBeGreaterThan(0);
		for (const file of scanned) {
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports a model client`).not.toMatch(MODEL_CLIENT);
			}
		}

		// The shipped core code, and only it, for the rest: a test may legitimately
		// spawn a process with an environment.
		for (const file of filesUnder(...CORE_DIRS)) {
			const code = codeOf(file);
			// No endpoint constructed. Something that knows a URL is something that
			// could dial it, whatever the port says.
			expect(code, `${file} constructs an endpoint`).not.toMatch(/https?:\/\//);
			expect(code, `${file} makes a network call`).not.toMatch(/\bfetch\s*\(|new\s+(WebSocket|XMLHttpRequest)/);
			// Reading `process.env` at all is the line: the core has no configuration
			// of its own to read from it.
			expect(code, `${file} reads a credential`).not.toMatch(
				/process\.env|API_KEY|apiKey|ANTHROPIC_|OPENAI_|Bearer\s/i,
			);
		}
	});
});

describe("The core package imports only what it declares", () => {
	it("Scenario: Imports stay inside the declared graph", () => {
		const declared = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.devDependencies ?? {}),
		]);
		const dirs = [...CORE_DIRS, "__tests__/core"];
		const files = filesUnder(...dirs);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			for (const spec of importsOf(file)) {
				if (spec.startsWith(".")) {
					const resolved = join(dirname(file), spec);
					expect(
						dirs.some((dir) => resolved.startsWith(`${dir}/`)),
						`${file} imports ${spec}, outside the core directories`,
					).toBe(true);
					continue;
				}
				if (spec.startsWith("node:")) continue;
				expect(declared.has(packageOf(spec)), `${file} imports ${packageOf(spec)}, which is not declared`).toBe(true);
			}
		}
	});
});

describe("platform-agentscript-authoring: The dependency direction", () => {
	it("has no import resolving to a specsketch module", () => {
		for (const file of sourceFiles()) {
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports specsketch`).not.toMatch(/specsketch/);
				// A relative escape out of the package is the same violation wearing a
				// different spelling. Counted by RESOLVING it rather than by counting
				// `../` segments.
				if (!spec.startsWith(".")) continue;
				const resolved = relative(PKG_DIR, join(PKG_DIR, dirname(file), spec));
				expect(resolved.startsWith(".."), `${file} reaches outside the package`).toBe(false);
			}
		}
	});
});

describe("platform-agentscript-authoring: A private dependency", () => {
	it("declares no dependency that is a private workspace package", () => {
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			// Anything under the old repo scope would be a workspace package; a
			// published library cannot depend on one. The port is how a private
			// capability is consumed.
			expect(name, `${name} is a workspace package`).not.toMatch(/^@coopcli\//);
		}
	});

	it("names no workspace package anywhere in its resolved tree", () => {
		const tree = execFileSync("pnpm", ["ls", "--depth", "10"], { cwd: PKG_DIR, encoding: "utf8" });
		expect(tree).not.toMatch(/@coopcli\//);
	});
});
