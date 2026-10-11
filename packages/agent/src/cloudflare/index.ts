/**
 * Agent Script on Cloudflare: each run is an `agentscript.run` pi-durable task
 * inside a Durable Object, hosted by Cloudflare's PiHarness.
 *
 * The extension is the same one the Node CLI installs. PiHarness gives pi this
 * object's SQLite and its Lifecycle wakes the object when pi has unfinished work,
 * so a run survives eviction and crashes.
 *
 *   POST /runs/<host>            { source, entry?, variables? }  → { task }
 *   POST /runs/<host>?wait=1     same, and waits for the result
 *   GET  /runs/<host>/<task>     → { status, outcome? }
 *
 * A Worker re-exports `AgentScriptHost` (or a subclass) as its Durable Object class
 * and forwards `/runs/<host>` requests to it.
 *
 * Models: Workers AI through `createAI` (AGENTSCRIPT_MODEL picks one). A subclass
 * replaces the provider and model with `createModel()`, and answers requests
 * before the routes above with `beforeRoutes()`.
 */

import type { RunResult, StartOptions } from "../interpreter/index.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type Provider } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef, type TaskId } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { DurableObject } from "cloudflare:workers";
import { AgentScript, AgentScriptStepExtension, startScript, waitForScript } from "../durable/index.js";

export interface AgentScriptEnv {
	AI?: Ai;
	AGENTSCRIPT_MODEL?: string;
}

/** The one pi provider an object registers, and the model every step runs on. */
export interface ModelChoice {
	readonly provider: Provider;
	readonly model: ModelRef;
}

const DEFAULT_WORKERS_AI_MODEL = "@cf/moonshotai/kimi-k2.7-code";

export class AgentScriptHost<E extends AgentScriptEnv = AgentScriptEnv> extends DurableObject<E> {
	readonly #choice: ModelChoice;
	readonly harness: PiHarness;
	readonly lifecycle: Lifecycle<E>;

	constructor(ctx: DurableObjectState, env: E) {
		super(ctx, env);
		// Chosen here, before pi resumes any unfinished work, so a subclass can have
		// its provider ready (answers queued) by the time a resumed step asks.
		this.#choice = this.createModel();

		const registry = createRegistry();
		registry.install(AgentScript);
		registry.install(AgentScriptStepExtension);
		this.harness = new PiHarness({
			harness: ({ storage, context }) => {
				const models = createModels();
				models.setProvider(this.#choice.provider);
				return Harness.open(storage, { models, registry }, context);
			},
		});
		this.lifecycle = Lifecycle.install(this).use(this.harness);
	}

	/**
	 * The provider and model. Called once, from the constructor, before any subclass
	 * field is initialised: an override may read `this.env` and nothing else of its own.
	 */
	protected createModel(): ModelChoice {
		const ai = createAI({ binding: this.env.AI as Ai });
		const model = ai(this.env.AGENTSCRIPT_MODEL ?? DEFAULT_WORKERS_AI_MODEL);
		return { provider: ai.provider, model: { provider: model.provider, modelId: model.id } };
	}

	/** What `createModel()` chose. */
	protected get modelChoice(): ModelChoice {
		return this.#choice;
	}

	/** Answer a request before the routes, or return undefined to fall through to them. */
	protected async beforeRoutes(_request: Request, _pi: Harness): Promise<Response | undefined> {
		return undefined;
	}

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const [, , , task] = url.pathname.split("/");
		const pi = await this.harness.pi();
		const context = BACKGROUND_CONTEXT;

		const early = await this.beforeRoutes(request, pi);
		if (early !== undefined) return early;

		if (request.method === "POST" && task === undefined) {
			const body = (await request.json()) as StartOptions & { source: string };
			let id: TaskId<RunResult>;
			try {
				id = await startScript(
					pi,
					body.source,
					{
						model: this.#choice.model,
						...(body.entry !== undefined ? { entry: body.entry } : {}),
						...(body.variables !== undefined ? { variables: body.variables } : {}),
					},
					context,
				);
			} catch (error) {
				// The script was refused before anything ran: unsupported, unparsable, bad entry.
				return json({ error: error instanceof Error ? error.message : String(error) }, 422);
			}
			pi.resume();
			if (url.searchParams.get("wait") !== "1") return json({ task: id }, 202);
			return json({ task: id, result: await waitForScript(pi, id, context) });
		}

		if (request.method === "GET" && task !== undefined) {
			const record = await pi.getTask(Number(task) as TaskId<RunResult>, context);
			if (record === undefined) return json({ error: `no task ${task}` }, 404);
			const state = record.state;
			if (state.status !== "terminal") {
				const checkpoint = (state as { checkpoint?: { phase?: string; step?: number } }).checkpoint;
				return json({ task: Number(task), status: state.status, phase: checkpoint?.phase, step: checkpoint?.step });
			}
			return json({ task: Number(task), status: "terminal", outcome: state.outcome });
		}

		return json({ error: "not found" }, 404);
	}
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}
