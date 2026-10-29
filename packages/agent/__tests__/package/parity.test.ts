/**
 * package/parity: the provider parity matrix. The root README's block is the render of the root
 * `parity.json`, its providers and values are fixed, every claimed cell cites a test or script that
 * exists, and it agrees with the shipped command matrix. The drift scenarios run `parityProblems`
 * on mutated copies; nothing in the repo is edited.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");

type Evidence = { test: string } | { script: string };
type Cell = { value: string; note?: string; evidence?: Evidence[] };
type Feature = { id: string; label: string; cells: Record<string, Cell> };
type Parity = { providers: string[]; features: Feature[] };
type CommandMatrix = { providers: string[]; cells: Record<string, Record<string, string>> };
type Context = {
	readme?: string;
	testNames?: Set<string>;
	commandMatrix?: CommandMatrix;
	exists?: (path: string) => boolean;
};

const parity = (await import(pathToFileURL(join(root, "scripts/parity.mjs")).href)) as {
	BEGIN: string;
	END: string;
	renderParity: (data: Parity) => string;
	extractBlock: (readme: string) => string | null;
	replaceBlock: (readme: string, data: Parity) => string;
	parseCommandMatrix: (md: string) => CommandMatrix;
	collectTestNames: (files: { text: string }[]) => Set<string>;
	parityProblems: (data: Parity, context?: Context) => string[];
};

const data = JSON.parse(readFileSync(join(root, "parity.json"), "utf8")) as Parity;
const readme = readFileSync(join(root, "README.md"), "utf8");
const commandMatrix = parity.parseCommandMatrix(
	readFileSync(join(root, "packages/agent/docs/providers/README.md"), "utf8"),
);
const testsDir = join(root, "packages/agent/__tests__");
const testNames = parity.collectTestNames(
	(readdirSync(testsDir, { recursive: true }) as string[])
		.filter((f) => f.endsWith(".ts"))
		.map((f) => ({ text: readFileSync(join(testsDir, f), "utf8") })),
);
const exists = (path: string) => existsSync(join(root, path));

const STALE = "README.md parity block is stale";

/** The cell of `copy` at feature `id` × `provider`. */
function cellOf(copy: Parity, id: string, provider: string): Cell {
	const cell = copy.features.find((f) => f.id === id)?.cells[provider];
	if (!cell) throw new Error(`parity.json has no ${id} × ${provider} cell`);
	return cell;
}

/** The first cell of `copy` whose value is `value` and whose evidence holds a `test`. */
function cellWithTest(copy: Parity, value: string): { id: string; provider: string; cell: Cell } {
	for (const feature of copy.features) {
		for (const provider of copy.providers) {
			const cell = feature.cells[provider];
			if (cell?.value === value && cell.evidence?.some((e) => "test" in e)) return { id: feature.id, provider, cell };
		}
	}
	throw new Error(`no ${value} cell cites a test`);
}

describe("package/parity: the README block", () => {
	it("Scenario: The README block matches the render", () => {
		// --write puts a newline after BEGIN, then the render, which ends in a newline, then END.
		expect(parity.extractBlock(readme)).toBe(`\n${parity.renderParity(data)}`);
	});

	it("Scenario: A stale block is caught", () => {
		const base = parity.extractBlock(readme) === null ? `${readme}\n${parity.BEGIN}\n${parity.END}\n` : readme;
		const fresh = parity.replaceBlock(base, data);
		expect(parity.parityProblems(data, { readme: fresh })).toEqual([]);

		const block = parity.extractBlock(fresh) as string;
		const lines = block.split("\n");
		const row = lines.findIndex((l) => l.startsWith(`| ${data.features[0]?.label} |`));
		expect(row).toBeGreaterThan(-1);
		const shortened = lines.filter((_, i) => i !== row).join("\n");
		const stale = fresh.replace(block, shortened);

		const problems = parity.parityProblems(data, { readme: stale });
		expect(problems.some((p) => p.includes(STALE))).toBe(true);
	});
});

describe("package/parity: providers, features and values", () => {
	it("Scenario: Providers match the command matrix", () => {
		const fixed = ["api-keys", "claude-code", "gemini", "ollama", "workers-ai"];
		expect(commandMatrix.providers).toEqual(fixed);
		expect(data.providers).toEqual(commandMatrix.providers);
		expect(parity.parityProblems(data, { commandMatrix }).filter((p) => p.startsWith("providers"))).toEqual([]);
	});

	it("Scenario: A cell with an unknown value is refused", () => {
		const copy = structuredClone(data);
		const cell = cellOf(copy, "mcp", "ollama");
		cell.value = "maybe";
		delete cell.evidence;

		const problems = parity.parityProblems(copy, { testNames, exists });
		expect(problems.some((p) => p.includes("mcp × ollama") && p.includes("maybe"))).toBe(true);
	});
});

describe("package/parity: evidence", () => {
	it("Scenario: Every cited test and script exists", () => {
		expect(parity.parityProblems(data, { testNames, exists })).toEqual([]);
	});

	it("Scenario: A renamed test is caught", () => {
		const copy = structuredClone(data);
		const { id, provider, cell } = cellWithTest(copy, "tested");
		const name = "Scenario: no such test xyz";
		cell.evidence = [{ test: name }];

		const problems = parity.parityProblems(copy, { testNames, exists });
		expect(problems.some((p) => p.includes(`${id} × ${provider}`) && p.includes(name))).toBe(true);
	});

	it("Scenario: A tested cell without evidence is caught", () => {
		const copy = structuredClone(data);
		const { id, provider, cell } = cellWithTest(copy, "tested");
		cell.evidence = [];

		const problems = parity.parityProblems(copy, { testNames, exists });
		expect(problems.some((p) => p.includes(`${id} × ${provider}`))).toBe(true);
	});
});

describe("package/parity: the command matrix", () => {
	it("Scenario: The repo's matrices agree", () => {
		expect(parity.parityProblems(data, { commandMatrix })).toEqual([]);
	});

	it("Scenario: A contradiction is caught", () => {
		const copy = structuredClone(data);
		Object.assign(cellOf(copy, "cloudflare", "ollama"), {
			value: "tested",
			evidence: [{ script: "examples/cloudflare-worker/test/routes.sh" }],
		});

		const problems = parity.parityProblems(copy, { commandMatrix });
		expect(problems.some((p) => p.includes("cloudflare × ollama") && p.includes("docs/providers/README.md"))).toBe(
			true,
		);
	});
});
