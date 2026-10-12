/**
 * Fakes for the Cloudflare workspace, with no Cloudflare: a `LocalSandbox` runs each
 * command as `bash -c <command>` on this machine (cwd its own temporary `root` unless
 * given) and reads and writes with `node:fs`, recording every call. `fakeArtifacts`
 * keeps each repository as a local bare one, forks with `git clone --bare` and issues
 * random tokens; `failingPush()` makes a sandbox's pushes fail echoing the latest one.
 *
 *   localSandbox(opts?)   a sandbox over a fresh `mkdtemp` root; `opts.intercept` answers a command instead of bash
 *   bareRepo(files)       a bare repository seeded with one commit of `files`
 *   fakeArtifacts(seed)   one bare repository per seeded name
 *   GIT_ENV               the identity and config every sandbox exec runs git with
 *
 * `LocalArtifacts` (a binding over bare repositories you register, failing through
 * hooks) is the older fake the artifacts tests use.
 */

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactsLike, ArtifactsRepoLike } from "../../src/cloudflare/artifacts.js";
import type { SandboxExecResult, SandboxLike } from "../../src/cloudflare/sandbox-workspace.js";

/** Git's identity and config for every sandbox exec: no system config, and a `HOME` of its own, so git behaves the same on any machine. */
export const GIT_ENV: Readonly<Record<string, string>> = {
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.invalid",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.invalid",
	GIT_CONFIG_NOSYSTEM: "1",
	HOME: mkdtempSync(join(tmpdir(), "sbx-home-")),
};

type ExecOptions = NonNullable<Parameters<SandboxLike["exec"]>[1]>;

/** Answers `command` in place of bash, or `undefined` to let it run. */
export type Intercept = (command: string) => SandboxExecResult | undefined;

export type SandboxCall =
	| { readonly method: "exec"; readonly args: readonly [string, ExecOptions]; readonly command: string; readonly cwd?: string }
	| { readonly method: "readFile" | "writeFile" | "mkdir"; readonly args: readonly unknown[]; readonly path: string };

export class LocalSandbox implements SandboxLike {
	/** Every call, in order; an escape refused before the sandbox leaves this empty. */
	readonly calls: SandboxCall[] = [];
	#root: string | undefined;

	constructor(readonly options: { root?: string; intercept?: Intercept } = {}) {
		this.#root = options.root;
	}

	/** The sandbox's temporary directory, made on first use when none was given. */
	get root(): string {
		return (this.#root ??= mkdtempSync(join(tmpdir(), "sbx-")));
	}

	exec(command: string, options: ExecOptions = {}): Promise<SandboxExecResult> {
		this.calls.push({ method: "exec", args: [command, options], command, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
		const intercepted = this.options.intercept?.(command);
		if (intercepted !== undefined) return Promise.resolve(intercepted);
		return new Promise((resolve, reject) => {
			// As a sandbox does, the given variables add to the container's environment.
			const child = spawn("bash", ["-c", command], {
				cwd: options.cwd ?? this.root,
				env: { ...process.env, ...GIT_ENV, ...options.env },
			});
			// A backstop only: the workspace's own `timeout -s KILL` is what a test exercises.
			const timer = options.timeout === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), options.timeout);
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
			child.on("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.on("close", (code, signal) => {
				clearTimeout(timer);
				const exitCode = code ?? (signal === null ? -1 : 128 + constants.signals[signal]);
				resolve({ success: exitCode === 0, stdout, stderr, exitCode });
			});
			child.stdin.on("error", () => {});
			child.stdin.end(options.stdin ?? "");
		});
	}

	/** Throws when `path` is missing, as the SDK does. */
	async readFile(path: string): Promise<{ content: string }> {
		this.calls.push({ method: "readFile", args: [path], path });
		return { content: await readFile(path, "utf8") };
	}

	async writeFile(path: string, content: string): Promise<void> {
		this.calls.push({ method: "writeFile", args: [path, content], path });
		await writeFile(path, content);
	}

	async mkdir(path: string, options: { recursive: boolean }): Promise<void> {
		this.calls.push({ method: "mkdir", args: [path, options], path });
		await mkdir(path, options);
	}

	async dispose(): Promise<void> {
		if (this.#root !== undefined) await rm(this.#root, { recursive: true, force: true });
	}
}

/** A `LocalSandbox` over a fresh temporary `root`. */
export async function localSandbox(opts: { intercept?: Intercept } = {}): Promise<LocalSandbox> {
	const sandbox = new LocalSandbox({ ...opts, root: await mkdtemp(join(tmpdir(), "sbx-")) });
	const checked: SandboxLike = sandbox;
	void checked;
	return sandbox;
}

const gitSync = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...GIT_ENV },
		stdio: ["ignore", "pipe", "pipe"],
	});

export interface BareRepo {
	readonly path: string;
	readonly url: string;
	dispose(): void;
}

