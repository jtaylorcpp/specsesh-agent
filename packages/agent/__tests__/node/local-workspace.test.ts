import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceError } from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";

const dirs: string[] = [];

function tempDir(prefix = "agentscript-local-workspace-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

async function rejection(promise: Promise<unknown>): Promise<WorkspaceError> {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(WorkspaceError);
	return error as WorkspaceError;
}

describe("actions/workspace: exec runs an argv with no shell, a time limit and the given environment", () => {
	it("Scenario: A metacharacter is an argument", async () => {
		const ran = await localWorkspace(tempDir()).exec?.(["node", "-e", "console.log(process.argv.length)", ";", "rm"], { timeoutMs: 10_000 });
		// `node -e` sees [node, ";", "rm"]: both words reached node as arguments, so no `rm` started.
		expect(ran).toEqual({ kind: "exited", code: 0, stdout: "3\n", stderr: "" });
	});

	it("Scenario: A slow process is killed", async () => {
		const dir = tempDir();
		const ran = await localWorkspace(dir).exec?.(
			[process.execPath, "-e", "require('fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000)"],
			{ timeoutMs: 200 },
		);
		expect(ran?.kind).toBe("timed-out");
		// Written relative to the cwd, so finding it here also shows the process ran in the workspace.
		const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
		try {
			const deadline = Date.now() + 2_000;
			while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
			expect(alive(pid)).toBe(false);
		} finally {
			if (alive(pid)) process.kill(pid, "SIGKILL");
		}
	});

	it("runs in the workspace, feeding stdin and keeping stdout and stderr apart", async () => {
		const dir = tempDir();
		const ran = await localWorkspace(dir).exec?.(
			[process.execPath, "-e", "process.stdin.pipe(process.stdout); process.stderr.write(process.cwd())"],
			{ stdin: "in", timeoutMs: 10_000 },
		);
		expect(ran).toEqual({ kind: "exited", code: 0, stdout: "in", stderr: realpathSync(dir) });
	});

	it("passes env whole, and inherits the process environment without one", async () => {
		const workspace = localWorkspace(tempDir());
		const keys = [process.execPath, "-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"];
		const given = await workspace.exec?.(keys, { env: { ONLY: "1" }, timeoutMs: 10_000 });
		expect(given?.kind === "exited" && JSON.parse(given.stdout)).toEqual(["ONLY"]);
		const inherited = await workspace.exec?.([process.execPath, "-e", "process.stdout.write(process.env.PATH ?? '')"], { timeoutMs: 10_000 });
		expect(inherited?.kind === "exited" && inherited.stdout).toBe(process.env["PATH"]);
	});

	it("answers a missing binary or an empty argv with spawn-error, and an abort with timed-out", async () => {
		const workspace = localWorkspace(tempDir());
		expect((await workspace.exec?.(["agentscript-no-such-binary"], { timeoutMs: 10_000 }))?.kind).toBe("spawn-error");
		expect(await workspace.exec?.([], { timeoutMs: 10_000 })).toEqual({ kind: "spawn-error", message: "the command is empty" });
		const controller = new AbortController();
		const running = workspace.exec?.([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 60_000, signal: controller.signal });
		controller.abort();
		expect((await running)?.kind).toBe("timed-out");
	});
});

describe("actions/workspace: localWorkspace implements the workspace over a directory", () => {
	it("Scenario: A symlink out of the workspace is refused", async () => {
		const dir = tempDir();
		symlinkSync("/etc", join(dir, "link"));
		const error = await rejection(localWorkspace(dir).read("link/passwd"));
		expect(error.reason).toBe("outside the workspace");
		expect(error.message).toContain("outside the workspace");
		expect((await rejection(localWorkspace(dir).write("link/agentscript-new", "x"))).reason).toBe("outside the workspace");
		expect(existsSync("/etc/agentscript-new")).toBe(false);
	});

	it("Scenario: Outside git there is no snapshot", async () => {
		const dir = tempDir();
		let insideGit = false;
		try {
			insideGit = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim() === "true";
		} catch {
			// Not a work tree: what the scenario needs.
		}
		if (insideGit) throw new Error(`${dir} is inside a git work tree, so this scenario cannot run here (set TMPDIR outside any repository)`);
		await expect(localWorkspace(dir).snapshot?.()).resolves.toBeUndefined();
	});

	it("round-trips a write through the disk, creating parent directories", async () => {
		const dir = tempDir();
		const workspace = localWorkspace(dir);
		expect(workspace.root).toBe(dir);
		await workspace.write("src/deep/a.ts", "hello");
		expect(readFileSync(join(dir, "src/deep/a.ts"), "utf8")).toBe("hello");
		await expect(workspace.read("src/deep/a.ts")).resolves.toBe("hello");
	});

	it("refuses absolute paths and .. escapes, and names a missing file", async () => {
		const dir = tempDir();
		const workspace = localWorkspace(dir);
		for (const path of ["/etc/passwd", join(dir, "a.ts"), "../outside.ts", "src/../../outside.ts", ""]) {
			expect((await rejection(workspace.read(path))).reason, path).toBe("outside the workspace");
			expect((await rejection(workspace.write(path, "x"))).reason, path).toBe("outside the workspace");
		}
		const missing = await rejection(workspace.read("src/gone.ts"));
		expect(missing.reason).toBe("no such file");
		expect(missing.message).toBe("no such file: src/gone.ts");
	});
});
