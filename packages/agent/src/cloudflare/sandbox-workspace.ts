/**
 * A `Workspace` over a Cloudflare Sandbox: real files, git and processes in a
 * container, reached through `SandboxLike`, the slice of the Sandbox SDK it uses.
 * Imports neither `agents` nor `cloudflare:workers`, so it loads in plain Node and
 * tests supply their own sandbox.
 *
 *   read / write   confined to `dir` before any sandbox call, then a `realpath -m`
 *                  check so no symlink leads out; `write` makes missing parents
 *   exec           `timeout --preserve-status -s KILL <s>` + the argv in POSIX single quotes, cwd `dir`;
 *                  exit 137 → timed-out, a throw → spawn-error
 *   snapshot       git porcelain status + `git hash-object` per path; no repo → undefined
 *   list / search  `git ls-files -co --exclude-standard` (every file but `.git/`
 *                  outside git), the shared glob matcher, NUL-byte files skipped
 *   publish        `git add -A`, commit, `git push origin HEAD`
 *
 * We assume `exec`'s string goes through a shell, so every command, ours included,
 * is built from an argv by `shellQuote`. Every output leaving the workspace
 * (results, file contents, paths, error messages) has each of `secrets` replaced
 * with `***`.
 */

import {
	DEFAULT_SEARCH_LIMIT,
	WorkspaceError,
	confine,
	matchGlob,
	matchLines,
	type ExecResult,
	type SearchMatch,
	type Workspace,
	type WorkspaceSnapshot,
} from "../durable/workspace.js";

