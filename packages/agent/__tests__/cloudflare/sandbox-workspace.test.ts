import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { sandboxWorkspace, shellQuote, type SandboxLike } from "../../src/cloudflare/sandbox-workspace.js";
import { WorkspaceError, diffSnapshots } from "../../src/durable/index.js";
import { LocalSandbox } from "./fakes.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cloudflare");
const dirs: string[] = [];

function tempDir(prefix = "agentscript-sandbox-workspace-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

function identify(dir: string): void {
	git(dir, "config", "user.name", "Test");
	git(dir, "config", "user.email", "test@example.invalid");
	git(dir, "config", "commit.gpgsign", "false");
}

/** A repository with `src/a.ts` committed. */
function checkout(): string {
	const dir = tempDir();
	git(dir, "init", "-q", "-b", "main");
	identify(dir);
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "init");
	return dir;
}

/** A sandbox whose every call throws `message`, as one whose container is gone. */
function throwing(message: string): SandboxLike {
	const fail = () => Promise.reject(new Error(message));
	return { exec: fail, readFile: fail, writeFile: fail, mkdir: fail };
}

/** A bare repository on `main` holding `src/a.ts`, and a clone of it. */
function cloneOfBare(): { bare: string; dir: string } {
	const seed = checkout();
	const bare = join(tempDir(), "origin.git");
	git(seed, "clone", "-q", "--bare", seed, bare);
	const dir = join(tempDir(), "work");
	git(tmpdir(), "clone", "-q", bare, dir);
	identify(dir);
	return { bare, dir };
}

describe("cloudflare/sandbox-workspace: The cloudflare entry exports the sandbox workspace", () => {
	it("Scenario: The workspace modules load in plain Node", async () => {
		const loaded = await import("../../src/cloudflare/sandbox-workspace.js");
		expect(typeof loaded.sandboxWorkspace).toBe("function");
		const artifacts = await import("../../src/cloudflare/artifacts.js");
		expect(typeof artifacts.artifactsSandboxWorkspace).toBe("function");
		for (const file of ["sandbox-workspace.ts", "artifacts.ts"]) {
			const source = readFileSync(join(SRC, file), "utf8");
			const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
			expect(imports.length, file).toBeGreaterThan(0);
			for (const spec of imports) expect(spec, file).not.toMatch(/^agents(\/|$)|^cloudflare:workers$/);
		}
	});
});

describe("cloudflare/sandbox-workspace: SandboxLike is the slice of the Sandbox SDK the workspace uses", () => {
	it("Scenario: A local fake satisfies SandboxLike", async () => {
		const sandbox: SandboxLike = new LocalSandbox();
		const dir = tempDir();
		const workspace = sandboxWorkspace(sandbox, { dir });
		await workspace.write("note.md", "hello");
		expect(await workspace.read("note.md")).toBe("hello");
	});
});

describe("cloudflare/sandbox-workspace: Sandbox reads and writes are confined to dir", () => {
	it("Scenario: An escape never reaches the sandbox", async () => {
		const sandbox = new LocalSandbox();
		const workspace = sandboxWorkspace(sandbox, { dir: tempDir() });
		for (const path of ["../x", "/etc/passwd", "a/../../x"]) {
			const error = await workspace.write(path, "y").catch((e: unknown) => e);
			expect(error).toBeInstanceOf(WorkspaceError);
			expect((error as WorkspaceError).message).toContain("outside the workspace");
		}
		expect(sandbox.calls).toEqual([]);
	});

	it("refuses a symlink whose real location leaves dir, writing nothing", async () => {
		const outside = tempDir();
		const dir = tempDir();
		symlinkSync(outside, join(dir, "link"));
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir });
		await expect(workspace.write("link/x", "y")).rejects.toThrow("outside the workspace");
		await expect(workspace.read("link/x")).rejects.toThrow("outside the workspace");
		expect(readdirSync(outside)).toEqual([]);
	});

	it("writes into new directories, and a missing file is `no such file`", async () => {
		const dir = tempDir();
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir: `${dir}/` });
		await workspace.write("deep/er/it's.txt", "x");
		expect(readFileSync(join(dir, "deep/er/it's.txt"), "utf8")).toBe("x");
		const error = await workspace.read("nope.txt").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(WorkspaceError);
		expect((error as WorkspaceError).reason).toBe("no such file");
	});
});

describe("cloudflare/sandbox-workspace: Sandbox exec quotes every argument and enforces the time limit", () => {
	it("Scenario: A metacharacter stays an argument", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "keep.txt"), "keep");
		const ran = await sandboxWorkspace(new LocalSandbox(), { dir }).exec?.(["printf", "%s", "a; rm -rf ."], { timeoutMs: 10_000 });
		expect(ran).toEqual({ kind: "exited", code: 0, stdout: "a; rm -rf .", stderr: "" });
		expect(readdirSync(dir)).toEqual(["keep.txt"]);
	});

	it("Scenario: A slow command is killed", async () => {
		const ran = await sandboxWorkspace(new LocalSandbox(), { dir: tempDir() }).exec?.(["sleep", "5"], { timeoutMs: 1000 });
		expect(ran?.kind).toBe("timed-out");
	});

	it("feeds stdin and the environment, and a throwing sandbox is a spawn-error", async () => {
		const dir = tempDir();
		const ran = await sandboxWorkspace(new LocalSandbox(), { dir }).exec?.(["bash", "-c", 'cat; printf "$GREETING"'], {
			stdin: "in ",
			env: { GREETING: "hi" },
			timeoutMs: 10_000,
		});
		expect(ran).toEqual({ kind: "exited", code: 0, stdout: "in hi", stderr: "" });

		expect(await sandboxWorkspace(throwing("container gone"), { dir }).exec?.(["true"], { timeoutMs: 1000 })).toEqual({
			kind: "spawn-error",
			message: "container gone",
		});
	});

	it("quotes as POSIX single quotes", () => {
		expect(shellQuote("it's")).toBe(`'it'\\''s'`);
	});
});

