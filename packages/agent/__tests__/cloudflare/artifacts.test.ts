import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { artifactsSandboxWorkspace } from "../../src/cloudflare/artifacts.js";
import { LocalArtifacts, LocalSandbox, type LocalArtifactsFailures } from "./fakes.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cloudflare");
const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-artifacts-"));
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

/** A fake Artifacts binding holding `my-app` (a bare repository on `main` with `src/a.ts`), and a checkout path that does not exist yet. */
function setup(failures: LocalArtifactsFailures = {}): { artifacts: LocalArtifacts; dir: string } {
	const seed = tempDir();
	git(seed, "init", "-q", "-b", "main");
	identify(seed);
	mkdirSync(join(seed, "src"));
	writeFileSync(join(seed, "src/a.ts"), "export const a = 1;\n");
	git(seed, "add", "-A");
	git(seed, "commit", "-q", "-m", "init");
	const root = tempDir();
	const bare = join(root, "my-app.git");
	git(seed, "clone", "-q", "--bare", seed, bare);
	const artifacts = new LocalArtifacts(root, failures);
	artifacts.add("my-app", bare);
	return { artifacts, dir: join(tempDir(), "workspace") };
}

const options = (dir: string) => ({ repo: "my-app", fork: "task-2.1", dir });

describe("cloudflare/sandbox-workspace: The cloudflare entry exports the sandbox workspace", () => {
	it("loads artifacts.ts in plain Node, importing neither agents nor cloudflare:workers", async () => {
		const loaded = await import("../../src/cloudflare/artifacts.js");
		expect(typeof loaded.artifactsSandboxWorkspace).toBe("function");
		const imports = [...readFileSync(join(SRC, "artifacts.ts"), "utf8").matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
		expect(imports.length).toBeGreaterThan(0);
		for (const spec of imports) expect(spec).not.toMatch(/^agents(\/|$)|^cloudflare:workers$/);
	});
});

describe("cloudflare/sandbox-workspace: An Artifacts fork per task, reused after a restart", () => {
	it("Scenario: A second build reuses the fork and the checkout", async () => {
		const { artifacts, dir } = setup();
		const first = await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir));
		await first.write("src/b.ts", "export const b = 1;\n");

		const sandbox = new LocalSandbox();
		const second = await artifactsSandboxWorkspace(artifacts, sandbox, options(dir));
		expect(artifacts.forked).toEqual(["task-2.1"]);
		const commands = sandbox.calls.flatMap((call) => (call.method === "exec" ? [call.command] : []));
		expect(commands.some((command) => command.includes("'clone'"))).toBe(false);
		expect(await second.read("src/b.ts")).toBe("export const b = 1;\n");
		expect(await second.read("src/a.ts")).toBe("export const a = 1;\n");
	});

	it("forks the named repo once, tokens only the fork, and refuses a missing repo or a foreign checkout", async () => {
		const { artifacts, dir } = setup();
		await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir));
		expect(git(dir, "remote", "get-url", "origin").trim()).toBe((await artifacts.get("task-2.1"))!.remote);
		expect(artifacts.tokens.map((t) => t.repo)).toEqual(["task-2.1"]);

		await expect(artifactsSandboxWorkspace(artifacts, new LocalSandbox(), { repo: "nope", fork: "task-9", dir: join(tempDir(), "w") })).rejects.toThrow(
			"artifacts repo nope not found",
		);

		const other = join(tempDir(), "other");
		git(tmpdir(), "clone", "-q", (await artifacts.get("my-app"))!.remote, other);
		await expect(artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(other))).rejects.toThrow(
			`${other} holds a checkout of another remote`,
		);
	});

	it("replaces the previous build's token in the checkout, and hides the current one", async () => {
		const { artifacts, dir } = setup();
		await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir));
		const workspace = await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir));
		const [old, current] = artifacts.tokens.map((t) => t.token);
		const config = readFileSync(join(dir, ".git", "config"), "utf8");
		expect(config).not.toContain(old);
		expect(config).toContain(current);
		const seen = await workspace.read(".git/config");
		expect(seen).toContain("Authorization: Bearer ***");
		expect(seen).not.toContain(current);
	});

	it("publishes to the fork, not the base repo", async () => {
		const { artifacts, dir } = setup();
		const workspace = await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir));
		identify(dir);
		await workspace.write("src/a.ts", "export const a = 2;\n");
		await workspace.publish?.("task 2.1");
		const fork = join(artifacts.root, "task-2.1.git");
		expect(git(fork, "log", "-1", "--format=%s", "main")).toBe("task 2.1\n");
		expect(git(join(artifacts.root, "my-app.git"), "log", "-1", "--format=%s", "main")).toBe("init\n");
	});
});

describe("cloudflare/sandbox-workspace: The fork token never leaks", () => {
	it("Scenario: A failing push does not print the token", async () => {
		const { artifacts, dir } = setup({ failPush: true });
		const workspace = await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir));
		identify(dir);
		await workspace.write("src/a.ts", "export const a = 2;\n");
		const error = (await workspace.publish?.("x").catch((e: unknown) => e)) as Error;
		const token = artifacts.tokens[0]!.token;
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("remote rejected for token ***");
		expect(error.message).not.toContain(token);
		const shown = await workspace.exec!(["git", "config", "--get-regexp", "extraheader"], { timeoutMs: 10_000 });
		expect(shown).toMatchObject({ kind: "exited", code: 0 });
		const output = shown.kind === "exited" ? shown.stdout + shown.stderr : "";
		expect(output).toContain("Authorization: Bearer ***");
		expect(output).not.toContain(token);
	});

	it("a failing clone does not print the token", async () => {
		const { artifacts, dir } = setup({ brokenRemote: true });
		const error = (await artifactsSandboxWorkspace(artifacts, new LocalSandbox(), options(dir)).catch((e: unknown) => e)) as Error;
		const token = artifacts.tokens[0]!.token;
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("cloning task-2.1");
		expect(error.message).toContain("***");
		expect(error.message).not.toContain(token);
	});
});
