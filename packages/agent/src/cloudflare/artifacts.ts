/**
 * A `sandboxWorkspace` over a checkout of a per-task Artifacts fork. Imports neither
 * `agents` nor `cloudflare:workers`: the real binding is adapted to `ArtifactsLike`
 * at the host, so this loads in plain Node and tests supply their own.
 *
 *   fork    `artifacts.get(fork)`, or `get(repo).fork(fork)` the first time; a restart reuses it
 *   token   a write token for the fork only; the base repo is never given one
 *   clone   into `dir` unless it already holds a checkout of the fork's remote
 *
 * The token is a secret of the workspace, so it is redacted from everything it
 * returns or throws, and from every error thrown here.
 */

import { redactor, sandboxWorkspace, shellQuote, type SandboxExecResult, type SandboxLike } from "./sandbox-workspace.js";
import type { Workspace } from "../durable/workspace.js";

/** A repository handle, as the Artifacts binding returns it. */
export interface ArtifactsRepoLike {
	/** The repository's git remote, without credentials. */
	readonly remote: string;
	fork(name: string): Promise<ArtifactsRepoLike>;
	createToken(scope: "write"): Promise<string>;
}

/** What `artifactsSandboxWorkspace` calls on an Artifacts binding. */
export interface ArtifactsLike {
	get(name: string): Promise<ArtifactsRepoLike | null | undefined>;
}

export interface ArtifactsSandboxWorkspaceOptions {
	/** The repository the fork is made from. */
	readonly repo: string;
	/** The fork's name, one per task. */
	readonly fork: string;
	/** The checkout's absolute directory inside the sandbox. */
	readonly dir: string;
}

/** Exits 3 when `$1` holds no git checkout of its own, else prints its `origin`. */
const ORIGIN_SCRIPT = 'test -e "$1/.git" || exit 3; git -C "$1" remote get-url origin';
const NO_CHECKOUT = 3;

export async function artifactsSandboxWorkspace(
	artifacts: ArtifactsLike,
	sandbox: SandboxLike,
	options: ArtifactsSandboxWorkspaceOptions,
): Promise<Workspace> {
	const { repo, fork, dir } = options;
	let handle = await artifacts.get(fork);
	if (handle == null) {
		const base = await artifacts.get(repo);
		if (base == null) throw new Error(`artifacts repo ${repo} not found`);
		handle = await base.fork(fork);
	}
	const token = await handle.createToken("write");
	const redact = redactor([token]);

	/** One argv through the sandbox's shell; a throw or a non-zero exit other than `allowed` rejects, redacted, naming `what`. */
	async function run(what: string, argv: readonly string[], allowed: readonly number[] = []): Promise<SandboxExecResult> {
		let ran: SandboxExecResult;
		try {
			ran = await sandbox.exec(argv.map(shellQuote).join(" "));
		} catch (error) {
			throw new Error(redact(error instanceof Error ? error.message : String(error)));
		}
		if (ran.exitCode !== 0 && !allowed.includes(ran.exitCode)) {
			throw new Error(redact(`${what} failed (exit ${ran.exitCode}): ${ran.stderr.trim()}`));
		}
		return ran;
	}

	// The token goes to git as an HTTP header scoped to the fork's remote, so `origin`
	// stays the plain remote. Whether Artifacts wants it there or in the URL is settled
	// at the first deploy; either way it is a secret of the workspace.
	const headerKey = `http.${handle.remote}.extraHeader`;
	const header = `Authorization: Bearer ${token}`;
	const origin = await run(`reading ${dir}'s origin`, ["sh", "-c", ORIGIN_SCRIPT, "sh", dir], [NO_CHECKOUT]);
	if (origin.exitCode === NO_CHECKOUT) {
		await run(`cloning ${fork} into ${dir}`, ["git", "clone", "-q", "-c", `${headerKey}=${header}`, handle.remote, dir]);
	} else if (origin.stdout.trim() === handle.remote) {
		// A new token each build: the previous one, no longer a secret here, must not stay in `.git/config`.
		await run(`storing ${fork}'s token in ${dir}`, ["git", "-C", dir, "config", headerKey, header]);
	} else {
		throw new Error(redact(`${dir} holds a checkout of another remote: ${origin.stdout.trim()}`));
	}
	return sandboxWorkspace(sandbox, { dir, secrets: [token] });
}
