import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(PKG_DIR, "src", "openspec");
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));

/** Every `.ts` under src/openspec, from disk, so an untracked file is checked too. */
const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
	.filter((path) => path.endsWith(".ts"))
	.map((path) => join(SRC, path));

/** Source with comments stripped, so prose cannot read as an import. */
const codeOf = (file: string) =>
	readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

const importsOf = (file: string) =>
	[...codeOf(file).matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
		(m) => (m[1] ?? m[2] ?? m[3]) as string,
	);

describe("src/openspec imports only its schema library and its own files", () => {
	it("imports typebox and sibling files, nothing else", () => {
		expect(files.length).toBeGreaterThan(4);
		let imports = 0;
		for (const file of files) {
			for (const spec of importsOf(file)) {
				imports += 1;
				const where = `${relative(PKG_DIR, file)} imports ${spec}`;
				if (spec.startsWith(".")) {
					// A sibling: it resolves inside src/openspec.
					expect(relative(SRC, join(dirname(file), spec)).startsWith(".."), where).toBe(false);
					continue;
				}
				expect(spec === "typebox" || spec.startsWith("typebox/"), where).toBe(true);
			}
		}
		expect(imports).toBeGreaterThan(0);
	});

	it("uses no model client, no Node I/O, no peer and no environment", () => {
		const peers = Object.keys(manifest.peerDependencies ?? {});
		expect(peers.length).toBeGreaterThan(0);
		for (const file of files) {
			const code = codeOf(file);
			const where = relative(PKG_DIR, file);
			for (const spec of importsOf(file)) {
				expect(spec, where).not.toMatch(/^node:|^(fs|path|child_process|os|net|http|https)$/);
				expect(spec, where).not.toMatch(/anthropic|openai|@google\/gen|bedrock|langchain|@ai-sdk|ollama|claude-code/i);
				expect(peers.some((peer) => spec === peer || spec.startsWith(`${peer}/`)), `${where} imports the peer ${spec}`).toBe(false);
			}
			expect(code, `${where} reads the environment`).not.toMatch(/process\.(env|argv|exit|cwd)\b|\bfetch\s*\(/);
		}
	});

	it("typebox is the exact-pinned dependency it imports", () => {
		expect(manifest.dependencies.typebox).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
