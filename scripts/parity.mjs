// The provider parity matrix: renders parity.json into the root README's
// PARITY block and checks it (values, evidence, the command matrix in
// packages/agent/docs/providers/README.md). No dependencies.
//
//   node scripts/parity.mjs --write   rewrite the README block
//   node scripts/parity.mjs --check   print every problem; exit 1 if any
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROVIDERS = ["api-keys", "claude-code", "gemini", "ollama", "workers-ai"];
export const FEATURES = [
	"one-shot",
	"durable",
	"resume",
	"task",
	"cloudflare",
	"structured",
	"tools",
	"durable-tools",
	"mcp",
	"stream",
	"durable-stream",
	"abort",
	"categories",
	"durable-categories",
	"live",
];
export const VALUES = ["tested", "live", "untested", "no"];
export const BEGIN = "<!-- PARITY:BEGIN -->";
export const END = "<!-- PARITY:END -->";

const SYMBOLS = { tested: "✅", live: "🟢", untested: "⚪", no: "—" };
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const CLAIMED = new Set(["tested", "live"]);
// Parity rows checked against the command matrix's columns (design decision 5).
const COMMAND_COLUMNS = { "one-shot": ["agent"], durable: ["durable"], task: ["task", "change"], cloudflare: ["cloudflare"] };

const superscript = (n) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join("");
const evidenceName = (e) => e.test ?? e.script;

export function renderParity(data) {
	const notes = [];
	const rows = data.features.map((f) => {
		const cells = data.providers.map((p) => {
			const cell = f.cells[p];
			let text = SYMBOLS[cell.value] ?? cell.value;
			if (cell.note) {
				notes.push(cell.note);
				text += ` ${superscript(notes.length)}`;
			}
			return text;
		});
		return `| ${f.label} | ${cells.join(" | ")} |`;
	});
	const evidence = data.features.flatMap((f) =>
		data.providers
			.filter((p) => CLAIMED.has(f.cells[p].value) && f.cells[p].evidence?.length)
			.map((p) => `- **${f.label} × ${p}:** ${f.cells[p].evidence.map((e) => `\`${evidenceName(e)}\``).join("; ")}`),
	);
	const sections = [
		"✅ tested · 🟢 live only · ⚪ untested · — not supported",
		[
			`| Feature | ${data.providers.join(" | ")} |`,
			`|${"---|".repeat(data.providers.length + 1)}`,
			...rows,
		].join("\n"),
	];
	if (notes.length) sections.push(notes.map((n, i) => `${i + 1}. ${n}`).join("\n"));
	sections.push(["<details><summary>Evidence</summary>", "", ...evidence, "", "</details>"].join("\n"));
	return `${sections.join("\n\n")}\n`;
}

// The block is the text strictly between the markers: "\n" + renderParity(data),
// so the README reads BEGIN, a newline, the render (ending in "\n"), then END.
const blockOf = (data) => `\n${renderParity(data)}`;

export function extractBlock(readme) {
	const start = readme.indexOf(BEGIN);
	if (start < 0) return null;
	const from = start + BEGIN.length;
	const end = readme.indexOf(END, from);
	if (end < 0) return null;
	return readme.slice(from, end);
}

export function replaceBlock(readme, data) {
	const start = readme.indexOf(BEGIN);
	const end = start < 0 ? -1 : readme.indexOf(END, start + BEGIN.length);
	if (end < 0) throw new Error(`README.md has no ${BEGIN} … ${END} block`);
	return `${readme.slice(0, start + BEGIN.length)}${blockOf(data)}${readme.slice(end)}`;
}

const splitRow = (line) =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((c) => c.trim());
const stripMarks = (s) => s.replace(/[`*]/g, "").trim();

export function parseCommandMatrix(md) {
	const lines = md.split("\n");
	for (let i = 0; i + 1 < lines.length; i++) {
		if (!lines[i].trim().startsWith("|") || !/^\s*\|[\s|:-]+\|?\s*$/.test(lines[i + 1])) continue;
		const header = splitRow(lines[i]).map((h) => stripMarks(h).toLowerCase());
		if (!["agent", "durable", "task", "cloudflare"].every((c) => header.includes(c))) continue;
		const providers = [];
		const cells = {};
		for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) {
			const row = splitRow(lines[j]);
			const name = stripMarks(row[0]);
			providers.push(name);
			cells[name] = {};
			header.slice(1).forEach((column, k) => {
				cells[name][column] = (row[k + 1] ?? "").trim().toLowerCase();
			});
		}
		return { providers, cells };
	}
	return { providers: [], cells: {} };
}

const TEST_CALL = /\b(?:it|test)(?:\.\w+(?:\([^)]*\))?)*\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g;

