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
 *
 * `defineAgentHost(config)` builds a host from an `AgentConfig` instead, on the same
 * routes (`./routes.ts`), where a start request may also name a config `model`.
 */

import { createModels, type Provider } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { DurableObject } from "cloudflare:workers";
import { AgentScript, AgentScriptStepExtension } from "../durable/index.js";
import { handleRunRoutes } from "./routes.js";

export { defineAgentHost, type AgentHost, type AgentHostClass } from "./agent-host.js";
export { workersAI } from "./workers-ai.js";

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
		const pi = await this.harness.pi();
		const early = await this.beforeRoutes(request, pi);
		if (early !== undefined) return early;
		// Every step runs on the one model `createModel()` chose; a body's `model` is ignored.
		return handleRunRoutes(request, { pi, model: () => this.#choice.model });
	}
}
