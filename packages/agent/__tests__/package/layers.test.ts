import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const DURABLE = [
	...PI.filter((dep) => dep !== "node"),
	"@earendil-works/pi-durable",
	"@earendil-works/chord",
	"src/openspec",
	"src/durable",
];
const MCP_SDK = "@modelcontextprotocol/sdk";
const NODE = [...DURABLE, "node", "src/claude-code", "src/node"];
const MCP = [...DURABLE, "node", "src/claude-code", MCP_SDK, "src/mcp"];
const TASK = [...NODE, "src/task"];
const CLOUDFLARE = [...DURABLE, "agents", "cloudflare:workers", "src/cloudflare"];
const OPENSPEC = ["typebox", "src/openspec"];
const ALLOWED: Record<string, readonly string[]> = {
	pi: PI,
	"claude-code": CLAUDE_CODE,
	durable: DURABLE,
	node: NODE,
	mcp: MCP,
	task: TASK,
	cloudflare: CLOUDFLARE,
	openspec: OPENSPEC,
};

describe("The layers import only their own peers and the layers beneath them", () => {
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

	it("Scenario: Only the mcp layer speaks MCP", () => {
		const files = filesUnder(SRC).filter((file) => !file.startsWith(`${join(SRC, "mcp")}/`));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			for (const spec of importsOf(file)) {
				expect(reduce(file, spec), `${relative(PKG_DIR, file)} imports ${spec}`).not.toBe(MCP_SDK);
			}
		}
		// A dynamic import of the SDK beside an app's static ones trips Bun's bundler (move-mcp-to-own-entry).
		for (const file of filesUnder(SRC)) {
			expect(codeOf(file), relative(PKG_DIR, file)).not.toMatch(/\bimport\s*\(\s*["']@modelcontextprotocol\//);
		}
	});

	it("Scenario: The durable layer records with the ontology", () => {
		const files = filesUnder(join(SRC, "durable"));
		expect(files.length).toBeGreaterThan(0);
		const reduced = new Set(files.flatMap((file) => importsOf(file).map((spec) => reduce(file, spec))));
		expect(reduced).toContain("src/openspec");
		expect(reduced).not.toContain("typebox");
	});

	it("Scenario: The durable layer is free of Node", () => {
		const nodeFree = (file: string, spec: string) => {
			const reduced = reduce(file, spec);
			const where = `${relative(PKG_DIR, file)} imports ${spec}`;
			expect(spec, where).not.toMatch(/^node:/);
			expect(["node", "src/claude-code", "src/node"], where).not.toContain(reduced);
		};

		const durable = filesUnder(join(SRC, "durable"));
		expect(durable.length).toBeGreaterThan(0);
		for (const file of durable) for (const spec of importsOf(file)) nodeFree(file, spec);

		// Everything src/cloudflare/ reaches inside src/, followed import by import.
		const seen = new Set<string>();
		const queue = filesUnder(join(SRC, "cloudflare"));
		expect(queue.length).toBeGreaterThan(0);
		while (queue.length > 0) {
			const file = queue.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			for (const spec of importsOf(file)) {
				nodeFree(file, spec);
				if (spec.startsWith(".")) queue.push(sourceOf(join(dirname(file), spec)));
			}
		}
		expect([...seen].some((file) => file.startsWith(`${join(SRC, "durable")}/`))).toBe(true);
	});
});

/** The `.ts` file a relative `.js` import names. */
function sourceOf(path: string): string {
	const file = path.replace(/\.js$/, ".ts");
	expect(existsSync(file), `${relative(PKG_DIR, file)} does not exist`).toBe(true);
	return file;
}

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

describe("Library modules reach no pi-ai lazy module statically", () => {
	it("Scenario: No library module statically imports a pi-ai lazy module", () => {
		const entryPoints = ["bin", "cli"].map((dir) => `${join(SRC, dir)}/`);
		const files = filesUnder(SRC).filter((file) => !entryPoints.some((dir) => file.startsWith(dir)));
		expect(files.length).toBeGreaterThan(0);
		// They load parts of pi-ai with import(); a static path to them breaks Bun bundles (fix-bun-lazy-pi-ai).
		const lazy = /^@earendil-works\/pi-ai\/(api\/[^/]+\.lazy(\.js)?|providers\/.+)$/;
		for (const file of files) {
			const statics = [...codeOf(file).matchAll(/\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map((m) => (m[1] ?? m[2]) as string);
			for (const spec of statics) expect(spec, `${relative(PKG_DIR, file)} imports ${spec}`).not.toMatch(lazy);
		}
	});
});
