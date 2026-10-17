/**
 * The `specsesh` commands that explain the package.
 *
 *   specsesh agents [--json]             the bundled scripts, from `bundled.ts`
 *   specsesh agents show <name> [--json] one script's source, exactly as shipped
 *   specsesh language [topic] [--json]   the Agent Script reference, from `docs/language/`
 *   specsesh actions [--json]            the built-in host actions, from their definitions
 *   specsesh check <file.agent>… [--json] what a run would refuse, with no model
 *   specsesh new agent <name> [--out <path>] a starter script, from `templates/new.agent`
 *
 * Exit 0 on success and 2 on usage or an unknown name, like the bins. `check`
 * exits 1 when a file would not run, and `new` when its target already exists.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../authoring/index.js";
import { deleteActions } from "../durable/actions.js";
import { memoryWorkspace, searchActions, workspaceActions } from "../durable/workspace.js";
import { type Range, documentRoot, isUnreportedRange } from "../interpreter/ast.js";
import { collectUndeclaredReferences, readDeclarations, readSubagents } from "../interpreter/compose.js";
import { scanDocument } from "../interpreter/scan.js";
import { SUPPORTED_CONSTRUCTS } from "../interpreter/subset.js";
import { type BundledScript, type ListOptions, listBundled } from "./bundled.js";

export interface ExplainDeps extends ListOptions {
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** Raw stdout, for a source printed byte for byte. Default `process.stdout.write`. */
	readonly write?: (chunk: Uint8Array) => void;
}

export const AGENTS_USAGE = "usage: specsesh agents [--json]\n       specsesh agents show <name> [--json]";

export async function runAgents(argv: readonly string[], deps: ExplainDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const write = deps.write ?? ((chunk) => process.stdout.write(chunk));
	const json = argv.includes("--json");
	const args = argv.filter((a) => a !== "--json");
	const unknownFlag = args.find((a) => a.startsWith("-"));
	if (unknownFlag !== undefined) {
		err(`unknown option ${unknownFlag}`);
		err(AGENTS_USAGE);
		return 2;
	}
	const scripts = listBundled(deps);
	if (args.length === 0) {
		if (json) out(JSON.stringify(scripts.map(summary), null, 2));
		else for (const line of table(scripts)) out(line);
		return 0;
	}
	if (args[0] !== "show" || args.length > 2) {
		err(AGENTS_USAGE);
		return 2;
	}
	const name = args[1];
	if (name === undefined) {
		err("usage: specsesh agents show <name>");
		return 2;
	}
	const script = scripts.find((s) => s.name === name);
	if (script === undefined) {
		err(`unknown agent "${name}"; known agents: ${scripts.map((s) => s.name).join(", ")}`);
		return 2;
	}
	if (json) {
		out(JSON.stringify({ name: script.name, ...(script.path === undefined ? {} : { path: script.path }), source: script.source }, null, 2));
	} else {
		write(script.path === undefined ? Buffer.from(script.source, "utf8") : readFileSync(script.path));
	}
	return 0;
}

function summary(script: BundledScript) {
	const { source: _source, ...rest } = script;
	return rest;
}

function table(scripts: readonly BundledScript[]): string[] {
	const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
	const list = (names: readonly string[]) => (names.length === 0 ? "—" : names.map((n) => `\`${n}\``).join(", "));
	return [
		"| name | description | runs via | reads | writes |",
		"|---|---|---|---|---|",
		...scripts.map(
			(s) => `| \`${s.name}\` | ${cell(s.description)} | ${cell(s.runBy)} | ${list(s.reads)} | ${list(s.writes)} |`,
		),
	];
}

/**
 * The language topics, in reading order. A topic file's first line is its summary
 * (`add-agent-language-docs`); the one here stands in until that file ships.
 * `subset` has no file: it is generated from `SUPPORTED_CONSTRUCTS`.
 */
export const TOPICS: readonly { readonly name: string; readonly summary: string }[] = [
	{ name: "overview", summary: "what an Agent Script file is and how a run goes through it" },
	{ name: "config", summary: "the config block that names the agent" },
	{ name: "system", summary: "standing instructions every step sees" },
	{ name: "variables", summary: "declared, typed state with literal defaults" },
	{ name: "subagents", summary: "named subagents, each one step of the run" },
	{ name: "prompts", summary: "prompt lines, the text the model reads" },
	{ name: "interpolation", summary: "`{!@variables.x}` inside a prompt line" },
	{ name: "logic", summary: "`if` and `set` lines, run without the model" },
	{ name: "outputs", summary: "setting variables from a step's structured result" },
	{ name: "actions", summary: "actions bound to host tools, offered to the model" },
	{ name: "run", summary: "`run @actions.x`, calling an action deterministically" },
	{ name: "refused", summary: "what the interpreter refuses, and why" },
	{ name: "subset", summary: "the supported constructs, generated from the interpreter" },
];

/** The shipped topic texts, beside `src/` and `dist/` alike. */
export const LANGUAGE_DIR: string = fileURLToPath(new URL("../../docs/language/", import.meta.url));

