// Checks docs/ against docs/CONVENTIONS.md: every concept page has valid front
// matter, ids are unique and match file names, related ids exist, README lists
// every page exactly once. A page's `spec` entries name the requirements it restated when this
// repo kept OpenSpec specs (removed 2026-11-06); they are history and are not checked.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const docs = join(root, "docs");
const NOT_CONCEPTS = new Set(["README.md", "overview.md", "CONVENTIONS.md"]);
const KINDS = new Set(["type", "step", "loop", "state-machine", "rule"]);
const AREAS = new Set(["taxonomy", "process", "loops", "evidence"]);
const STATUSES = new Set(["modelled", "implemented"]);
const problems = [];

const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
	);

function frontMatter(text, file) {
	const m = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!m) return problems.push(`${file}: no front matter`), undefined;
	const fm = {};
	let list;
	for (const line of m[1].split("\n")) {
		const item = line.match(/^\s+-\s+"?(.*?)"?\s*$/);
		if (item && list) { fm[list].push(item[1]); continue; }
		const kv = line.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
		if (!kv) continue;
		const [, key, raw] = kv;
		if (raw === "") { fm[key] = []; list = key; continue; }
		list = undefined;
		fm[key] = raw.startsWith("[") ? raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean) : raw.replace(/^"|"$/g, "");
	}
	return fm;
}

const pages = walk(docs).filter((f) => !NOT_CONCEPTS.has(relative(docs, f)));
if (pages.length === 0) problems.push("found no concept pages under docs/");
const byId = new Map();
for (const file of pages) {
	const rel = relative(docs, file);
	const fm = frontMatter(readFileSync(file, "utf8"), rel);
	if (!fm) continue;
	const id = basename(file, ".md");
	if (fm.id !== id) problems.push(`${rel}: id "${fm.id}" does not match the file name "${id}"`);
	if (byId.has(fm.id)) problems.push(`${rel}: id "${fm.id}" also used by ${byId.get(fm.id).rel}`);
	for (const key of ["name", "kind", "area", "status"]) if (!fm[key]) problems.push(`${rel}: missing ${key}`);
	if (fm.kind && !KINDS.has(fm.kind)) problems.push(`${rel}: kind "${fm.kind}" is not one of ${[...KINDS].join(", ")}`);
	if (fm.area && !AREAS.has(fm.area)) problems.push(`${rel}: area "${fm.area}" is not one of ${[...AREAS].join(", ")}`);
	if (fm.status && !STATUSES.has(fm.status)) problems.push(`${rel}: status "${fm.status}" is not one of ${[...STATUSES].join(", ")}`);
	byId.set(fm.id, { rel, fm });
}
for (const { rel, fm } of byId.values()) {
	for (const r of Array.isArray(fm.related) ? fm.related : []) {
		if (!byId.has(r)) problems.push(`${rel}: related "${r}" has no page`);
	}
}

const readme = readFileSync(join(docs, "README.md"), "utf8");
const listed = [...readme.matchAll(/^\| \[[^\]]+\]\(([^)]+\.md)\) \| `([^`]+)` \|/gm)];
const seen = new Map();
for (const [, path, id] of listed) {
	if (seen.has(path)) problems.push(`README lists ${path} twice`);
	seen.set(path, id);
	if (basename(path, ".md") !== id) problems.push(`README: ${path} is listed with id "${id}"`);
}
for (const file of pages) {
	const rel = relative(docs, file);
	if (!seen.has(rel)) problems.push(`README does not list ${rel}`);
}
for (const path of seen.keys()) {
	if (!pages.some((f) => relative(docs, f) === path)) problems.push(`README lists ${path}, which has no page`);
}

// Every relative link in docs/ must resolve to a file.
let links = 0;
for (const file of walk(docs)) {
	const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
	for (const [, target] of text.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
		if (/^[a-z]+:/.test(target)) continue;
		links += 1;
		const resolved = join(file, "..", target);
		try {
			readFileSync(resolved);
		} catch {
			problems.push(`${relative(docs, file)}: link ${target} does not resolve`);
		}
	}
}
if (links === 0) problems.push("found no relative links in docs/; the link check would pass vacuously");

if (problems.length > 0) {
	console.error(`docs:check found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
	process.exit(1);
}
console.log(`docs:check: ${pages.length} concept pages, ${listed.length} README entries — ${links} links resolved — all consistent`);
