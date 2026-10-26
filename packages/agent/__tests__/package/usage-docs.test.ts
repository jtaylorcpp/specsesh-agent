/**
 * package/usage-docs: the shipped provider and deployment pages and their matrix. Each page has one
 * shape, the matrix holds the agreed values, each local `yes` is a provider the CLIs' collection
 * resolves, the pages' links and `.agent` paths hold, and the readme points at every page.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MutableModels } from "@earendil-works/pi-ai";
import { cliModels } from "../../src/bin/models.js";
import { main } from "../../src/cli/index.js";
import { registerOllama } from "../../src/pi/ollama.js";
import { startFakeOllama, type FakeOllama } from "../pi/fake-ollama.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_DIR = join(PKG_DIR, "..", "..");
const PROVIDERS = join(PKG_DIR, "docs", "providers");

const PROVIDER_PAGES = ["api-keys", "claude-code", "ollama", "workers-ai"];
const PROVIDER_SECTIONS = ["## Setup", "## Models", "## Where it runs", "## Limits"];
const DEPLOY_PAGES = ["local", "cloudflare"];
const DEPLOY_SECTIONS = ["## Setup", "## Providers", "## Running and resuming", "## Limits"];

/** Every page under test, by path relative to the package, with the `##` headings it must carry in order. */
const PAGES: { path: string; sections: string[] }[] = [
	...PROVIDER_PAGES.map((name) => ({ path: `docs/providers/${name}.md`, sections: PROVIDER_SECTIONS })),
	...DEPLOY_PAGES.map((name) => ({ path: `docs/deploy/${name}.md`, sections: DEPLOY_SECTIONS })),
];

/** The seven shipped pages, by path relative to the package. */
const ALL_PAGES = ["docs/providers/README.md", ...PAGES.map(({ path }) => path)];

/**
 * The relative links in `markdown` that don't resolve against `dir`, one message per link naming
 * `fileName`. `http(s):`, `mailto:` and pure `#anchor` links are skipped; a `#fragment` is dropped.
 */
