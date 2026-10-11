import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXAMPLES = join(ROOT, "examples");
const ENTRIES = ["authoring", "interpreter", "pi", "claude-code", "durable", "cloudflare"].map(
	(entry) => `@specsesh/agent/${entry}`,
);

/** Every source file of every example, from disk, skipping installed and generated directories. */
function sourcesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return ["node_modules", ".wrangler", "dist"].includes(entry.name) ? [] : sourcesUnder(path);
		return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [path] : [];
	});
}

const importsOf = (file: string) =>
	[...readFileSync(file, "utf8").matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
		(m) => (m[1] ?? m[2]) as string,
	);

describe("The examples consume the package like any other project", () => {
	it("Scenario: Examples import only public entries", () => {
		const examples = readdirSync(EXAMPLES, { withFileTypes: true }).filter((entry) => entry.isDirectory());
		expect(examples.map((entry) => entry.name).sort()).toEqual(["cloudflare-worker", "hello-world"]);
		let packageImports = 0;
		for (const example of examples) {
			const dir = join(EXAMPLES, example.name);
			const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			expect(manifest.dependencies["@specsesh/agent"]).toBe("workspace:*");
			const workspaceDeps = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
				([, range]) => String(range).startsWith("workspace:"),
			);
			expect(workspaceDeps.map(([name]) => name)).toEqual(["@specsesh/agent"]);

			const files = sourcesUnder(dir);
			expect(files.length, `${example.name} has no source`).toBeGreaterThan(0);
			for (const file of files) {
				for (const spec of importsOf(file)) {
					if (spec === "@specsesh/agent" || spec.startsWith("@specsesh/agent/")) {
						packageImports += 1;
						expect(ENTRIES, `${relative(ROOT, file)} imports ${spec}`).toContain(spec);
					}
					if (spec.startsWith(".")) {
						const target = relative(ROOT, resolve(dirname(file), spec));
						expect(target.startsWith("packages/") || target.startsWith(".."), `${relative(ROOT, file)} reaches ${target}`).toBe(
							false,
						);
					}
				}
			}
		}
		expect(packageImports).toBeGreaterThan(0);
	});
});
