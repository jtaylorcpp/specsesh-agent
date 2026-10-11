import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every `.ts` under a directory, read from disk so nothing depends on git. */
function walkTs(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walkTs(path) : entry.name.endsWith(".ts") ? [path] : [];
	});
}
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));

/**
 * The compiler ships in `@sf-agentscript/agentforce`. Its only output target is
 * a Salesforce-internal specification format that executes on Salesforce
 * infrastructure — so a compile from here would produce a build nobody can run.
 *
 * These assert the boundary is STRUCTURAL. A test that only checked "we never
 * call compileSource" would pass forever while someone added the import.
 */
describe("platform-agentscript-authoring: The compiler is not reachable", () => {
	it("does not depend on the package that carries the compiler", () => {
		const declared = Object.keys({
			...(manifest.dependencies ?? {}),
			...(manifest.peerDependencies ?? {}),
			...(manifest.optionalDependencies ?? {}),
		});
		// Exact names: `@sf-agentscript/agentforce-dialect` is a legitimate
		// dependency (schema + lint). `@sf-agentscript/agentforce` is the SDK that
		// carries the compiler, and is not.
		expect(declared).not.toContain("@sf-agentscript/agentforce");
		expect(declared).not.toContain("@sf-agentscript/compiler");
	});

	it("has no compiler anywhere in its resolved dependency tree", () => {
		// Transitive, not just direct: a dialect that pulled the compiler in
		// would make it reachable without appearing in our manifest.
		const tree = execFileSync("pnpm", ["ls", "--depth", "10"], {
			cwd: PKG_DIR,
			encoding: "utf8",
		});
		// `agentforce-dialect` is schema and lint rules and IS a dependency — it is
		// where `subagent`/`reasoning` are defined. `agentforce` (no suffix) is the
		// SDK that carries compileSource(). One character apart, opposite meanings.
		expect(tree).not.toMatch(/@sf-agentscript\/agentforce(?!-dialect)/);
		expect(tree).not.toMatch(/@sf-agentscript\/compiler/);
	});

	it("exposes no export whose name offers compilation", () => {
		const surface = Object.keys(manifest.exports ?? {});
		expect(surface.length).toBeGreaterThan(0);
		for (const path of surface) {
			expect(path).not.toMatch(/compile|emit-runtime|salesforce/i);
		}
	});

	it("names no compiler symbol in its own source", () => {
		// Read from DISK, not `git ls-files`. An untracked file is exactly the one
		// this check needs to see, and a listing that skips it makes the loop below
		// iterate over nothing and pass while proving nothing. This test did that
		// for its whole life until the package was first committed.
		const files = walkTs(join(PKG_DIR, "src"));
		expect(files.length, "no source files found — this check would pass vacuously").toBeGreaterThan(0);

		// The source may DISCUSS the compiler in a comment — that is how the
		// boundary stays understood. What it may not do is import or call it.
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
			expect(code, `${file} calls the upstream compiler`).not.toMatch(/compileSource\s*\(/);
			// `agentforce-dialect` is schema and lint rules and IS a dependency — it
			// is where `subagent`/`reasoning` are defined. `agentforce` with no
			// suffix is the SDK carrying compileSource(). One hyphen apart, opposite
			// meanings, so the boundary has to be spelled exactly.
			expect(code, `${file} imports the compiler package`).not.toMatch(
				/from\s+["']@sf-agentscript\/(agentforce(?!-dialect)|compiler)/,
			);
		}
	});
});
