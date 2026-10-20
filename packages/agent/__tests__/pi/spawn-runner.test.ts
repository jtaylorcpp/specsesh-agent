import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
		expect(Date.now() - started).toBeLessThan(2000);
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
