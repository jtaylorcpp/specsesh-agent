import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { spawnRunner } from "../../src/claude-code/claude-code.js";

const node = (script: string, timeoutMs = 2000) =>
	spawnRunner(process.execPath, timeoutMs)(["-e", script], "", process.env);

describe("spawnRunner runs the binary outside any project, with a timeout", () => {
	it("Scenario: A missing binary resolves with a spawn error", async () => {
		const result = await spawnRunner("agentscript-no-such-binary-xyz", 2000)([], "", process.env);
		expect(result.code).toBeNull();
		expect(result.spawnError).toBeInstanceOf(Error);
		expect(result.spawnError?.message).toMatch(/ENOENT/);
	});

	it("Scenario: A process past its timeout is terminated", async () => {
		const started = Date.now();
		const result = await spawnRunner(process.execPath, 100)(["-e", "setTimeout(() => {}, 30000)"], "", process.env);
		expect(result.code).toBeNull();
		expect(result.spawnError).toBeUndefined();
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it("without a timeout, only the signal stops it, and a finished process isn't marked timed out", async () => {
		const finished = await spawnRunner(process.execPath, undefined)(["-e", "setTimeout(() => process.stdout.write('done'), 300)"], "", process.env);
		expect(finished).toMatchObject({ code: 0, stdout: "done" });
		expect(finished.timedOut).toBeUndefined();

		const controller = new AbortController();
		const running = spawnRunner(process.execPath, undefined, controller.signal)(["-e", "setTimeout(() => {}, 30000)"], "", process.env);
		setTimeout(() => controller.abort(), 100);
		const stopped = await running;
		expect(stopped.code).toBeNull();
		expect(stopped.timedOut).toBeUndefined();
	});

	it("Input reaches the child's stdin", async () => {
		const result = await spawnRunner(process.execPath, 2000)(
			["-e", "process.stdin.pipe(process.stdout)"],
			"hello from stdin",
			process.env,
		);
		expect(result).toMatchObject({ code: 0, stdout: "hello from stdin" });
	});

	it("Scenario: Each call runs in a fresh empty directory, removed after", async () => {
		const script = "process.stdout.write(JSON.stringify({ cwd: process.cwd(), entries: require('fs').readdirSync('.') }))";
		const runner = spawnRunner(process.execPath, 2000);
		const runs: { cwd: string; entries: string[] }[] = [];
		for (let i = 0; i < 2; i++) {
			const result = await runner(["-e", script], "", process.env);
			expect(result.code).toBe(0);
			const seen = JSON.parse(result.stdout) as { cwd: string; entries: string[] };
			expect(existsSync(seen.cwd)).toBe(false);
			runs.push(seen);
		}
		const tmp = realpathSync(tmpdir());
		for (const { cwd, entries } of runs) {
			expect(dirname(cwd)).toBe(tmp);
			expect(cwd).not.toBe(tmp);
			expect(entries).toEqual([]);
		}
		expect(runs[0]!.cwd).not.toBe(runs[1]!.cwd);
	});

	it("Scenario: A given cwd is used and left in place", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "agentscript-given-cwd-"));
		writeFileSync(join(cwd, "keep.txt"), "kept");
		const result = await spawnRunner(process.execPath, 2000, undefined, cwd)(
			["-e", "process.stdout.write(process.cwd())"],
			"",
			process.env,
		);
		expect(result.code).toBe(0);
		expect(realpathSync(result.stdout)).toBe(realpathSync(cwd));
		expect(existsSync(join(cwd, "keep.txt"))).toBe(true);
	});

	it("Stdout, stderr and the exit code are resolved", async () => {
		const result = await node("process.stdout.write('out'); process.stderr.write('err'); process.exit(3)");
		expect(result).toEqual({ code: 3, stdout: "out", stderr: "err" });
	});
});

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

async function gone(pid: number, withinMs: number): Promise<boolean> {
	const deadline = Date.now() + withinMs;
	while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	return !alive(pid);
}

async function pidIn(file: string, withinMs = 5000): Promise<number> {
	const deadline = Date.now() + withinMs;
	while (Date.now() < deadline) {
		const text = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
		if (text !== "") return Number(text);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`no pid in ${file}`);
}

/** A `claude` that records its pid, starts a background `sleep` and records that pid, then waits. */
function spawningClaude() {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-lifeline-"));
	const binary = join(dir, "claude");
	const files = { self: join(dir, "self.pid"), started: join(dir, "started.pid") };
	writeFileSync(binary, `#!/bin/sh\nsleep 30 &\necho $! > '${files.started}'\necho $$ > '${files.self}'\nwait\n`);
	chmodSync(binary, 0o755);
	return { dir, binary, files };
}

describe.skipIf(process.platform === "win32")("spawnRunner: claude can't outlive its step or its host (#51)", () => {
	it("stopping a step ends claude and whatever it started", async () => {
		const fake = spawningClaude();
		const result = await spawnRunner(fake.binary, 300)([], "", process.env);
		expect(result.timedOut).toBe(true);
		expect(await gone(await pidIn(fake.files.self), 2000)).toBe(true);
		expect(await gone(await pidIn(fake.files.started), 2000)).toBe(true);
		rmSync(fake.dir, { recursive: true, force: true });
	});

	it("an abort ends them too", async () => {
		const fake = spawningClaude();
		const controller = new AbortController();
		const running = spawnRunner(fake.binary, undefined, controller.signal)([], "", process.env);
		const started = await pidIn(fake.files.started);
		controller.abort();
		await running;
		expect(await gone(started, 2000)).toBe(true);
		rmSync(fake.dir, { recursive: true, force: true });
	});

	it("a host killed outright takes claude and what it started with it", async () => {
		const fake = spawningClaude();
		const dist = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "dist", "claude-code", "claude-code.js");
		// The host waits on a step with no clock of its own, as a held session's does.
		const host = spawn(
			process.execPath,
			["-e", `import(${JSON.stringify(pathToFileURL(dist).href)}).then((m) => m.spawnRunner(${JSON.stringify(fake.binary)}, undefined)([], "", process.env))`],
			{ stdio: "ignore" },
		);
		const self = await pidIn(fake.files.self);
		const started = await pidIn(fake.files.started);
		host.kill("SIGKILL");
		expect(await gone(self, 3000)).toBe(true);
		expect(await gone(started, 3000)).toBe(true);
		rmSync(fake.dir, { recursive: true, force: true });
	});

	it("passes claude's exit code on", async () => {
		const result = await spawnRunner(process.execPath, 2000)(["-e", "process.stdout.write('bye'); process.exit(3)"], "", process.env);
		expect(result).toMatchObject({ code: 3, stdout: "bye" });
		expect(result.spawnError).toBeUndefined();
	});
});
