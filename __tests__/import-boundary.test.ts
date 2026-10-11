import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));

/**
 * Every `.ts` under `src/` and `__tests__/`, read from DISK.
 *
 * Deliberately not `git ls-files`: a file that is not yet tracked is exactly the
 * one an import boundary needs checked, and a listing that skips it turns this
 * whole suite green by finding nothing to look at.
 */
function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.name.endsWith(".ts") ? [relative(PKG_DIR, path)] : [];
	});
}

const sourceFiles = () => [...walk(join(PKG_DIR, "src")), ...walk(join(PKG_DIR, "__tests__"))];

/** A file's source with comments removed, so prose cannot read as code. */
const codeOf = (file: string) =>
	readFileSync(join(PKG_DIR, file), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

const importsOf = (file: string) =>
	[...codeOf(file).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] as string);

/**
 * Every file the manifest's `exports` map points at.
 *
 * Recursive, because an export target is a string TODAY and is a conditions
 * object (`{ import, types }`) the moment anyone adds a build step — at which
 * point a reader treating it as a string silently `existsSync`es
 * `[object Object]` and fails naming nothing useful.
 */
function exportTargets(value: unknown = manifest.exports ?? {}): string[] {
	if (typeof value === "string") return [value.replace(/^\.\//, "")];
	if (value === null || typeof value !== "object") return [];
	return Object.values(value as Record<string, unknown>).flatMap((entry) => exportTargets(entry));
}

describe("platform-agentscript-authoring: The dependency direction", () => {
	it("has no import resolving to a specsketch module", () => {
		for (const file of sourceFiles()) {
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports specsketch`).not.toMatch(/specsketch/);
				// A relative escape out of the package is the same violation wearing a
				// different spelling. Counted by RESOLVING it rather than by counting
				// `../` segments: `__tests__/helpers/` is two levels down and reaches
				// `src/` legitimately, and a rule that cannot tell those apart is a
				// rule that gets deleted the first time it is wrong.
				if (!spec.startsWith(".")) continue;
				const resolved = relative(PKG_DIR, join(PKG_DIR, dirname(file), spec));
				expect(resolved.startsWith(".."), `${file} reaches outside the package`).toBe(false);
			}
		}
	});

	it("imports only its declared dependencies, node builtins, and its own files", () => {
		const declared = new Set(Object.keys(manifest.dependencies ?? {}));
		const dev = new Set(Object.keys(manifest.devDependencies ?? {}));
		for (const file of sourceFiles()) {
			for (const spec of importsOf(file)) {
				if (spec.startsWith(".") || spec.startsWith("node:")) continue;
				const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
				expect(
					declared.has(pkg) || dev.has(pkg),
					`${file} imports ${pkg}, which is not a declared dependency`,
				).toBe(true);
			}
		}
	});
});

describe("platform-agentscript-authoring: Publishing is deferred, deliberately", () => {
	it("keeps the manifest private, so flipping it is an act that trips a test", () => {
		// This suite asserted every CONSEQUENCE of publishing — no workspace
		// dependency, no model client, a closed module graph — and never the
		// manifest field itself, so nothing pinned the decision in either
		// direction. README.md records the deferral; this makes it checkable.
		//
		// The order matters on the day it ships, and this is the note that says so:
		// configure the npm trusted publisher, publish ONCE by hand (OIDC cannot
		// bootstrap a package npm has never seen), and only then add it to
		// publish.yml. Every merge to `main` releases, so a publish step for an
		// unbootstrapped package fails EVERY merge and blocks tagging.
		expect(manifest.private).toBe(true);
		// And while it is private it ships no build: `exports` points at raw `.ts`
		// with `.js`-suffixed relative imports, which a consumer could not resolve.
		// Publishing means adding a build, not only flipping the flag above.
		expect(exportTargets().every((target) => target.endsWith(".ts"))).toBe(true);
		expect(manifest.files, "a `files` list means someone started packing this").toBeUndefined();
	});
});

describe("platform-agentscript-authoring: A private dependency", () => {
	it("declares no dependency that is a private workspace package", () => {
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			// Anything under the repo's own scope would be a workspace package, and
			// every one of those is either private or a CLI — neither belongs under
			// a published library's dependencies. The port is how a private
			// capability is consumed.
			expect(name, `${name} is a workspace package`).not.toMatch(/^@coopcli\//);
		}
	});

	it("names no workspace package anywhere in its resolved tree", () => {
		const tree = execFileSync("pnpm", ["ls", "--depth", "10"], { cwd: PKG_DIR, encoding: "utf8" });
		expect(tree).not.toMatch(/@coopcli\/(?!agentscript)/);
	});
});

describe("platform-agentscript-interpreter: Reasoning Goes Out Through A Declared Port, And The Package Imports No Model Client", () => {
	it("Scenario: The package imports no model client — no SDK, client or credential reader, and no private workspace package", async () => {
		// A published package cannot depend on a private one, so the harness this
		// would otherwise call is reached by injection or not at all. That is a
		// packaging constraint before it is a design preference.
		const declared = Object.keys({
			...(manifest.dependencies ?? {}),
			...(manifest.peerDependencies ?? {}),
			...(manifest.optionalDependencies ?? {}),
		});
		for (const name of declared) {
			expect(name, `${name} is a workspace package`).not.toMatch(/^@coopcli\//);
			expect(name, `${name} is a model client`).not.toMatch(
				/anthropic|openai|@google\/gen|bedrock|langchain|@ai-sdk|\bollama\b|claude-code/i,
			);
		}

		// No SDK import anywhere in the package, tests included — a client imported
		// by a test is a client in the tree.
		for (const file of sourceFiles()) {
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports a model client`).not.toMatch(
					/anthropic|openai|@google\/gen|bedrock|langchain|@ai-sdk|\bollama\b/i,
				);
			}
		}

		// The shipped code, and only it, for the rest: a test may legitimately
		// spawn a process with an environment, and the requirement is about what
		// the PACKAGE does.
		for (const file of sourceFiles().filter((f) => f.startsWith("src"))) {
			const code = codeOf(file);
			// No endpoint constructed. Something that knows a URL is something that
			// could dial it, whatever the port says.
			expect(code, `${file} constructs an endpoint`).not.toMatch(/https?:\/\//);
			expect(code, `${file} makes a network call`).not.toMatch(
				/\bfetch\s*\(|new\s+(WebSocket|XMLHttpRequest)/,
			);
			// No credential read or resolved. Reading `process.env` at all is the
			// line: the package has no configuration of its own to read from it.
			expect(code, `${file} reads a credential`).not.toMatch(
				/process\.env|API_KEY|apiKey|ANTHROPIC_|OPENAI_|Bearer\s/i,
			);
		}
	});
});

describe("platform-agentscript-authoring: The manifest and the specification agree", () => {
	it("The manifest and the specification agree", () => {
		// The spec used to claim this package was published. It is not, and is not
		// scheduled to be — so the claim was a folded requirement describing
		// something that did not exist, which is the state this repository's whole
		// lifecycle discipline exists to prevent. `retire-agentscript-publish-claim`
		// withdrew it and pinned the replacement here, against the repository
		// rather than against npm.
		expect(manifest.private, "the package must declare itself private").toBe(true);

		const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8");
		const publishSteps = workflow
			.split("\n")
			.filter((line) => /npm publish|working-directory:\s*packages\//.test(line))
			.join("\n");
		expect(publishSteps).not.toMatch(/agentscript/);

		// It IS type-checked, and that is correct — the distinction is "not published",
		// not "not gated". The verify job used to name this package on a hand-written
		// `--filter` line; it now runs the derived gate, which covers every package in
		// the workspace. So the assertion is that the gate runs AND that this package
		// is one it would run — asserting only the first would pass for a package the
		// gate had somehow stopped seeing.
		expect(workflow).toMatch(/node scripts\/type-check-all\.mjs/);
		const plan = execFileSync("node", [join(REPO_ROOT, "scripts/type-check-all.mjs"), "--plan"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		expect(plan).toMatch(/@coopcli\/agentscript → pnpm check/);

		// Not merely accurate: OIDC cannot bootstrap a package npm has never seen,
		// and every merge to the default branch releases — so a publish step for
		// this package would fail every merge, and the job creating the release tag
		// waits on it. The safe state and the honest state are the same state.
	});
});

describe("platform-agentscript-authoring: Consumed from elsewhere", () => {
	// Genuinely deleting specsketch to prove independence is not something a unit
	// test can do. What IS checkable, and is the property that matters: every
	// module the public entry pulls in stays inside this package or inside a
	// declared upstream dependency. If that holds, a consumer with no specsketch
	// on disk resolves the same graph this one does.
	it("closes over a module graph that never leaves the package", () => {
		expect(existsSync(join(REPO_ROOT, "packages", "specsketch"))).toBe(true);

		// Seeded from the MANIFEST, not from one hand-picked entry. Seeded with
		// `src/authoring/index.ts` alone, this walk reached `document.ts` and
		// `subset.ts` and stopped — `run.ts`, `compose.ts`, `scan.ts` and `port.ts`
		// were never traversed, so the package advertised two subpaths and the
		// closure test walked one.
		const seen = new Set<string>();
		const queue = exportTargets().map((target) => target.replace(/^\.\//, ""));
		expect(queue.length, "the manifest advertises no entry points").toBeGreaterThan(1);
		while (queue.length) {
			const file = queue.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			for (const spec of importsOf(file)) {
				if (!spec.startsWith(".")) continue;
				const resolved = join(dirname(file), spec.replace(/\.js$/, ".ts"));
				expect(resolved.startsWith("src/"), `${file} imports outside src: ${spec}`).toBe(true);
				expect(existsSync(join(PKG_DIR, resolved)), `${file} imports missing ${resolved}`).toBe(true);
				queue.push(resolved);
			}
		}
		// Both entries reach the interpreter's own modules, so the closure covers
		// the files that do the work rather than only the ones the authoring entry
		// happens to touch.
		expect(seen.size).toBeGreaterThan(1);
		for (const file of ["src/interpreter/run.ts", "src/interpreter/scan.ts", "src/interpreter/compose.ts"]) {
			expect(seen.has(file), `${file} is never reached from any advertised entry point`).toBe(true);
		}
	});

	it("publishes an entry point for every path its manifest advertises", () => {
		const targets = exportTargets();
		expect(targets.length).toBeGreaterThan(0);
		for (const target of targets) {
			expect(existsSync(join(PKG_DIR, target)), `${target} is missing`).toBe(true);
		}
	});

	it("exports the authoring surface a consumer needs", async () => {
		const surface = await import("../src/authoring/index.js");
		expect(Object.keys(surface)).toEqual(
			expect.arrayContaining(["Document", "analyze", "parse", "SUPPORTED_CONSTRUCTS"]),
		);
	});
});
