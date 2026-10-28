/**
 * A held `claude -p` session, for the claude-code pi provider's bridged requests.
 *
 * A pi host (pi-durable included) must run every tool call itself, so the
 * provider can't let Claude Code run them. Instead the bridge holds each call
 * Claude Code makes, the provider hands it to pi as a `toolCall`, and the call's
 * `toolResult`, on a later request, is handed back to the same process. One
 * session is one bridge plus one process, alive across those requests.
 */

import { randomUUID } from "node:crypto";
import { claudeArgs, toolStepEnv, type ClaudeInvocation, type ProcessResult, type Runner } from "./claude-code.js";
import type { BridgeHandler, BridgeReply, BridgeTool, ToolBridge, ToolBridgeFactory } from "./tool-bridge.js";

/** A call Claude Code made through the bridge, handed out to pi under `id`. */
export interface HandedCall {
	readonly id: string;
	readonly name: string;
	readonly args: Record<string, unknown>;
}

/** What a session does next: hand out the calls it holds, or end with the process's result. */
export type SessionEvent =
	| { readonly kind: "calls"; readonly calls: readonly HandedCall[] }
	| { readonly kind: "done"; readonly result: ProcessResult };

interface QueuedCall {
	readonly name: string;
	readonly args: Record<string, unknown>;
	readonly resolve: (reply: BridgeReply) => void;
}

/** The provider's live sessions, by the ids of the calls they hold. */
export class SessionRegistry {
	readonly #byId = new Map<string, ProviderSession>();

	/** The live session holding the call `id`, if any. */
	sessionOf(id: string): ProviderSession | undefined {
		return this.#byId.get(id);
	}

	add(id: string, session: ProviderSession): void {
		this.#byId.set(id, session);
	}

	/** Forgets every id `session` held. */
	drop(session: ProviderSession): void {
		for (const [id, held] of this.#byId) if (held === session) this.#byId.delete(id);
	}
}

export interface StartSessionOptions {
	readonly bridge: ToolBridgeFactory;
	/** The request's tools other than `submit_result`, as the bridge serves them. */
	readonly tools: readonly BridgeTool[];
	/** The process's invocation, minus the bridge's `tools`. */
	readonly invocation: Omit<ClaudeInvocation, "tools">;
	/** `promptOf` the request's transcript, on stdin. */
	readonly prompt: string;
	readonly runnerFor: (signal: AbortSignal) => Runner;
	readonly registry: SessionRegistry;
}

/** Starts the bridge, then the one process. Throws only when the bridge can't start. */
export async function startSession(options: StartSessionOptions): Promise<ProviderSession> {
	const session = new ProviderSession(options.registry);
	const running = await options.bridge(options.tools, session.handler);
	session.run(running, options);
	return session;
}

export class ProviderSession {
	readonly controller = new AbortController();
	readonly #registry: SessionRegistry;
	/** Calls not yet handed out, in arrival order. */
	readonly #queue: QueuedCall[] = [];
	/** Handed-out calls waiting for their result, by id. */
	readonly #held = new Map<string, (reply: BridgeReply) => void>();
	#arrived: (() => void) | undefined;
	#ended: Promise<ProcessResult> | undefined;
	#bridge: ToolBridge | undefined;
	/** Set once the process has ended, so `end()` no longer aborts it. */
	#exited = false;
	#closing: Promise<void> | undefined;

	constructor(registry: SessionRegistry) {
		this.#registry = registry;
	}

	readonly handler: BridgeHandler = (name, args) =>
		new Promise<BridgeReply>((resolve) => {
			if (this.#closing !== undefined) return resolve({ ok: false, text: "aborted" });
			this.#queue.push({ name, args, resolve });
			this.#arrived?.();
		});

	/** @internal Runs the process once; the bridge closes and the ids go as soon as it ends. */
	run(running: ToolBridge, options: StartSessionOptions): void {
		this.#bridge = running;
		const args = claudeArgs({
			...options.invocation,
			tools: { mcpConfig: running.mcpConfig, allowedTools: running.allowedTools },
		});
		this.#ended = options
			.runnerFor(this.controller.signal)(args, options.prompt, toolStepEnv(process.env))
			.catch((error: unknown): ProcessResult => ({
				code: null,
				stdout: "",
				stderr: "",
				spawnError: error instanceof Error ? error : new Error(String(error)),
			}))
			.then(async (result) => {
				this.#exited = true;
				await this.end();
				return result;
			});
	}

	/**
	 * Ends the session, once: aborts the process unless it has already ended,
	 * forgets its ids, answers any call still waiting so no bridge handler hangs,
	 * and closes the bridge. Both the process ending and an aborted request end here.
	 */
	end(): Promise<void> {
		if (!this.#exited) this.controller.abort();
		this.#closing ??= (async () => {
			this.#registry.drop(this);
			const aborted: BridgeReply = { ok: false, text: "aborted" };
			for (const resolve of this.#held.values()) resolve(aborted);
			this.#held.clear();
			for (const call of this.#queue.splice(0)) call.resolve(aborted);
			await this.#bridge?.close();
		})();
		return this.#closing;
	}

	/** Hands a held call its result, so Claude Code continues. False for an id this session doesn't hold. */
	resolve(id: string, reply: BridgeReply): boolean {
		const resolve = this.#held.get(id);
		if (resolve === undefined) return false;
		this.#held.delete(id);
		resolve(reply);
		return true;
	}

	/** Whichever comes first: calls not yet handed out, or the process ending. */
	async nextEvent(): Promise<SessionEvent> {
		const ended = this.#ended!;
		if (this.#queue.length === 0) {
			const arrival = new Promise<"calls">((resolve) => (this.#arrived = () => resolve("calls")));
			const first = await Promise.race([arrival, ended.then(() => "done" as const)]);
			this.#arrived = undefined;
			if (first === "done") return { kind: "done", result: await ended };
		}
		// One more turn of the event loop, so calls Claude Code made together go out together.
		await new Promise<void>((resolve) => setImmediate(resolve));
		// The process ended meanwhile, and `end()` answered the calls it had queued.
		if (this.#queue.length === 0) return { kind: "done", result: await ended };
		const calls = this.#queue.splice(0).map((call): HandedCall => {
			const id = `claude-code-${randomUUID()}`;
			this.#held.set(id, call.resolve);
			this.#registry.add(id, this);
			return { id, name: call.name, args: call.args };
		});
		return { kind: "calls", calls };
	}
}
