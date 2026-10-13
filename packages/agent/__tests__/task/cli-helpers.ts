/**
 * Driving `agentscript-task`: in process against a faux model (`cli`), or as
 * the built bin against a fake `claude` (`spawnBin`); temp git repositories;
 * reading a database's loops; parsing the JSON Lines stream.
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { buildHarness, main } from "../../src/bin/agentscript-task.js";
import type { DelegateGrants } from "../../src/durable/delegation.js";
import { GROUP_LOOP_NAME, type GroupLoopInput } from "../../src/task/group.js";
import { TASK_LOOP, type TaskLoopInput } from "../../src/task/index.js";
import { JUDGE_ONLY, PROPOSAL, DELTA, TASKS, context, temp } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The built bin, as `pnpm task` runs it. vitest's global setup builds dist/ first. */
export const BIN = join(HERE, "..", "..", "dist", "bin", "agentscript-task.js");

/** A faux model collection, under the faux provider's ids or the ones given. */
export function fauxModels(provider?: string, modelId?: string) {
	const faux = fauxProvider(provider !== undefined ? { provider, models: [{ id: modelId ?? "m" }] } : undefined);
	const models = createModels();
	models.setProvider(faux.provider);
	const model = faux.getModel();
	return { faux, models, args: ["--provider", model.provider, "--model", model.id] };
}

/** A temp directory with JUDGE_ONLY as a script file and a database path in it. */
export function workdir() {
	const dir = temp("task-cli-");
	const script = join(dir, "judge.agent");
	writeFileSync(script, JUDGE_ONLY);
	return { dir, script, db: join(dir, "loops.sqlite") };
}

export interface CliRun {
	readonly code: number;
	readonly out: string;
	readonly err: string;
	readonly errLines: string[];
	readonly env: ReturnType<typeof fauxModels>;
}

/**
 * main() in process. `cwd` defaults to a fresh temp directory outside any repo
 * and config, `env` to one without AGENTSCRIPT_* unless given. `noDelegates`
 * appends `--no-delegates`.
 */
export async function cli(
	argv: string[],
	env = fauxModels(),
	options: { cwd?: string; env?: Record<string, string | undefined>; noDelegates?: boolean } = {},
): Promise<CliRun> {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(options.noDelegates === true ? [...argv, "--no-delegates"] : argv, {
		models: () => env.models,
		out: (l) => out.push(l),
		err: (l) => err.push(l),
		cwd: options.cwd ?? temp("task-cwd-"),
		env: options.env ?? {},
		pollMs: 10,
	});
	return { code, out: out.join("\n"), err: err.join("\n"), errLines: err, env };
}

/**
 * The action names of the harness `run` builds over `workspace` and `delegates`,
 * through the CLI's own `buildHarness`, on a faux model and memory storage.
 */
export async function cliActions(workspace: string, delegates: DelegateGrants = {}): Promise<string[]> {
	const { faux } = fauxModels();
	const model = faux.getModel();
	const built = await buildHarness(
		new MemoryStorage(),
		{ provider: faux.provider, model: { provider: model.provider, modelId: model.id } },
		{ workspace, checks: [], allow: [], delegates },
	);
	await built.harness.close(context);
	return [...built.actions.keys()];
}

/** The stored loop inputs in a database. */
export async function storedLoops(db: string) {
	const storage = await openNodeSqliteStorage(db);
	const page = await storage.scanTasks({ kind: TASK_LOOP }, 10, undefined, context);
	const runs = await storage.scanTasks({ kind: "agentscript.run" }, 10, undefined, context);
	await storage.close(context);
	return { loops: page.items, inputs: page.items.map((t) => t.input as unknown as TaskLoopInput), runs: runs.items };
}

/** The stored group loops and task loops in a database, with their inputs. */
export async function storedGroupLoops(db: string) {
	const storage = await openNodeSqliteStorage(db);
	const groups = await storage.scanTasks({ kind: GROUP_LOOP_NAME }, 10, undefined, context);
	const tasks = await storage.scanTasks({ kind: TASK_LOOP }, 10, undefined, context);
	await storage.close(context);
	return {
		groups: groups.items.map((t) => t.input as unknown as GroupLoopInput),
		tasks: tasks.items.map((t) => t.input as unknown as TaskLoopInput),
	};
}

