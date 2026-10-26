/**
 * specsesh — one command over the four agentscript bins.
 *
 *   specsesh change …   agentscript-change
 *   specsesh task …     agentscript-task, with `run` implied as in `pnpm task`
 *   specsesh durable …  agentscript-durable
 *   specsesh agent …    agentscript-pi, except the subcommands `explain.ts` handles
 *   specsesh llm …      the guide for LLM agents, a starter skill and the provider and
 *                       deployment pages, from `llm.ts`
 *
 * Importing this module runs nothing and installs no signal handlers: the
 * `specsesh` bin does that before calling `main`.
 */

import { readFileSync } from "node:fs";
import { USAGE as CHANGE_USAGE, main as changeMain, type ChangeCliDeps } from "../bin/agentscript-change.js";
import { USAGE as DURABLE_USAGE, main as durableMain, type CliDeps as DurableCliDeps } from "../bin/agentscript-durable.js";
import { main as piMain } from "../bin/agentscript-pi.js";
import { USAGE as TASK_USAGE, main as taskMain, type CliDeps as TaskCliDeps } from "../bin/agentscript-task.js";
import { runActions, runCheck, runLanguage, runList, runNew, runShow } from "./explain.js";
import { HELP_COMMANDS, runCommandHelp, runLlm } from "./llm.js";

export const USAGE = `usage:
  specsesh change <draft|approve|build|close> <change> [options]
  specsesh task <change> <task-id>|<group>|--next|--next-group [options]
  specsesh task <run|spec|resume|answer|status> [options]
  specsesh durable <run|resume> [options]
  specsesh agent <run|models|list|show|new|check|language|actions> [options]
  specsesh llm [skill [--out <path>] | providers [<name>] | deploy <local|cloudflare>]
  specsesh --version
  specsesh --help
Run a command with no arguments for its own usage.`;

export const AGENT_USAGE = `usage:
  specsesh agent run <file> [options]
  specsesh agent models [provider]
  specsesh agent list [--json]
  specsesh agent show <name> [--json]
  specsesh agent new <name> [--out <path>]
  specsesh agent check <file.agent>… [--json]
  specsesh agent language [topic] [--json]
  specsesh agent actions [--json]`;

/**
 * What the durable, task and change bins take, plus `write` for `agent show`. `agentscript-pi`
 * writes through `console` and ignores it.
 */
export type CliDeps = Partial<DurableCliDeps & TaskCliDeps & ChangeCliDeps> & {
	readonly write?: (chunk: Uint8Array) => void;
};

type Route = (args: string[], deps: CliDeps) => Promise<number> | number;

/** The `agent` subcommands handled here rather than by `agentscript-pi`. */
const EXPLAIN_ROUTES: Readonly<Record<string, Route>> = {
	list: (args, { out, err, write }) => runList(args, { out, err, write }),
	show: (args, { out, err, write }) => runShow(args, { out, err, write }),
	new: (args, { out, err, cwd }) => runNew(args, { out, err, cwd }),
	check: (args, { out, err }) => runCheck(args, { out, err }),
	language: (args, { out, err }) => runLanguage(args, { out, err }),
	actions: (args, { out, err }) => runActions(args, { out, err }),
};

function agent(args: string[], deps: CliDeps): Promise<number> | number {
	const [sub, ...rest] = args;
	if (sub === undefined) {
		(deps.err ?? ((line) => process.stderr.write(`${line}\n`)))(AGENT_USAGE);
		return 2;
	}
	if (sub === "--help" || sub === "-h" || sub === "help") {
		(deps.out ?? ((line) => process.stdout.write(`${line}\n`)))(AGENT_USAGE);
		return 0;
	}
	const route = Object.hasOwn(EXPLAIN_ROUTES, sub) ? EXPLAIN_ROUTES[sub] : undefined;
	return route === undefined ? piMain(args) : route(rest, deps);
}

const TASK_COMMANDS = new Set(["run", "spec", "resume", "answer", "status"]);

/** The implied-`run` rule of `specsesh task`: a first argument that is not a command or a flag is taken as `run <change> …`. */
const implyRun = (args: string[]): string[] =>
	args[0] !== undefined && !TASK_COMMANDS.has(args[0]) && !args[0].startsWith("-") ? ["run", ...args] : args;

const HELP_WORDS = new Set(["help", "--help", "-h"]);

/** Each command's full usage, as `specsesh <command> help` prints it. */
const COMMAND_USAGE: Readonly<Record<(typeof HELP_COMMANDS)[number], string>> = {
	change: CHANGE_USAGE,
	task: TASK_USAGE,
	durable: DURABLE_USAGE.replaceAll("agentscript-durable", "specsesh durable"),
	agent: AGENT_USAGE,
};

const ROUTES: Readonly<Record<string, Route>> = {
	agent,
	durable: (args, deps) => durableMain(args, deps),
	task: (args, deps) => taskMain(implyRun(args), deps),
	change: (args, deps) => changeMain(args, deps),
	llm: (args, { out, err, cwd }) => runLlm(args, { out, err, cwd, usage: USAGE }),
};

export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const cmd = argv[0];
	if (cmd === undefined) {
		err(USAGE);
		return 2;
	}
	if (cmd === "--help" || cmd === "-h" || cmd === "help") {
		out(USAGE);
		return 0;
	}
	if (cmd === "--version" || cmd === "-v") {
		const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
		out(`specsesh ${manifest.version}`);
		return 0;
	}
	// `<command> help` before routing, so `task help` is never taken as a change named `help`.
	const helped = HELP_COMMANDS.find((name) => name === cmd);
	if (helped !== undefined && argv.length === 2 && HELP_WORDS.has(argv[1] as string)) {
		return runCommandHelp(helped, COMMAND_USAGE[helped], deps);
	}
	const route = Object.hasOwn(ROUTES, cmd) ? ROUTES[cmd] : undefined;
	if (route === undefined) {
		err(USAGE);
		return 2;
	}
	return await route(argv.slice(1), deps);
}
