import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(PKG_DIR, "src");

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return filesUnder(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

/** Source with comments stripped, so prose cannot read as an import. */
const codeOf = (file: string) =>
	readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

const importsOf = (file: string) =>
	[...codeOf(file).matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
		(m) => (m[1] ?? m[2]) as string,
	);

/**
 * An import reduced to what the layer rule talks about: `node` for a builtin, the
 * package name for a bare specifier, `src/<dir>` for a relative one.
 */
function reduce(file: string, spec: string): string {
	if (spec.startsWith(".")) {
		const [dir] = relative(SRC, join(dirname(file), spec)).split("/");
		return `src/${dir}`;
	}
	if (spec.startsWith("node:") || builtinModules.includes(spec)) return "node";
	if (spec.startsWith("cloudflare:")) return spec;
	return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
}

const CORE = ["node", "src/authoring", "src/interpreter"];
const PI = [...CORE, "@earendil-works/pi-ai", "src/pi"];
const CLAUDE_CODE = [...PI, "src/claude-code"];
const DURABLE = [...CLAUDE_CODE, "@earendil-works/pi-durable", "@earendil-works/chord", "src/durable"];
const CLOUDFLARE = [...DURABLE, "agents", "cloudflare:workers", "src/cloudflare"];
const OPENSPEC = ["typebox", "src/openspec"];
const ALLOWED: Record<string, readonly string[]> = {
	pi: PI,
	"claude-code": CLAUDE_CODE,
	durable: DURABLE,
	cloudflare: CLOUDFLARE,
	openspec: OPENSPEC,
};

describe("Each layer imports only its own peers and the layers beneath it", () => {
	it("Scenario: The layer graph holds", () => {
		for (const [layer, allowed] of Object.entries(ALLOWED)) {
			const files = filesUnder(join(SRC, layer));
			expect(files.length, `read no file in src/${layer}`).toBeGreaterThan(0);
			for (const file of files) {
				for (const spec of importsOf(file)) {
					const reduced = reduce(file, spec);
					expect(allowed, `src/${layer}/${relative(join(SRC, layer), file)} imports ${spec} (${reduced})`).toContain(reduced);
				}
			}
		}
	});

	it("Scenario: Nothing outside cloudflare touches Workers", () => {
		const files = filesUnder(SRC).filter((file) => !file.startsWith(`${join(SRC, "cloudflare")}/`));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			for (const spec of importsOf(file)) {
				expect(spec, `${relative(PKG_DIR, file)} imports ${spec}`).not.toMatch(/^agents(\/|$)|^cloudflare:workers$/);
			}
		}
	});
});

describe("The model is Workers AI unless faux mode is on", () => {
	it("Scenario: The published host has no faux mode", () => {
		const files = filesUnder(join(SRC, "cloudflare"));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			expect(text, `${relative(PKG_DIR, file)} has faux mode`).not.toContain("AGENTSCRIPT_FAUX");
			expect(text, `${relative(PKG_DIR, file)} has faux mode`).not.toContain("fauxProvider");
		}
	});
});