/** The package README, which a missing topic points at. */
const README: string = fileURLToPath(new URL("../../README.md", import.meta.url));

export interface LanguageDeps {
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** The topic texts' directory. Default `LANGUAGE_DIR`. */
	readonly dir?: string;
}

export const LANGUAGE_USAGE = "usage: specsesh language [topic] [--json]";

export async function runLanguage(argv: readonly string[], deps: LanguageDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const dir = deps.dir ?? LANGUAGE_DIR;
	const json = argv.includes("--json");
	const args = argv.filter((a) => a !== "--json");
	const unknownFlag = args.find((a) => a.startsWith("-"));
	if (unknownFlag !== undefined) {
		err(`unknown option ${unknownFlag}`);
		err(LANGUAGE_USAGE);
		return 2;
	}
	if (args.length > 1) {
		err(LANGUAGE_USAGE);
		return 2;
	}
	const topic = args[0];
	if (topic === undefined) {
		const contents = TOPICS.map((t) => ({ name: t.name, summary: fileSummary(dir, t.name) ?? t.summary }));
		if (json) out(JSON.stringify(contents, null, 2));
		else for (const t of contents) out(`- \`${t.name}\` — ${t.summary}`);
		return 0;
	}
	if (!TOPICS.some((t) => t.name === topic)) {
		err(`unknown topic "${topic}"; topics: ${TOPICS.map((t) => t.name).join(", ")}`);
		return 2;
	}
	if (topic === "subset") {
		if (json) out(JSON.stringify(SUPPORTED_CONSTRUCTS, null, 2));
		else for (const line of subsetTable()) out(line);
		return 0;
	}
	const markdown =
		topicFile(dir, topic) ??
		[
			`The \`${topic}\` topic has not shipped in this version yet. Until it does, here is the supported subset:`,
			"",
			...subsetTable(),
			"",
			`For the language itself, see the package README: ${README}`,
		].join("\n");
	if (json) out(JSON.stringify({ topic, markdown }, null, 2));
	else out(markdown.replace(/\n$/, ""));
	return 0;
}