describe("cloudflare/sandbox-workspace: Sandbox snapshots, lists and searches through git", () => {
	it("Scenario: A delegate's change is diffed in the sandbox", async () => {
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir: checkout() });
		const before = await workspace.snapshot?.();
		expect(before).toEqual(new Map());
		await workspace.write("src/a.ts", "export const a = 2;\n");
		await workspace.write("src/b.ts", "export const b = 1;\n");
		const after = await workspace.snapshot?.();
		expect(diffSnapshots(before!, after!)).toEqual([
			{ path: "src/a.ts", change: "modified" },
			{ path: "src/b.ts", change: "added" },
		]);
		// A second edit to an already-modified file still shows.
		await workspace.write("src/a.ts", "export const a = 3;\n");
		expect(diffSnapshots(after!, (await workspace.snapshot?.())!)).toEqual([{ path: "src/a.ts", change: "modified" }]);
	});

	it("has no snapshot outside a git repository", async () => {
		expect(await sandboxWorkspace(new LocalSandbox(), { dir: tempDir() }).snapshot?.()).toBeUndefined();
		expect(await sandboxWorkspace(new LocalSandbox(), { dir: join(tempDir(), "missing") }).snapshot?.()).toBeUndefined();
	});

	it("lists and searches what git does not ignore, skipping NUL-byte files", async () => {
		const dir = checkout();
		writeFileSync(join(dir, ".gitignore"), "ignored.ts\n");
		writeFileSync(join(dir, "ignored.ts"), "export const a = 0;\n");
		writeFileSync(join(dir, "src/bin.ts"), "export const a\0 = 0;\n");
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir });
		expect(await workspace.list?.("**/*.ts")).toEqual(["src/a.ts", "src/bin.ts"]);
		expect(await workspace.search?.("const a", { glob: "**/*.ts" })).toEqual([{ path: "src/a.ts", line: 1, text: "export const a = 1;" }]);
	});
});

describe("cloudflare/sandbox-workspace: publish commits and pushes to the checkout's remote", () => {
	it("Scenario: Publishing reaches the remote", async () => {
		const { bare, dir } = cloneOfBare();
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir });
		await workspace.write("src/a.ts", "export const a = 2;\n");
		const published = await workspace.publish?.("task 2.1");
		expect(published).toEqual({ commit: git(bare, "rev-parse", "main").trim(), changed: true });
		expect(git(bare, "log", "-1", "--format=%s", "main")).toBe("task 2.1\n");
		expect(git(bare, "show", "main:src/a.ts")).toBe("export const a = 2;\n");
	});

	it("Scenario: Nothing to publish", async () => {
		const { bare, dir } = cloneOfBare();
		const head = git(dir, "rev-parse", "HEAD").trim();
		const published = await sandboxWorkspace(new LocalSandbox(), { dir }).publish?.("x");
		expect(published).toEqual({ commit: head, changed: false });
		expect(git(dir, "rev-list", "--count", "HEAD")).toBe("1\n");
		expect(git(bare, "rev-parse", "main").trim()).toBe(head);
	});
});

describe("cloudflare/sandbox-workspace: every sandbox output is redacted of secrets", () => {
	const token = "tok_s3cr3t-value";

	it("a failing push names no token", async () => {
		const { dir } = cloneOfBare();
		// git hides a URL's password itself, so the token goes where git echoes it: a path.
		git(dir, "remote", "set-url", "origin", join(tempDir(), token, "repo.git"));
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir, secrets: [token] });
		await workspace.write("src/a.ts", "export const a = 2;\n");
		const error = (await workspace.publish?.("x").catch((e: unknown) => e)) as Error;
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("***");
		expect(error.message).not.toContain(token);
		expect(error.cause).toBeUndefined();
	});

	it("exec output, file contents and sandbox errors name no token", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "config"), `url = https://x:${token}@host/repo.git\n`);
		const workspace = sandboxWorkspace(new LocalSandbox(), { dir, secrets: [token] });
		const ran = await workspace.exec?.(["bash", "-c", `echo ${token}; echo ${token} >&2; exit 3`], { timeoutMs: 10_000 });
		expect(ran).toEqual({ kind: "exited", code: 3, stdout: "***\n", stderr: "***\n" });
		expect(await workspace.read("config")).toBe("url = https://x:***@host/repo.git\n");
		expect(await workspace.search?.("url")).toEqual([{ path: "config", line: 1, text: "url = https://x:***@host/repo.git" }]);

		expect(await sandboxWorkspace(throwing(`no route to ${token}`), { dir, secrets: [token] }).exec?.(["true"], { timeoutMs: 1000 })).toEqual({
			kind: "spawn-error",
			message: "no route to ***",
		});
		expect(existsSync(join(dir, "config"))).toBe(true);
	});
});