/** The JSON events after the resume hint. Throws on a line that is not JSON. */
export function events(errLines: readonly string[]): Record<string, unknown>[] {
	return errLines.slice(1).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Run git in a test repository. Tests may run any git command; only the runner is restricted. */
export function gitIn(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Write files under `root`, creating directories. */
export function write(root: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
}

/**
 * A git repository with one commit: `.gitignore` ignoring `.agentscript/`, the
 * change `tiny` under `openspec/changes/`, `src/a.ts`, and `extra` files.
 */
export function gitRepo(extra: Record<string, string> = {}, options: { name?: string } = {}): string {
	const repo = join(temp("task-repo-"), options.name ?? "repo");
	mkdirSync(repo, { recursive: true });
	write(repo, {
		".gitignore": ".agentscript/\n",
		"openspec/changes/tiny/proposal.md": PROPOSAL,
		"openspec/changes/tiny/specs/value/file/spec.md": DELTA,
		"openspec/changes/tiny/tasks.md": TASKS,
		"src/a.ts": "export const a = 1;\n",
		...extra,
	});
	gitIn(repo, "init", "-q", "-b", "main");
	gitIn(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
	gitIn(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
	return repo;
}

/** Commit everything in a test repository. */
export function commitAll(repo: string, messageText = "more"): void {
	gitIn(repo, "add", "-A");
	gitIn(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", messageText);
}

/**
 * A fake `claude` in a fresh bin directory, run by this Node. As a step (it is
 * given `--json-schema`) it answers that schema:
 * `plan`, or a verdict —
 * the next of `verdicts` (`met`, `retry` or `ask`), then `met` once they run
 * out. As the delegate (`--permission-mode`) it appends `// edited` to
 * `src/a.ts` in its cwd. It appends its argv and cwd to `$FAKE_CLAUDE_LOG`, and
 * sleeps `$FAKE_CLAUDE_SLEEP_MS` first. With `pnpmExit`, a fake `pnpm` beside it
 * exits with that code.
 */
export function fakeClaude(options: { verdicts?: readonly ("met" | "retry" | "ask")[]; pnpmExit?: number } = {}): string {
	const bin = temp("task-fake-bin-");
	const path = join(bin, "claude");
	writeFileSync(join(bin, "verdicts.json"), JSON.stringify(options.verdicts ?? []));
	if (options.pnpmExit !== undefined) {
		writeFileSync(join(bin, "pnpm"), `#!${process.execPath}\nprocess.stdout.write("fake pnpm " + process.argv.slice(2).join(" "));\nprocess.exit(${options.pnpmExit});\n`, { mode: 0o755 });
	}
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
try { fs.readFileSync(0, "utf8"); } catch {}
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");
setTimeout(() => {
	const schemaAt = argv.indexOf("--json-schema");
	let out;
	if (schemaAt >= 0) {
		// A durable step's result tool carries the step's schema.
		const schema = JSON.parse(argv[schemaAt + 1]);
		let structured;
		if (!("next_action" in (schema.properties || {}))) structured = { plan: "edit src/a.ts" };
		else {
			const file = path.join(__dirname, "verdicts.json");
			const queue = JSON.parse(fs.readFileSync(file, "utf8"));
			const next = queue.shift() || "met";
			fs.writeFileSync(file, JSON.stringify(queue));
			structured =
				next === "met" ? { met: true, unmet: "", next_action: "retry", question: "", amend_path: "", amend_text: "" }
				: next === "ask" ? { met: false, unmet: "two ways", next_action: "ask", question: "Which way?", amend_path: "", amend_text: "" }
				: { met: false, unmet: "not yet", next_action: "retry", question: "", amend_path: "", amend_text: "" };
		}
		out = { type: "result", is_error: false, result: "", structured_output: structured };
	} else {
		fs.appendFileSync(path.join(process.cwd(), "src", "a.ts"), "// edited\\n");
		out = { type: "result", is_error: false, result: "Edited src/a.ts." };
	}
	process.stdout.write(JSON.stringify(out));
}, Number(process.env.FAKE_CLAUDE_SLEEP_MS || 0));
`,
	);
	chmodSync(path, 0o755);
	return bin;
}

/**
 * A fake `claude` whose delegate writes the next of `files` into its cwd on each
 * delegate call (one per task, in run order) and converges; steps answer as `fakeClaude` does.
 */
export function fakeClaudeWriting(files: readonly string[]): string {
	const bin = temp("task-fake-bin-");
	const path = join(bin, "claude");
	writeFileSync(join(bin, "files.json"), JSON.stringify(files));
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
try { fs.readFileSync(0, "utf8"); } catch {}
const schemaAt = argv.indexOf("--json-schema");
let out;
if (schemaAt >= 0) {
	const schema = JSON.parse(argv[schemaAt + 1]);
	const structured = !("next_action" in (schema.properties || {}))
		? { plan: "write the file" }
		: { met: true, unmet: "", next_action: "retry", question: "", amend_path: "", amend_text: "" };
	out = { type: "result", is_error: false, result: "", structured_output: structured };
} else {
	const file = path.join(__dirname, "files.json");
	const queue = JSON.parse(fs.readFileSync(file, "utf8"));
	const next = queue.shift();
	fs.writeFileSync(file, JSON.stringify(queue));
	fs.writeFileSync(path.join(process.cwd(), next), "written\\n");
	out = { type: "result", is_error: false, result: "Wrote " + next };
}
process.stdout.write(JSON.stringify(out));
`,
	);
	chmodSync(path, 0o755);
	return bin;
}

/**
 * A config for spawned runs on the fake `claude`: the claude-code provider,
 * `task-delegate` with its `claude_code` grant, and a `node` check that always passes.
 */
export const FAKE_CLAUDE_CONFIG = JSON.stringify({
	task: {
		provider: "claude-code",
		model: "claude-haiku-4-5",
		script: "task-delegate",
		checks: ["node --version"],
		allow: ["node"],
		db: ".agentscript/task-loops.sqlite",
	},
	delegates: { claude_code: { runner: "claude-code", model: "sonnet", allow: ["node"] } },
});

export interface BinRun {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly pid: number;
}

/**
 * Spawn the built bin with stdin closed and output captured, PATH starting at
 * `bin` (the fake `claude`). Resolves when it exits. `onStderr` sees the stderr so
 * far after each chunk, with a way to SIGKILL the process.
 */
export function spawnBin(
	args: readonly string[],
	options: { cwd: string; bin: string; env?: Record<string, string>; onStderr?: (text: string, kill: () => void) => void },
): Promise<BinRun> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${options.bin}:${process.env.PATH ?? ""}`, ...options.env };
		delete env.AGENTSCRIPT_PROVIDER;
		delete env.AGENTSCRIPT_MODEL;
		const child = spawn(process.execPath, [BIN, ...args], { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			options.onStderr?.(stderr, () => child.kill("SIGKILL"));
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr, pid: child.pid ?? -1 }));
	});
}
