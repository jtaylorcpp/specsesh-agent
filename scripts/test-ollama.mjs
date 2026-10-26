#!/usr/bin/env node
/**
 * `pnpm test:ollama`: the durable run and the task loop for real, on a local Ollama
 * model. Opt-in like `pnpm test:live`, never part of `pnpm test`; it runs the built
 * bins, so `pnpm build` first.
 *
 * It skips (exit 0, a `skipped:` line) when `GET $OLLAMA_HOST/api/tags` fails or
 * lists no model. The model is OLLAMA_TEST_MODEL, or the first one listed. Then:
 *
 * - `agentscript-durable run examples/triage.agent` on that model, killed with
 *   SIGKILL mid-step, then `resume`d on the same database;
 * - `agentscript-task run` of a one-task change, with the bundled `task` script, in
 *   a fresh git repository whose config puts the judge on `ollama`.
 *
 * It prints what each run ended as. A small model may fail a structured step; that
 * is reported, not hidden. It exits 1 only when it can't run at all (no built bin, a
 * spawn failure). OLLAMA_TEST_TIMEOUT_MS bounds each run (default 20 minutes).
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT = join(ROOT, "packages/agent");
const DURABLE = join(AGENT, "dist/bin/agentscript-durable.js");
const TASK = join(AGENT, "dist/bin/agentscript-task.js");
const TRIAGE = join(AGENT, "examples/triage.agent");
const LIMIT_MS = Number(process.env.OLLAMA_TEST_TIMEOUT_MS ?? 20 * 60_000);
/** How long after the run names its task the kill lands: inside the first model call. */
const KILL_AFTER_MS = 500;

const raw = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const host = (/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");

function skip(reason) {
	console.log(`skipped: ${reason}`);
	process.exit(0);
}

function fail(reason) {
	console.error(`test:ollama: ${reason}`);
	process.exit(1);
}

for (const bin of [DURABLE, TASK]) if (!existsSync(bin)) fail(`${bin} is missing: run pnpm build first`);

let listed;
try {
	const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
	if (!response.ok) skip(`Ollama at ${host} answered ${response.status}`);
	listed = ((await response.json()).models ?? []).map((m) => m.name);
} catch (error) {
	skip(`no Ollama at ${host} (${error instanceof Error ? error.message : String(error)})`);
}
if (listed.length === 0) skip(`Ollama at ${host} lists no model (ollama pull one)`);
const wanted = process.env.OLLAMA_TEST_MODEL;
if (wanted !== undefined && wanted !== "" && !listed.includes(wanted)) skip(`OLLAMA_TEST_MODEL ${wanted} is not pulled at ${host}`);
const model = wanted || listed[0];
console.log(`test:ollama: ${model} at ${host}`);

// No AGENTSCRIPT_* overrides: the flags and the config decide.
const env = { ...process.env, OLLAMA_HOST: host };
delete env.AGENTSCRIPT_PROVIDER;
delete env.AGENTSCRIPT_MODEL;

/**
 * Runs a bin to its end, or SIGKILLs it at LIMIT_MS. `onErr(text, child)` sees stderr
 * as it arrives. Resolves `{ code, signal, stdout, stderr, timedOut }`.
 */
function run(args, { cwd = ROOT, onErr } = {}) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			fail(`could not start ${args[0]}: ${error instanceof Error ? error.message : String(error)}`);
		}
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, LIMIT_MS);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			onErr?.(stderr, child);
		});
		child.on("error", (error) => fail(`could not start ${args[0]}: ${error.message}`));
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr, timedOut });
		});
	});
}

/** The `# <kind> <id> — <outcome>` line's outcome, or why there is none. */
function outcome(r, kind) {
	if (r.timedOut) return `timed out after ${LIMIT_MS} ms`;
	const line = r.stdout.match(new RegExp(`^# ${kind} \\S+ — (.+)$`, "m"));
	if (line !== null) return line[1];
	const last = r.stderr.trim().split("\n").at(-1);
	return last === undefined || last === "" ? "no outcome" : last;
}

const tmp = mkdtempSync(join(tmpdir(), "agentscript-ollama-"));
try {
	// The durable run, killed mid-step once it has named its task, then resumed.
	const db = join(tmp, "runs.sqlite");
	let id;
	let killed = false;
	const first = await run([DURABLE, "run", TRIAGE, "--db", db, "--provider", "ollama", "--model", model], {
		onErr: (text, child) => {
			const named = text.match(/^task (\d+) — resume with/m);
			if (named === null || id !== undefined) return;
			id = named[1];
			setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					killed = true;
					child.kill("SIGKILL");
				}
			}, KILL_AFTER_MS);
		},
	});
	if (id === undefined) {
		console.log(`durable: refused before a task existed: ${outcome(first, "task")} (exit ${first.code})`);
	} else if (!killed) {
		console.log(`durable: ended before the kill, so no resume: ${outcome(first, "task")} (exit ${first.code})`);
	} else {
		console.log(`durable: task ${id} killed mid-step (${first.signal})`);
		const resumed = await run([DURABLE, "resume", id, "--db", db]);
		console.log(`durable: ${outcome(resumed, "task")} (exit ${resumed.code})`);
	}

	// A one-task loop on the bundled `task` script, the judge on ollama.
	const repo = join(tmp, "repo");
	const change = join(repo, "openspec/changes/local-value");
	mkdirSync(join(change, "specs/value/file"), { recursive: true });
	writeFileSync(join(change, "proposal.md"), "## Why\n\nThe value file must say 2.\n\n## What Changes\n\n- Write `value.txt`.\n");
	writeFileSync(
		join(change, "specs/value/file/spec.md"),
		"## ADDED Requirements\n\n### Requirement: The value is two\n`value.txt` SHALL hold the single line `2`.\n\n#### Scenario: The value is two\n- **WHEN** `value.txt` is read\n- **THEN** it SHALL hold `2`\n",
	);
	writeFileSync(join(change, "tasks.md"), "## 1. Value\n\n- [ ] 1.1 Create `value.txt` at the repository root holding exactly the line `2`.\n");
	const check = `node -e "process.exit(require('fs').readFileSync('value.txt','utf8').trim()==='2'?0:1)"`;
	writeFileSync(
		join(repo, "agentscript.config.json"),
		`${JSON.stringify({ task: { provider: "ollama", model, script: "task", checks: [check], allow: ["node"] } }, null, 2)}\n`,
	);
	const git = (...args) => execFileSync("git", ["-c", "user.email=ollama@example.com", "-c", "user.name=ollama", ...args], { cwd: repo, stdio: "pipe" });
	try {
		git("init", "-q", "-b", "main");
		git("add", "-A");
		git("commit", "-q", "-m", "ollama fixture");
	} catch (error) {
		fail(`could not make the fixture repository: ${error instanceof Error ? error.message : String(error)}`);
	}
	const loop = await run([TASK, "run", "local-value", "1.1", "--db", join(tmp, "loops.sqlite")], { cwd: repo });
	console.log(`task: ${outcome(loop, "loop")} (exit ${loop.code})`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
