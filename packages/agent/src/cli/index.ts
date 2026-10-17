/**
 * specsesh — one command over the four agentscript bins.
 *
 *   specsesh change …   agentscript-change
 *   specsesh task …     agentscript-task, with `run` implied as in `pnpm task`
 *   specsesh durable …  agentscript-durable
 *   specsesh agent …    agentscript-pi
 *
 * Importing this module runs nothing and installs no signal handlers: the
 * `specsesh` bin does that before calling `main`.
 */

import { readFileSync } from "node:fs";
import { main as changeMain, type ChangeCliDeps } from "../bin/agentscript-change.js";
import { main as durableMain, type CliDeps as DurableCliDeps } from "../bin/agentscript-durable.js";
import { main as piMain } from "../bin/agentscript-pi.js";
import { main as taskMain, type CliDeps as TaskCliDeps } from "../bin/agentscript-task.js";

export const USAGE = `usage:
  specsesh change <draft|approve|build|close> <change> [options]
  specsesh task <change> <task-id>|<group>|--next|--next-group [options]
  specsesh task <run|spec|resume|answer|status> [options]
  specsesh durable <run|resume> [options]
  specsesh agent <run|models> [options]
  specsesh --version
  specsesh --help
Run a command with no arguments for its own usage.`;

/** What the durable, task and change bins take; `agent` writes through `console` and ignores it. */
export type CliDeps = Partial<DurableCliDeps & TaskCliDeps & ChangeCliDeps>;

type Route = (args: string[], deps: CliDeps) => Promise<number> | number;

const TASK_COMMANDS = new Set(["run", "spec", "resume", "answer", "status"]);

/** The rule of `scripts/task.mjs`: a first argument that is not a command or a flag gets `run`. */
const implyRun = (args: string[]): string[] =>
	args[0] !== undefined && !TASK_COMMANDS.has(args[0]) && !args[0].startsWith("-") ? ["run", ...args] : args;

const ROUTES: Readonly<Record<string, Route>> = {
	agent: (args) => piMain(args),
	durable: (args, deps) => durableMain(args, deps),
	task: (args, deps) => taskMain(implyRun(args), deps),
	change: (args, deps) => changeMain(args, deps),
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
	const route = Object.hasOwn(ROUTES, cmd) ? ROUTES[cmd] : undefined;
	if (route === undefined) {
		err(USAGE);
		return 2;
	}
	return await route(argv.slice(1), deps);
}