/** A topic's text, or undefined when its file has not shipped. */
function topicFile(dir: string, topic: string): string | undefined {
	try {
		return readFileSync(join(dir, `${topic}.md`), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** A topic file's first line, without a heading's `#`s, or undefined when there is none. */
function fileSummary(dir: string, topic: string): string | undefined {
	const first = topicFile(dir, topic)?.split("\n", 1)[0]?.replace(/^#+\s*/, "").trim();
	return first === undefined || first === "" ? undefined : first;
}

export interface ActionInfo {
	readonly name: string;
	readonly description: string;
	readonly input: readonly string[];
	readonly output: readonly string[];
	/** Every kind but `read` may change the workspace. */
	readonly writes: boolean;
}

/**
 * The built-in actions, read from their definitions: `workspaceActions`,
 * `searchActions` and the host-granted `deleteActions`. Built over an empty memory
 * workspace only to read them; nothing executes. Sorted by name.
 */
export function listActions(): ActionInfo[] {
	const workspace = memoryWorkspace();
	return [...workspaceActions(workspace), ...searchActions(workspace), ...deleteActions(workspace)]
		.map((a) => ({
			name: a.name,
			description: a.description ?? "",
			input: Object.keys(a.inputs),
			output: Object.keys(a.outputs),
			writes: a.kind !== "read",
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const ACTIONS_USAGE = "usage: specsesh actions [--json]";

export async function runActions(argv: readonly string[], deps: LanguageDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const args = argv.filter((a) => a !== "--json");
	if (args.length > 0) {
		if (args[0]?.startsWith("-") === true) err(`unknown option ${args[0]}`);
		err(ACTIONS_USAGE);
		return 2;
	}
	const actions = listActions();
	if (argv.includes("--json")) {
		out(JSON.stringify(actions, null, 2));
		return 0;
	}
	const cell = (text: string) => text.replaceAll("|", "\\|");
	const list = (names: readonly string[]) => (names.length === 0 ? "—" : names.map((n) => `\`${n}\``).join(", "));
	out("| name | description | input | output | writes |");
	out("|---|---|---|---|---|");
	for (const a of actions) {
		out(`| \`${a.name}\` | ${cell(a.description)} | ${list(a.input)} | ${list(a.output)} | ${a.writes ? "yes" : "no"} |`);
	}
	return 0;
}

/** One reason a file would not run. `line` and `col` are 1-based, and absent when the parser reported no position. */
export interface CheckProblem {
	readonly file: string;
	readonly line?: number;
	readonly col?: number;
	readonly message: string;
	/** The unsupported construct, as the pre-execution scan names it. */
	readonly construct?: string;
}

export const CHECK_USAGE = "usage: specsesh check <file.agent>…";

/**
 * Every problem that would stop `source` from running, in the order a run meets
 * them: error diagnostics, an unreadable tree, the subset scan, undeclared
 * variables, no subagent. Like the runner, a stage that fails ends the check,
 * because the next one would walk a tree the parser recovered or the scan refused.
 * Warnings and hints are not problems: a run goes ahead with them.
 */
export function checkSource(file: string, source: string): CheckProblem[] {
	const analysis = analyze(source);
	const errors = (analysis.diagnostics as readonly { message: string; severity?: number; range?: Range }[]).filter(
		(d) => d.severity === 1,
	);
	if (errors.length > 0) return errors.map((d) => ({ file, ...position(d.range), message: d.message }));
	const parsed = analysis.parsed;
	if (documentRoot(parsed) === undefined) return [{ file, message: "the parser returned no document" }];
	const unsupported = scanDocument(parsed);
	if (unsupported.length > 0) {
		return unsupported.map((c) => ({
			file,
			...position(c.range),
			message: `${c.construct}, in ${c.where}, is unsupported by this runtime (see \`specsesh language subset\`)`,
			construct: c.construct,
		}));
	}
	const declared = new Set(readDeclarations(parsed).keys());
	const undeclared = collectUndeclaredReferences(parsed, declared);
	if (undeclared.length > 0) {
		return undeclared.map((e) => ({ file, ...position(e.range), message: `@variables.${e.variable} is not declared` }));
	}
	if (readSubagents(parsed).size === 0) return [{ file, message: "no subagent: a run would dispatch nothing" }];
	return [];
}

function position(range: Range | undefined): { line?: number; col?: number } {
	return range === undefined || isUnreportedRange(range)
		? {}
		: { line: range.start.line + 1, col: range.start.character + 1 };
}

/** `file:line:col  message`, or `file  message` when the position is unknown. */
export function formatProblem(p: CheckProblem): string {
	const at = p.line === undefined ? p.file : `${p.file}:${p.line}:${p.col}`;
	return `${at}  ${p.message}${p.construct === undefined ? "" : ` [construct: ${p.construct}]`}`;
}

export async function runCheck(argv: readonly string[], deps: LanguageDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const json = argv.includes("--json");
	const files = argv.filter((a) => a !== "--json");
	const unknownFlag = files.find((a) => a.startsWith("-"));
	if (unknownFlag !== undefined) {
		err(`unknown option ${unknownFlag}`);
		err(CHECK_USAGE);
		return 2;
	}
	if (files.length === 0) {
		err(CHECK_USAGE);
		return 2;
	}
	const problems: CheckProblem[] = [];
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf8");
		} catch (error) {
			problems.push({ file, message: `cannot read: ${(error as Error).message}` });
			continue;
		}
		problems.push(...checkSource(file, source));
	}
	if (json) out(JSON.stringify(problems, null, 2));
	else for (const p of problems) out(formatProblem(p));
	return problems.length === 0 ? 0 : 1;
}

/** The starter script `new agent` writes, beside `src/` and `dist/` alike. */
export const NEW_TEMPLATE: string = fileURLToPath(new URL("../../templates/new.agent", import.meta.url));

/** The template's stand-in for the agent's name; it is a valid string, so the raw template parses. */
const NAME_PLACEHOLDER = "{{AGENT_NAME}}";

export const NEW_USAGE = "usage: specsesh new agent <name> [--out <path>]";

export interface NewDeps {
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** Where `<name>.agent` goes without `--out`. Default `process.cwd()`. */
	readonly cwd?: string;
	/** The template file. Default `NEW_TEMPLATE`. */
	readonly template?: string;
}

/** Writes a starter script from the template, and never overwrites a file. */
export async function runNew(argv: readonly string[], deps: NewDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const positional: string[] = [];
	let outPath: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg === "--out") {
			outPath = argv[++i];
			if (outPath === undefined || outPath.startsWith("-")) {
				err(NEW_USAGE);
				return 2;
			}
		} else if (arg.startsWith("-")) {
			err(`unknown option ${arg}`);
			err(NEW_USAGE);
			return 2;
		} else {
			positional.push(arg);
		}
	}
	const [kind, name] = positional;
	if (kind !== "agent" || name === undefined || positional.length > 2) {
		err(NEW_USAGE);
		return 2;
	}
	if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
		err(`invalid agent name "${name}": start with a letter, then letters, digits, "_" or "-"`);
		err(NEW_USAGE);
		return 2;
	}
	const target = resolve(deps.cwd ?? process.cwd(), outPath ?? `${name}.agent`);
	const text = readFileSync(deps.template ?? NEW_TEMPLATE, "utf8").replaceAll(NAME_PLACEHOLDER, name);
	try {
		writeFileSync(target, text, { flag: "wx" });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") err(`${target} already exists; not overwriting`);
		else err(`cannot write ${target}: ${(error as Error).message}`);
		return 1;
	}
	out(`wrote ${target}`);
	out(`check it with: specsesh check ${target}`);
	return 0;
}

function subsetTable(): string[] {
	return [
		"| id | construct | node kinds |",
		"|---|---|---|",
		...SUPPORTED_CONSTRUCTS.map(
			(c) => `| \`${c.id}\` | ${c.summary.replaceAll("|", "\\|")} | ${c.kinds.map((k) => `\`${k}\``).join(", ")} |`,
		),
	];
}
