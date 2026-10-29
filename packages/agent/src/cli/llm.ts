/**
 * `specsesh llm`: how to use specsesh, for an LLM agent, from text that ships in the package.
 *
 *   specsesh llm                            the guide, a short map, from `docs/llm/guide.md`
 *   specsesh llm skill [--out <path>]       a starter SKILL.md, from `templates/SKILL.md`
 *   specsesh <command> help                 the command's usage and its page, `docs/llm/<command>.md`
 *   specsesh llm providers [<name>]         the provider matrix, or `docs/providers/<name>.md`
 *   specsesh llm deploy <local|cloudflare>  `docs/deploy/<target>.md`
 *
 * The guide is a map and each command's page holds its depth, so an agent loads only what it
 * needs. `{{version}}` becomes the package version everywhere, and `{{usage}}` the CLI's `USAGE`
 * in the guide, so its command list is the one `specsesh --help` prints. Exit 0 on success, 1
 * when `--out` names an existing file, 2 on usage.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The guide, beside `src/` and `dist/` alike. */
export const LLM_GUIDE: string = fileURLToPath(new URL("../../docs/llm/guide.md", import.meta.url));

/** The directory of the command pages, `<command>.md`, beside `src/` and `dist/` alike. */
export const LLM_DOCS: string = fileURLToPath(new URL("../../docs/llm/", import.meta.url));

/** The commands that answer `help` with a page. */
export const HELP_COMMANDS = ["change", "task", "durable", "agent"] as const;

/** The starter skill, beside `src/` and `dist/` alike. */
export const SKILL_TEMPLATE: string = fileURLToPath(new URL("../../templates/SKILL.md", import.meta.url));

/** A shipped page, beside `src/` and `dist/` alike. */
const page = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/** The provider matrix, printed by `specsesh llm providers`. */
export const PROVIDERS_INDEX: string = page("docs/providers/README.md");

/** The pages `specsesh llm providers <name>` prints, by fixed name: no path is built from input. */
export const PROVIDER_PAGES: ReadonlyMap<string, string> = new Map([
	["api-keys", page("docs/providers/api-keys.md")],
	["claude-code", page("docs/providers/claude-code.md")],
	["gemini", page("docs/providers/gemini.md")],
	["ollama", page("docs/providers/ollama.md")],
	["workers-ai", page("docs/providers/workers-ai.md")],
]);

/** The pages `specsesh llm deploy <target>` prints, by fixed name. */
export const DEPLOY_PAGES: ReadonlyMap<string, string> = new Map([
	["local", page("docs/deploy/local.md")],
	["cloudflare", page("docs/deploy/cloudflare.md")],
]);

export const LLM_USAGE = `usage: specsesh llm [skill [--out <path>] | providers [<name>] | deploy <local|cloudflare>]
       specsesh llm                          print the guide for LLM agents
       specsesh llm skill [--out <path>]     print a starter SKILL.md, or write it to <path>
       specsesh llm providers [<name>]       print the provider matrix, or one provider's page:
                                             api-keys, claude-code, gemini, ollama or workers-ai
       specsesh llm deploy <local|cloudflare>  print a deployment page`;

export interface LlmDeps {
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** What `--out` resolves against. Default `process.cwd()`. */
	readonly cwd?: string;
	/** The CLI's usage, put in the guide for `{{usage}}`. */
	readonly usage: string;
}

function version(): string {
	return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
}

/** A shipped text with its placeholders filled; the trailing newline goes, since `out` adds one. */
function render(file: string, usage: string): string {
	return readFileSync(file, "utf8").replaceAll("{{version}}", version()).replaceAll("{{usage}}", usage).replace(/\n+$/, "");
}

/** `argv` follows `specsesh llm`. */
export function runLlm(argv: readonly string[], deps: LlmDeps): number {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const [sub, ...rest] = argv;
	if (sub === "--help" || sub === "-h" || sub === "help") {
		out(LLM_USAGE);
		return 0;
	}
	if (sub === undefined) {
		out(render(LLM_GUIDE, deps.usage));
		return 0;
	}
	if (sub === "providers" || sub === "deploy") {
		const [name, ...extra] = rest;
		const file =
			sub === "providers" ? (name === undefined ? PROVIDERS_INDEX : PROVIDER_PAGES.get(name)) : name === undefined ? undefined : DEPLOY_PAGES.get(name);
		if (file === undefined || extra.length > 0) {
			err(LLM_USAGE);
			return 2;
		}
		// As shipped, no placeholders filled; `out` adds back the final newline.
		out(readFileSync(file, "utf8").replace(/\n$/, ""));
		return 0;
	}
	if (sub !== "skill") {
		err(LLM_USAGE);
		return 2;
	}
	let outPath: string | undefined;
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === "--out" && rest[i + 1] !== undefined && !(rest[i + 1] as string).startsWith("-")) outPath = rest[++i];
		else {
			err(LLM_USAGE);
			return 2;
		}
	}
	const skill = render(SKILL_TEMPLATE, deps.usage);
	if (outPath === undefined) {
		out(skill);
		return 0;
	}
	const target = resolve(deps.cwd ?? process.cwd(), outPath);
	try {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${skill}\n`, { flag: "wx" });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") err(`${target} already exists; not overwriting`);
		else err(`cannot write ${target}: ${(error as Error).message}`);
		return 1;
	}
	out(`wrote ${target}`);
	return 0;
}

/** Prints `usage`, a blank line and `docs/llm/<command>.md`, for `specsesh <command> help`. */
export function runCommandHelp(command: (typeof HELP_COMMANDS)[number], usage: string, deps: Omit<LlmDeps, "usage">): number {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	out(`${usage}\n\n${render(`${LLM_DOCS}${command}.md`, usage)}`);
	return 0;
}
