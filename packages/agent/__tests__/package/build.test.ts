import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// dist/ is built by the suite's global setup (`pnpm build`).
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(path) : [relative(PKG_DIR, path)];
	});
}

describe("The build emits JavaScript and declarations file for file", () => {
	it("Scenario: Every source file has its outputs", () => {
		const sources = filesUnder(join(PKG_DIR, "src")).filter((file) => file.endsWith(".ts"));
		expect(sources.length).toBeGreaterThan(0);
		for (const source of sources) {
			const base = source.replace(/^src\//, "dist/").replace(/\.ts$/, "");
			for (const out of [`${base}.js`, `${base}.d.ts`, `${base}.js.map`]) {
				expect(existsSync(join(PKG_DIR, out)), `${source} has no ${out}`).toBe(true);
			}
		}
		// The bundled task scripts are copied as they are, and are the only files not compiled.
		const scripts = filesUnder(join(PKG_DIR, "src", "task", "scripts")).filter((file) => file.endsWith(".agent"));
		expect(scripts.length).toBeGreaterThan(0);
		const copied = filesUnder(join(PKG_DIR, "dist", "task", "scripts"));
		expect(copied.sort()).toEqual(scripts.map((file) => file.replace(/^src\//, "dist/")).sort());
		for (const script of scripts) {
			expect(readFileSync(join(PKG_DIR, script.replace(/^src\//, "dist/")), "utf8"), script).toBe(readFileSync(join(PKG_DIR, script), "utf8"));
		}
		// Nothing else in dist/ comes from anywhere but src/: every output maps back to a source.
		const sourceSet = new Set(sources);
		const outputs = filesUnder(join(PKG_DIR, "dist")).filter((out) => !copied.includes(out));
		expect(outputs.length).toBe(sources.length * 3);
		for (const out of outputs) {
			expect(out, `${out} came from the tests`).not.toMatch(/__tests__|\.test\./);
			const source = out.replace(/^dist\//, "src/").replace(/\.d\.ts$|\.js\.map$|\.js$/, ".ts");
			expect(sourceSet.has(source), `${out} has no source in src/`).toBe(true);
		}
	});
});

describe("The tarball holds only the build, the readme and the license", () => {
	it("Scenario: The packed file list is clean", () => {
		const report = JSON.parse(
			execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG_DIR, encoding: "utf8" }),
		) as { files: { path: string }[] }[];
		const paths = report[0]!.files.map((file) => file.path);
		expect(paths).toEqual(expect.arrayContaining(["package.json", "README.md", "LICENSE", "templates/new.agent"]));
		expect(paths.filter((path) => path.startsWith("dist/")).length).toBeGreaterThan(0);
		expect(paths.some((path) => path.startsWith("docs/language/")), "no docs/language/ in the tarball").toBe(true);
		for (const path of paths) {
			const allowed = ["package.json", "README.md", "LICENSE"].includes(path) || /^(dist|docs|templates)\//.test(path);
			expect(allowed, path).toBe(true);
			expect(path.endsWith(".ts") && !path.endsWith(".d.ts"), `${path} is TypeScript source`).toBe(false);
		}
	});
});