export interface SandboxExecResult {
	readonly success: boolean;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/** What `sandboxWorkspace` calls on a Sandbox SDK instance. */
export interface SandboxLike {
	exec(
		command: string,
		options?: { cwd?: string; env?: Record<string, string>; timeout?: number; stdin?: string },
	): Promise<SandboxExecResult>;
	readFile(path: string): Promise<{ content: string }>;
	writeFile(path: string, content: string): Promise<unknown>;
	mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
}

export interface SandboxWorkspaceOptions {
	/** The workspace's absolute directory inside the sandbox. */
	readonly dir: string;
	/** Strings replaced with `***` in everything the workspace returns or throws. */
	readonly secrets?: readonly string[];
}

/** `arg` in POSIX single quotes: a shell reads it back as exactly one word, unexpanded. */
export function shellQuote(arg: string): string {
	return "'" + arg.replaceAll("'", "'\\''") + "'";
}

/** A function replacing each of `secrets` in a text with `***`, longest first so a secret containing another is replaced whole. */
export function redactor(secrets: readonly string[]): (text: string) => string {
	const sorted = [...new Set(secrets)].filter((s) => s !== "").sort((a, b) => b.length - a.length);
	return (text) => sorted.reduce((out, secret) => out.replaceAll(secret, "***"), text);
}

/** What `timeout --preserve-status -s KILL` exits with when it killed the command. */
const KILLED_EXIT_CODE = 137;

/** Each of `paths` with its blob hash, or `-` when it is not a file now; one line each. */
const HASH_SCRIPT = 'for p; do if [ -f "$p" ]; then git hash-object -- "$p"; else echo -; fi; done';

/** Regular files git does not ignore (no deleted tracked file, no symlink), or every file but `.git/` outside git; NUL-separated. */
const LIST_SCRIPT = [
	"if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then",
	`  git ls-files -co --exclude-standard -z | while IFS= read -r -d '' p; do`,
	`    if [ -f "$p" ] && [ ! -L "$p" ]; then printf '%s\\0' "$p"; fi`,
	"  done",
	"else",
	`  find . -path ./.git -prune -o -type f -printf '%P\\0'`,
	"fi",
].join("\n");

/** The real `dir`, the real target, then `yes` or `no` for whether the target exists; NUL-separated. */
const REALPATH_SCRIPT = `realpath -m -z -- "$1" "$2" && if [ -e "$2" ]; then printf 'yes\\0'; else printf 'no\\0'; fi`;

export function sandboxWorkspace(sandbox: SandboxLike, options: SandboxWorkspaceOptions): Workspace {
	const dir = options.dir.length > 1 ? options.dir.replace(/\/+$/, "") : options.dir;
	const redact = redactor(options.secrets ?? []);
	/** A fresh error carrying only redacted text, never the original as `cause`. */
	const redactedError = (error: unknown): Error => new Error(redact(error instanceof Error ? error.message : String(error)));
	const at = (key: string) => (dir === "/" ? `/${key}` : `${dir}/${key}`);

	/** One argv through the sandbox's shell, cwd `dir`, output redacted. A throw comes back redacted. */
	async function run(
		argv: readonly string[],
		extra: { env?: Record<string, string>; stdin?: string } = {},
	): Promise<SandboxExecResult> {
		let ran: SandboxExecResult;
		try {
			ran = await sandbox.exec(argv.map(shellQuote).join(" "), { cwd: dir, ...extra });
		} catch (error) {
			throw redactedError(error);
		}
		return { success: ran.success, exitCode: ran.exitCode, stdout: redact(ran.stdout), stderr: redact(ran.stderr) };
	}

	/** `git <args>`, its stdout; any other exit than 0 throws with git's (redacted) stderr. */
	async function git(...args: string[]): Promise<string> {
		const ran = await run(["git", ...args]);
		if (ran.exitCode !== 0) throw new Error(redact(`git ${args.join(" ")} failed (exit ${ran.exitCode}): ${ran.stderr.trim()}`));
		return ran.stdout;
	}

	/** The absolute target of `path` and whether it exists, or `WorkspaceError("outside the workspace")`. */
	async function resolveInside(path: string): Promise<{ target: string; exists: boolean }> {
		// Refused here, before the sandbox sees anything.
		const target = at(confine(path));
		const ran = await run(["sh", "-c", REALPATH_SCRIPT, "sh", dir, target]);
		const [realDir, realTarget, exists] = ran.stdout.split("\0");
		if (ran.exitCode !== 0 || realDir === undefined || realTarget === undefined) {
			throw new Error(redact(`could not resolve ${path} in the sandbox: ${ran.stderr.trim()}`));
		}
		const prefix = realDir === "/" ? "/" : `${realDir}/`;
		if (realTarget !== realDir && !realTarget.startsWith(prefix)) throw new WorkspaceError("outside the workspace", path);
		return { target, exists: exists === "yes" };
	}

	async function listAll(): Promise<string[]> {
		const ran = await run(["bash", "-c", LIST_SCRIPT]);
		if (ran.exitCode !== 0) throw new Error(redact(`could not list ${dir}: ${ran.stderr.trim()}`));
		return ran.stdout
			.split("\0")
			.filter((path) => path !== "")
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	}

	async function list(glob: string): Promise<string[]> {
		return (await listAll()).filter((path) => matchGlob(glob, path));
	}

	return {
		root: dir,
		async read(path) {
			const { target, exists } = await resolveInside(path);
			if (!exists) throw new WorkspaceError("no such file", path);
			try {
				return redact((await sandbox.readFile(target)).content);
			} catch (error) {
				throw redactedError(error);
			}
		},
		async write(path, content) {
			const { target } = await resolveInside(path);
			try {
				await sandbox.mkdir(target.slice(0, target.lastIndexOf("/")) || "/", { recursive: true });
				await sandbox.writeFile(target, content);
			} catch (error) {
				throw redactedError(error);
			}
		},
		async exec(argv, execOptions): Promise<ExecResult> {
			if (argv.length === 0) return { kind: "spawn-error", message: "the command is empty" };
			if (execOptions.signal?.aborted === true) return { kind: "timed-out", stdout: "", stderr: "" };
			const seconds = Math.max(1, Math.ceil(execOptions.timeoutMs / 1000));
			// `--preserve-status`: a killed command is 137 from GNU and uutils alike (uutils alone would say 124).
			const command = ["timeout", "--preserve-status", "-s", "KILL", String(seconds), ...argv];
			const extra = {
				...(execOptions.env !== undefined ? { env: { ...execOptions.env } } : {}),
				...(execOptions.stdin !== undefined ? { stdin: execOptions.stdin } : {}),
			};
			const ran = run(command, extra).then(
				(result): ExecResult =>
					result.exitCode === KILLED_EXIT_CODE
						? { kind: "timed-out", stdout: result.stdout, stderr: result.stderr }
						: { kind: "exited", code: result.exitCode, stdout: result.stdout, stderr: result.stderr },
				(error: Error): ExecResult => ({ kind: "spawn-error", message: error.message }),
			);
			const signal = execOptions.signal;
			if (signal === undefined) return ran;
			// The sandbox call cannot be cancelled; an abort stops waiting, and `timeout` still kills it.
			let onAbort = () => {};
			const aborted = new Promise<ExecResult>((resolve) => {
				onAbort = () => resolve({ kind: "timed-out", stdout: "", stderr: "" });
				signal.addEventListener("abort", onAbort, { once: true });
			});
			try {
				return await Promise.race([ran, aborted]);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		},
		async snapshot(): Promise<WorkspaceSnapshot | undefined> {
			// A sandbox that cannot run git in `dir` (no such directory, say) has no history either.
			const inside = await run(["git", "rev-parse", "--is-inside-work-tree"]).catch(() => undefined);
			if (inside === undefined || inside.exitCode !== 0 || inside.stdout.trim() !== "true") return undefined;
			const top = (await git("rev-parse", "--show-toplevel")).trim();
			const fields = (await git("-C", top, "status", "--porcelain=v1", "-z", "--untracked-files=all")).split("\0");
			const entries: { code: string; path: string }[] = [];
			for (let i = 0; i < fields.length; i++) {
				const field = fields[i]!;
				if (field.length < 4) continue;
				const code = field.slice(0, 2);
				entries.push({ code, path: field.slice(3) });
				// A rename or copy is followed by its source path.
				if (code.includes("R") || code.includes("C")) i++;
			}
			const snapshot = new Map<string, string>();
			if (entries.length === 0) return snapshot;
			const hashed = await run(["sh", "-c", `cd -- "$0" && ${HASH_SCRIPT}`, top, ...entries.map((e) => e.path)]);
			const hashes = hashed.stdout.split("\n");
			if (hashed.exitCode !== 0 || hashes.length < entries.length) {
				throw new Error(redact(`could not hash the changed files in ${top}: ${hashed.stderr.trim()}`));
			}
			entries.forEach(({ code, path }, i) => snapshot.set(path, `${code}:${hashes[i]}`));
			return snapshot;
		},
		list,
		async search(pattern, searchOptions = {}) {
			// No `g` flag: `test` keeps no state from one line to the next. An invalid pattern rejects here.
			const regex = new RegExp(pattern);
			const limit = searchOptions.limit ?? DEFAULT_SEARCH_LIMIT;
			const matches: SearchMatch[] = [];
			if (limit <= 0) return matches;
			const paths = searchOptions.glob === undefined ? await listAll() : await list(searchOptions.glob);
			for (const path of paths) {
				let content: string;
				try {
					content = (await sandbox.readFile(at(path))).content;
				} catch (error) {
					throw redactedError(error);
				}
				if (content.includes("\0")) continue;
				if (matchLines(path, redact(content), regex, matches, limit)) break;
			}
			return matches;
		},
		async publish(message) {
			await git("add", "-A");
			const staged = await run(["git", "diff", "--cached", "--quiet"]);
			if (staged.exitCode === 0) return { commit: (await git("rev-parse", "HEAD")).trim(), changed: false };
			if (staged.exitCode !== 1) throw new Error(redact(`git diff --cached failed (exit ${staged.exitCode}): ${staged.stderr.trim()}`));
			await git("commit", "-m", message);
			await git("push", "origin", "HEAD");
			return { commit: (await git("rev-parse", "HEAD")).trim(), changed: true };
		},
	};
}
