// The `actions/delegation` call scenarios: what a delegate call answers and what it records.
// The claude-code runner throughout; in-memory workspaces where no process is needed, and a local
// workspace (a temp git repository for the diffs) over a fake `claude` where one is. No real `claude`.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type { ActionResult } from "../../src/interpreter/index.js";
import {
	createAgentHarness,
	delegationActions,
	startScript,
	waitForScript,
	type ExecResult,
	type HostAction,
	type ProcessRunner,
	type Workspace,
	type WorkspaceSnapshot,
} from "../../src/durable/index.js";
import { claudeCodeRunner, localWorkspace } from "../../src/node/index.js";
import { delegateTwice } from "./delegation-scripts.js";
import { context } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

const RESULT_JSON = JSON.stringify({ type: "result", result: "done", is_error: false });

/** Writes an executable fake `claude` into `dir` that runs `body`, and returns its path. */
function scriptedClaude(dir: string, body: string): string {
	const binary = join(dir, "claude");
	writeFileSync(binary, `#!${process.execPath}\nconst fs = require("node:fs");\n${body}\n`);
	chmodSync(binary, 0o755);
	return binary;
}

/** Files in a Map; `exec` (unless `exec: false`) counts its calls and answers `answer`; `snapshot` answers `snapshot()`. */
function memoryWorkspace(options: { exec?: false; answer?: ExecResult; snapshot?: () => WorkspaceSnapshot | undefined } = {}) {
	const files = new Map<string, string>();
	const calls = { exec: 0, snapshot: 0 };
	const answer: ExecResult = options.answer ?? { kind: "exited", code: 0, stdout: RESULT_JSON, stderr: "" };
	const workspace: Workspace = {
		root: "memory",
		async read(path) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no such file: ${path}`);
			return content;
		},
		async write(path, content) {
			files.set(path, content);
		},
		async snapshot() {
			calls.snapshot += 1;
			return options.snapshot !== undefined ? options.snapshot() : new Map();
		},
		...(options.exec === false
			? {}
			: {
					async exec(): Promise<ExecResult> {
						calls.exec += 1;
						return answer;
					},
				}),
	};
	return { workspace, calls };
}

/** The claude-code runner on `binary`, counting `prepare` calls. */
function countingRunner(binary = "claude") {
	const runner = claudeCodeRunner({ binary });
	const calls = { prepare: 0 };
	const counted: ProcessRunner = {
		...runner,
		prepare(call) {
			calls.prepare += 1;
			return runner.prepare(call);
		},
	};
	return { runner: counted, calls };
}

function delegate(workspace: Workspace, runner: ProcessRunner, grant: Record<string, unknown> = {}): HostAction {
	const [action] = delegationActions({ claude_code: { runner: "claude-code", ...grant } }, { workspace, runners: { "claude-code": runner } });
	if (action === undefined) throw new Error("no delegate was built");
	return action;
}

function call(action: HostAction, instructions: string): Promise<ActionResult> {
	return action.execute({ instructions }, { workspace: "test" });
}

type Recorded = { record: { action: unknown; evidence: { kind: string; files?: unknown }[] } };

/** A git repository with `src/a.ts` committed. */
function gitRepo(): string {
	const dir = temp("agentscript-repo-");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "test");
	git("config", "commit.gpgsign", "false");
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	return dir;
}

function gone(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

describe("actions/delegation records", () => {
	it("Scenario: A workspace that cannot run processes", async () => {
		const { workspace, calls } = memoryWorkspace({ exec: false });
		const { runner, calls: prepared } = countingRunner();
		const result = await call(delegate(workspace, runner), "x");

		expect(result).toEqual({ ok: false, message: "this workspace cannot run processes" });
		expect(prepared.prepare).toBe(0);
		expect(calls.snapshot).toBe(0);
	});

	it("Scenario: The call past the limit fails", async () => {
		const faux = fauxProvider();
		const model = faux.getModel();
		const mem = memoryWorkspace();
		const { harness, models } = await createAgentHarness(
			{
				models: { default: () => ({ provider: faux.provider, model: { provider: model.provider, modelId: model.id } }) },
				workspace: () => mem.workspace,
				delegates: { claude_code: { runner: "claude-code", maxCalls: 1 } },
				runners: { "claude-code": claudeCodeRunner() },
			},
			{ storage: new MemoryStorage(), env: {}, context },
		);
		const id = await startScript(harness, delegateTwice(), { model: models.default }, context);
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ first_ok: true, second_ok: false });
		expect(result.variables["second_summary"]).toContain("reached its limit of 1 calls");
		expect(mem.calls.exec).toBe(1);
	});

	it("Scenario: A delegate that never finishes is killed", async () => {
		const bin = temp("agentscript-bin-");
		const pidFile = join(bin, "pid");
		const binary = scriptedClaude(bin, `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);`);
		const result = await call(delegate(localWorkspace(temp("agentscript-ws-")), claudeCodeRunner({ binary }), { timeoutMs: 200 }), "x");

		expect(result).toMatchObject({ ok: false });
		expect((result as { message: string }).message).toContain("timed out after 200ms");
		expect(existsSync(pidFile)).toBe(true);
		const pid = Number(readFileSync(pidFile, "utf8"));
		await expect.poll(() => gone(pid), { timeout: 2_000 }).toBe(true);
	});

	it("Scenario: A change is recorded with its diff", async () => {
		const repo = gitRepo();
		const binary = scriptedClaude(
			temp("agentscript-bin-"),
			[
				`fs.writeFileSync("src/new.ts", "export const b = 2;\\n");`,
				`fs.appendFileSync("src/a.ts", "export const c = 3;\\n");`,
				`process.stdout.write(${JSON.stringify(RESULT_JSON)});`,
			].join("\n"),
		);
		const result = await call(delegate(localWorkspace(repo), claudeCodeRunner({ binary })), "Add new.ts\nand touch a.ts");

		expect(result).toMatchObject({ ok: true, outputs: { ok: true, summary: "done", files_changed: 2 } });
		const { record } = result as unknown as Recorded;
		expect(record.action).toEqual({ kind: "delegate", summary: "Add new.ts", refs: ["delegate/claude_code"] });
		expect(record.evidence.filter((e) => e.kind === "diff")).toEqual([
			{
				kind: "diff",
				files: [
					{ path: "src/a.ts", change: "modified" },
					{ path: "src/new.ts", change: "added" },
				],
			},
		]);
		expect(record.evidence.filter((e) => e.kind === "check")).toMatchObject([{ kind: "check", exitCode: 0 }]);
	});

	it("Scenario: A delegate that changed nothing says so", async () => {
		const repo = gitRepo();
		const binary = scriptedClaude(temp("agentscript-bin-"), `process.stdout.write(${JSON.stringify(RESULT_JSON)});`);
		const result = await call(delegate(localWorkspace(repo), claudeCodeRunner({ binary })), "Look, don't touch");

		expect(result).toMatchObject({ ok: true, outputs: { files_changed: 0 } });
		const { record } = result as unknown as Recorded;
		expect(record.evidence.filter((e) => e.kind === "diff")).toEqual([{ kind: "diff", files: [] }]);
	});

	it("Scenario: Without snapshots the count is unknown", async () => {
		const { workspace, calls } = memoryWorkspace({ snapshot: () => undefined });
		const result = await call(delegate(workspace, claudeCodeRunner()), "Do it");

		expect(calls.exec).toBe(1);
		expect(result).toMatchObject({ ok: true, outputs: { ok: true, files_changed: -1 } });
		const { record } = result as unknown as Recorded;
		expect(record.action).toEqual({ kind: "delegate", summary: "Do it", refs: ["delegate/claude_code"] });
		expect(record.evidence.map((e) => e.kind)).toEqual(["check"]);
	});
});