export function collectTestNames(files) {
	const names = new Set();
	for (const { text } of files) {
		for (const m of text.matchAll(TEST_CALL)) {
			if (m[1] === "`" && m[2].includes("${")) continue;
			names.add(m[2].replace(/\\(['"`])/g, "$1"));
		}
	}
	return names;
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

export function parityProblems(data, { readme, testNames, commandMatrix, exists } = {}) {
	const problems = [];
	const providers = Array.isArray(data.providers) ? data.providers : [];
	const features = Array.isArray(data.features) ? data.features : [];

	if (!sameList(providers, PROVIDERS)) {
		problems.push(`providers are ${JSON.stringify(providers)}, expected ${JSON.stringify(PROVIDERS)}`);
	}
	const ids = features.map((f) => f.id);
	if (!sameList(ids, FEATURES)) {
		problems.push(`features are ${JSON.stringify(ids)}, expected ${JSON.stringify(FEATURES)}`);
	}
	if (commandMatrix && !sameList(commandMatrix.providers, providers)) {
		problems.push(
			`providers differ from docs/providers/README.md: ${JSON.stringify(providers)} vs ${JSON.stringify(commandMatrix.providers)}`,
		);
	}

	for (const f of features) {
		const cells = f.cells ?? {};
		if (typeof f.label !== "string" || !f.label.trim()) problems.push(`${f.id}: missing label`);
		for (const p of Object.keys(cells)) {
			if (!providers.includes(p)) problems.push(`${f.id} × ${p}: unknown provider`);
		}
		for (const p of providers) {
			const cell = cells[p];
			const at = `${f.id} × ${p}`;
			if (!cell) {
				problems.push(`${at}: missing cell`);
				continue;
			}
			if (!VALUES.includes(cell.value)) problems.push(`${at}: unknown value ${JSON.stringify(cell.value)}`);
			const evidence = cell.evidence ?? [];
			if (!Array.isArray(evidence)) {
				problems.push(`${at}: malformed evidence (not a list)`);
				continue;
			}
			if (CLAIMED.has(cell.value) && evidence.length === 0) problems.push(`${at}: ${cell.value} without evidence`);
			if ((cell.value === "untested" || cell.value === "no") && evidence.length > 0) {
				problems.push(`${at}: evidence on ${cell.value}`);
			}
			for (const e of evidence) {
				const keys = e && typeof e === "object" ? Object.keys(e) : [];
				if (keys.length === 1 && typeof e.test === "string") {
					if (testNames && !testNames.has(e.test)) problems.push(`${at}: test "${e.test}" not found`);
				} else if (keys.length === 1 && typeof e.script === "string") {
					if (exists && !exists(e.script)) problems.push(`${at}: script ${e.script} not found`);
				} else {
					problems.push(`${at}: malformed evidence ${JSON.stringify(e)} (neither { test } nor { script })`);
				}
			}
		}
	}

	if (commandMatrix) {
		for (const [id, columns] of Object.entries(COMMAND_COLUMNS)) {
			const f = features.find((x) => x.id === id);
			if (!f) continue;
			for (const p of providers) {
				const cell = f.cells?.[p];
				if (!cell) continue;
				const found = columns.map((c) => [c, commandMatrix.cells[p]?.[c]]);
				for (const [c, v] of found) {
					if (v === undefined) problems.push(`docs/providers/README.md has no ${c} cell for ${p}`);
				}
				const cmdNo = found.some(([, v]) => v === "no");
				if ((cell.value === "no") !== cmdNo) {
					const shown = found.filter(([, v]) => v !== undefined).map(([c, v]) => `${c}: ${v}`).join(", ");
					problems.push(`${id} × ${p}: "${cell.value}" disagrees with docs/providers/README.md (${shown})`);
				}
			}
		}
	}

	if (readme !== undefined) {
		const block = extractBlock(readme);
		if (block === null) problems.push("README.md has no parity block");
		else if (block !== blockOf(data)) problems.push("README.md parity block is stale; run pnpm parity");
	}
	return problems;
}

function walkTs(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walkTs(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
	);
}

function cli(argv) {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const readmePath = join(root, "README.md");
	const mode = argv.length === 1 ? argv[0] : undefined;
	if (mode !== "--write" && mode !== "--check") {
		console.error("usage: node scripts/parity.mjs --write | --check");
		return 2;
	}
	const data = JSON.parse(readFileSync(join(root, "parity.json"), "utf8"));
	const readme = readFileSync(readmePath, "utf8");
	if (mode === "--write") {
		if (extractBlock(readme) === null) {
			console.error(`README.md has no ${BEGIN} … ${END} block`);
			return 1;
		}
		writeFileSync(readmePath, replaceBlock(readme, data));
		return 0;
	}
	const sources = walkTs(join(root, "packages/agent/__tests__")).map((f) => ({ text: readFileSync(f, "utf8") }));
	const problems = parityProblems(data, {
		readme,
		testNames: collectTestNames(sources),
		commandMatrix: parseCommandMatrix(readFileSync(join(root, "packages/agent/docs/providers/README.md"), "utf8")),
		exists: (p) => existsSync(join(root, p)),
	});
	for (const p of problems) console.error(p);
	return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(cli(process.argv.slice(2)));
}
