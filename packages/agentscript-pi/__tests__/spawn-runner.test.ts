import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { spawnRunner } from "../src/claude-code.js";

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

	it("The child runs in the temp directory", async () => {
		const result = await node("process.stdout.write(process.cwd())");
		expect(result.code).toBe(0);
		expect(realpathSync(result.stdout)).toBe(realpathSync(tmpdir()));
		expect(realpathSync(result.stdout)).not.toBe(realpathSync(process.cwd()));
	});

	it("Stdout, stderr and the exit code are resolved", async () => {
		const result = await node("process.stdout.write('out'); process.stderr.write('err'); process.exit(3)");
		expect(result).toEqual({ code: 3, stdout: "out", stderr: "err" });
	});
});