function brokenLinks(fileName: string, markdown: string, dir: string): string[] {
	return [...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
		.map((m) => m[1]!)
		.filter((link) => !/^(https?:|mailto:|#)/.test(link))
		.filter((link) => !existsSync(resolve(dir, link.replace(/#.*$/, ""))))
		.map((link) => `${fileName}: broken link ${link}`);
}

/**
 * The `.agent` paths `markdown` names: tokens with a `/` ending in `.agent`, resolved against
 * `dir` when they start with `.`, else against the repository root. A bare `triage.agent` is a
 * file the reader writes, not a path in the repository.
 */
function agentPaths(markdown: string, dir: string): string[] {
	return [...markdown.matchAll(/[\w.-]*(?:\/[\w.-]+)+\.agent\b/g)].map((m) => resolve(m[0].startsWith(".") ? dir : REPO_DIR, m[0]));
}

/** What's wrong with a page's shape: a `# ` heading, a one-line summary paragraph, then `sections` in order. */
function shapeProblems(path: string, sections: readonly string[]): string[] {
	const lines = readFileSync(join(PKG_DIR, path), "utf8").split("\n");
	const problems: string[] = [];
	if (!lines[0]?.startsWith("# ")) problems.push(`${path}: the first line is not a "# " heading`);
	const start = lines.findIndex((line, i) => i > 0 && line.trim() !== "");
	const summary = start < 0 ? [] : lines.slice(start, lines.findIndex((line, i) => i > start && line.trim() === ""));
	if (summary.length !== 1 || summary[0]!.startsWith("#")) problems.push(`${path}: no one-line summary after the heading`);
	const found = lines.filter((line) => line.startsWith("## "));
	if (JSON.stringify(found) !== JSON.stringify(sections)) problems.push(`${path}: sections ${JSON.stringify(found)}, want ${JSON.stringify(sections)}`);
	return problems;
}

/** The one Markdown table in `markdown`, as row name → column name → cell. */
function parseTable(markdown: string): { columns: string[]; rows: Record<string, Record<string, string>> } {
	const lines = markdown.split("\n").filter((line) => line.trim().startsWith("|"));
	const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
	const [header, separator, ...body] = lines;
	expect(separator, "the table has no separator row").toMatch(/^\|(\s*:?-+:?\s*\|)+$/);
	const columns = cells(header!);
	for (const line of body) expect(line, "more than one table").not.toMatch(/^\|(\s*:?-+:?\s*\|)+$/);
	const rows = Object.fromEntries(
		body.map((line) => {
			const values = cells(line);
			return [values[0]!, Object.fromEntries(columns.slice(1).map((column, i) => [column, values[i + 1]!]))];
		}),
	);
	return { columns, rows };
}

const MATRIX = {
	"api-keys": { agent: "yes", durable: "yes", task: "yes", change: "yes", cloudflare: "yes" },
	"claude-code": { agent: "yes", durable: "yes", task: "yes", change: "yes", cloudflare: "no" },
	ollama: { agent: "yes", durable: "yes", task: "yes", change: "yes", cloudflare: "no" },
	"workers-ai": { agent: "no", durable: "no", task: "no", change: "no", cloudflare: "yes" },
};

/** A matrix row's provider id in the CLIs' collection: `api-keys` stands for pi-ai's built-ins. */
const PROVIDER_OF: Record<string, string> = { "api-keys": "anthropic", "claude-code": "claude-code", ollama: "ollama", "workers-ai": "workers-ai" };

const matrixPage = () => readFileSync(join(PROVIDERS, "README.md"), "utf8");

describe("Each page has the same shape", () => {
	it("Scenario: Every page has its sections", () => {
		expect(PAGES.flatMap(({ path, sections }) => shapeProblems(path, sections))).toEqual([]);
		expect(shapeProblems("docs/providers/README.md", [])).toEqual([]);
	});
});

describe("The matrix says which provider runs where", () => {
	let ollama: FakeOllama;
	let models: MutableModels;

	beforeAll(async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"] });
		models = await cliModels();
		expect(await registerOllama(models, { baseUrl: ollama.url })).toEqual({ ok: true, baseUrl: ollama.url, models: 1 });
	});
	afterAll(() => ollama.close());

	it("Scenario: The matrix holds the agreed values", () => {
		const { columns, rows } = parseTable(matrixPage());
		expect(columns).toEqual(["provider", "agent", "durable", "task", "change", "cloudflare"]);
		expect(rows).toEqual(MATRIX);
	});

	it("Scenario: Each local yes resolves", () => {
		const { rows } = parseTable(matrixPage());
		const providers = models.getProviders().map((provider) => provider.id);
		for (const [row, cells] of Object.entries(rows)) {
			if (cells["durable"] === "yes") expect(providers, row).toContain(PROVIDER_OF[row]);
		}
		expect(providers).toEqual(expect.arrayContaining(["anthropic", "claude-code", "ollama"]));
		expect(providers).not.toContain("workers-ai");
	});

	// Task-only (add-provider-deploy-docs 1.1): the matrix page links each provider page.
	it("links each provider page, and each link resolves", () => {
		const links = [...matrixPage().matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]!);
		for (const name of PROVIDER_PAGES) expect(links).toContain(`${name}.md`);
		for (const link of links) expect(existsSync(join(PROVIDERS, link)), `README.md links ${link}`).toBe(true);
	});
});

describe("Links and scripts in the pages hold", () => {
	it("every relative link in the seven pages resolves", () => {
		const broken = ALL_PAGES.flatMap((path) => brokenLinks(path, readFileSync(join(PKG_DIR, path), "utf8"), dirname(join(PKG_DIR, path))));
		expect(broken).toEqual([]);
	});

	it("Scenario: A broken link fails by name", () => {
		const path = join(PKG_DIR, "docs/deploy/local.md");
		const markdown = readFileSync(path, "utf8");
		const link = "../providers/ollama.md";
		expect(markdown).toContain(`](${link})`);
		expect(brokenLinks("local.md", markdown, dirname(path))).toEqual([]);

		const broken = brokenLinks("local.md", markdown.replace(`](${link})`, "](../providers/missing.md)"), dirname(path));
		expect(broken).toEqual(["local.md: broken link ../providers/missing.md"]);
	});

	it("every .agent path the pages name exists and passes specsesh agent check", async () => {
		const paths = [...new Set(ALL_PAGES.flatMap((path) => agentPaths(readFileSync(join(PKG_DIR, path), "utf8"), dirname(join(PKG_DIR, path)))))];
		expect(paths.length).toBeGreaterThan(0);
		for (const path of paths) {
			expect(existsSync(path), `${path} does not exist`).toBe(true);
			const lines: string[] = [];
			const code = await main(["agent", "check", path], { out: (line) => lines.push(line), err: (line) => lines.push(line) });
			expect(code, `${path}: ${lines.join("\n")}`).toBe(0);
		}
	});
});

describe("The readme points at the pages", () => {
	const readme = readFileSync(join(PKG_DIR, "README.md"), "utf8");

	/** The lines of the `## heading` section, up to the next `## `. */
	function section(heading: string): string[] {
		const lines = readme.split("\n");
		const start = lines.indexOf(heading);
		expect(start, `no ${heading}`).toBeGreaterThanOrEqual(0);
		const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
		return lines.slice(start, next < 0 ? undefined : next);
	}

	it("Scenario: The readme links every page", () => {
		const links = [...readme.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)].map((m) => m[1]!);
		for (const page of ALL_PAGES) expect(links, page).toContain(page);
		for (const [heading, page] of [
			["## Durable runs on Node", "docs/deploy/local.md"],
			["## On Cloudflare", "docs/deploy/cloudflare.md"],
		] as const) {
			const lines = section(heading);
			expect(lines.length, `${heading} has ${lines.length} lines`).toBeLessThanOrEqual(40);
			expect(lines.join("\n"), heading).toContain(`](${page})`);
		}
		expect(readme).not.toContain("without actions");
	});
});

describe("The provider and deployment pages ship", () => {
	it("Scenario: The pages are packed", () => {
		const [packed] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PKG_DIR, encoding: "utf8" })) as [
			{ files: { path: string }[] },
		];
		const paths = packed.files.map((file) => file.path);
		for (const page of ALL_PAGES) expect(paths).toContain(page);
	});

	it("Scenario: The build requires them", () => {
		const missing = "docs/deploy/cloudflare.md";
		// A copy of the script beside every asset it requires but `missing`.
		const root = mkdtempSync(join(tmpdir(), "specsesh-assets-"));
		mkdirSync(join(root, "scripts"));
		copyFileSync(join(PKG_DIR, "scripts/check-assets.mjs"), join(root, "scripts/check-assets.mjs"));
		mkdirSync(join(root, "templates"));
		mkdirSync(join(root, "docs/language"), { recursive: true });
		mkdirSync(join(root, "docs/llm"));
		mkdirSync(join(root, "docs/providers"));
		mkdirSync(join(root, "docs/deploy"));
		const assets = [
			"templates/new.agent",
			"templates/SKILL.md",
			...["guide", "change", "task", "agent", "durable"].map((page) => `docs/llm/${page}.md`),
			...ALL_PAGES,
		];
		for (const asset of assets) if (asset !== missing) writeFileSync(join(root, asset), "");

		const ok = spawnSync(process.execPath, [join(root, "scripts/check-assets.mjs")], { encoding: "utf8" });
		expect(ok.stderr).toBe(`check-assets: ${missing} does not exist\n`);
		expect(ok.status).toBe(1);

		writeFileSync(join(root, missing), "");
		expect(spawnSync(process.execPath, [join(root, "scripts/check-assets.mjs")], { encoding: "utf8" }).status).toBe(0);
	});
});