/** A temporary bare repository on `branch`, its one commit holding `files` (paths relative, `/`-separated). */
export function bareRepo(files: Readonly<Record<string, string>>, { branch = "main" }: { branch?: string } = {}): BareRepo {
	const tmp = mkdtempSync(join(tmpdir(), "bare-"));
	const path = join(tmp, "repo.git");
	const scratch = join(tmp, "scratch");
	gitSync(tmp, "init", "-q", "--bare", `--initial-branch=${branch}`, path);
	gitSync(tmp, "clone", "-q", path, scratch);
	gitSync(scratch, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
	for (const [file, content] of Object.entries(files)) {
		const target = join(scratch, file);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	gitSync(scratch, "add", "-A");
	gitSync(scratch, "commit", "-q", "--allow-empty", "-m", "init");
	gitSync(scratch, "push", "-q", "origin", `HEAD:${branch}`);
	rmSync(scratch, { recursive: true, force: true });
	return { path, url: `file://${path}`, dispose: () => rmSync(tmp, { recursive: true, force: true }) };
}

export interface FakeRepo extends ArtifactsRepoLike {
	readonly name: string;
	/** The bare repository on disk. */
	readonly path: string;
}

export interface FakeArtifacts extends ArtifactsLike {
	/** The name of every fork made, in order. */
	readonly forkCalls: string[];
	/** Every token issued, with the repository and scope it was issued for. */
	readonly tokens: { readonly repo: string; readonly scope: string; readonly token: string }[];
	/** An intercept failing every `git … push`, echoing the latest token in its remote URL. */
	failingPush(): Intercept;
	/** The same as `failingPush()`. */
	pushFailure(): Intercept;
	dispose(): void;
}

/** An Artifacts binding holding one bare repository per name in `seed`, each with one commit of its files. */
export function fakeArtifacts(seed: Readonly<Record<string, Readonly<Record<string, string>>>>): FakeArtifacts {
	const forks = mkdtempSync(join(tmpdir(), "artifacts-"));
	const disposers: (() => void)[] = [() => rmSync(forks, { recursive: true, force: true })];
	const repos = new Map<string, FakeRepo>();
	const forkCalls: string[] = [];
	const tokens: { repo: string; scope: string; token: string }[] = [];

	function handle(name: string, path: string): FakeRepo {
		const repo: FakeRepo = {
			name,
			path,
			remote: `file://${path}`,
			async fork(forkName) {
				const forkPath = join(forks, `${forkName}.git`);
				gitSync(forks, "clone", "-q", "--bare", path, forkPath);
				forkCalls.push(forkName);
				const forked = handle(forkName, forkPath);
				repos.set(forkName, forked);
				return forked;
			},
			async createToken(scope) {
				if (scope !== "write") throw new Error(`unsupported token scope: ${String(scope)}`);
				const token = `tok_${randomBytes(16).toString("hex")}`;
				tokens.push({ repo: name, scope, token });
				return token;
			},
		};
		return repo;
	}

	for (const [name, files] of Object.entries(seed)) {
		const bare = bareRepo(files);
		disposers.push(bare.dispose);
		repos.set(name, handle(name, bare.path));
	}

	const failingPush = (): Intercept => (command) => {
		if (!/\bgit\b.*\bpush\b/.test(command)) return undefined;
		const latest = tokens.at(-1);
		const text = `fatal: unable to access 'https://x:${latest?.token ?? ""}@artifacts.example/${latest?.repo ?? ""}.git/': denied\n`;
		return { success: false, exitCode: 128, stdout: text, stderr: text };
	};

	return {
		forkCalls,
		tokens,
		async get(name) {
			return repos.get(name);
		},
		failingPush,
		pushFailure: failingPush,
		dispose: () => disposers.forEach((dispose) => dispose()),
	};
}

export interface LocalArtifactsFailures {
	/** A fork's pushes are refused by a hook that prints the fork's latest token. */
	readonly failPush?: boolean;
	/** A fork's remote is a missing path naming the token it will be issued. */
	readonly brokenRemote?: boolean;
}

export class LocalArtifacts implements ArtifactsLike {
	readonly #repos = new Map<string, LocalRepo>();
	/** The name of every fork made, in order. */
	readonly forked: string[] = [];
	/** Every token issued, with the repository it was issued for. */
	readonly tokens: { readonly repo: string; readonly token: string }[] = [];

	constructor(
		readonly root: string,
		readonly failures: LocalArtifactsFailures = {},
	) {}

	/** Registers the bare repository at `path` as `name`. */
	add(name: string, path: string): void {
		this.#repos.set(name, new LocalRepo(this, name, path, pathToFileURL(path).href));
	}

	async get(name: string): Promise<ArtifactsRepoLike | undefined> {
		return this.#repos.get(name);
	}

	fork(from: LocalRepo, name: string): LocalRepo {
		this.forked.push(name);
		const path = join(this.root, `${name}.git`);
		execFileSync("git", ["clone", "-q", "--bare", from.path, path]);
		let repo: LocalRepo;
		if (this.failures.brokenRemote === true) {
			const token = newToken();
			repo = new LocalRepo(this, name, path, pathToFileURL(join(this.root, token, "gone.git")).href, token);
		} else {
			repo = new LocalRepo(this, name, path, pathToFileURL(path).href);
		}
		if (this.failures.failPush === true) {
			const hook = join(path, "hooks", "pre-receive");
			writeFileSync(hook, '#!/bin/sh\necho "remote rejected for token $(cat "$GIT_DIR/last-token")" >&2\nexit 1\n');
			chmodSync(hook, 0o755);
		}
		this.#repos.set(name, repo);
		return repo;
	}
}

class LocalRepo implements ArtifactsRepoLike {
	constructor(
		readonly artifacts: LocalArtifacts,
		readonly name: string,
		readonly path: string,
		readonly remote: string,
		readonly nextToken?: string,
	) {}

	async fork(name: string): Promise<ArtifactsRepoLike> {
		return this.artifacts.fork(this, name);
	}

	async createToken(_scope: "write"): Promise<string> {
		const token = this.nextToken ?? newToken();
		this.artifacts.tokens.push({ repo: this.name, token });
		writeFileSync(join(this.path, "last-token"), token);
		return token;
	}
}

function newToken(): string {
	return `art_${randomBytes(12).toString("hex")}`;
}
