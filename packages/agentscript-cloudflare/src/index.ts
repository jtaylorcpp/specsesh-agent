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
 *   POST /runs/<host>/faux       [responses]  queue faux responses (AGENTSCRIPT_FAUX=1 only)
 *
 * Models: Workers AI through `createAI` by default (AGENTSCRIPT_MODEL picks one).
 * With AGENTSCRIPT_FAUX=1 (local testing only) a scripted faux provider replaces
 * it, and a request may carry `faux: [...]`, the responses to queue.
 * AGENTSCRIPT_FAUX_TPS paces faux output, so a test can kill the process mid-step.
 * AGENTSCRIPT_FAUX_SEED (JSON) queues responses at construction, before pi resumes
 * any work, so a restarted object has its answers ready.
 */

import type { RunResult, StartOptions } from "@coopcli/agentscript/interpreter";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	type AssistantMessage,
} from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef, type TaskId } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { AgentScript, AgentScriptStepExtension, startScript, waitForScript } from "agentscript-durable";
import { DurableObject } from "cloudflare:workers";

export interface Env {
	HOST: DurableObjectNamespace<AgentScriptHost>;
	AI?: Ai;
	AGENTSCRIPT_MODEL?: string;
	AGENTSCRIPT_FAUX?: string;
	AGENTSCRIPT_FAUX_TPS?: string;
	AGENTSCRIPT_FAUX_SEED?: string;
}

/** One scripted faux response: text, or a submit_result call. Local testing only. */
type FauxResponse = { text: string } | { result: Record<string, string | number | boolean> };

const DEFAULT_WORKERS_AI_MODEL = "@cf/moonshotai/kimi-k2.7-code";

export class AgentScriptHost extends DurableObject<Env> {
	readonly #faux: ReturnType<typeof fauxProvider>;
	readonly #model: ModelRef;
	readonly harness: PiHarness;
	readonly lifecycle: Lifecycle<Env>;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const tps = Number(env.AGENTSCRIPT_FAUX_TPS);
		this.#faux = fauxProvider(Number.isFinite(tps) && tps > 0 ? { tokensPerSecond: tps } : {});
		if (env.AGENTSCRIPT_FAUX === "1" && env.AGENTSCRIPT_FAUX_SEED !== undefined) {
			this.#faux.appendResponses((JSON.parse(env.AGENTSCRIPT_FAUX_SEED) as FauxResponse[]).map(toFaux));
		}
		const useFaux = env.AGENTSCRIPT_FAUX === "1";
		const ai = useFaux ? undefined : createAI({ binding: env.AI as Ai });
		const fauxModel = this.#faux.getModel();
		const model = ai?.(env.AGENTSCRIPT_MODEL ?? DEFAULT_WORKERS_AI_MODEL);
		this.#model = model !== undefined ? { provider: model.provider, modelId: model.id } : { provider: fauxModel.provider, modelId: fauxModel.id };

		const registry = createRegistry();
		registry.install(AgentScript);
		registry.install(AgentScriptStepExtension);
		this.harness = new PiHarness({
			harness: ({ storage, context }) => {
				const models = createModels();
				models.setProvider(ai !== undefined ? ai.provider : this.#faux.provider);
				return Harness.open(storage, { models, registry }, context);
			},
		});
		this.lifecycle = Lifecycle.install(this).use(this.harness);
	}

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const [, , , task] = url.pathname.split("/");
		const pi = await this.harness.pi();
		const context = BACKGROUND_CONTEXT;

		if (request.method === "POST" && task === undefined) {
			const body = (await request.json()) as StartOptions & { source: string; faux?: FauxResponse[] };
			if (body.faux !== undefined) {
				if (this.env.AGENTSCRIPT_FAUX !== "1") return json({ error: "faux responses need AGENTSCRIPT_FAUX=1" }, 400);
				this.#faux.appendResponses(body.faux.map(toFaux));
			}
			let id: TaskId<RunResult>;
			try {
				id = await startScript(
					pi,
					body.source,
					{
						model: this.#model,
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

		if (request.method === "POST" && task === "faux") {
			if (this.env.AGENTSCRIPT_FAUX !== "1") return json({ error: "faux responses need AGENTSCRIPT_FAUX=1" }, 400);
			this.#faux.appendResponses(((await request.json()) as FauxResponse[]).map(toFaux));
			pi.resume();
			return json({ queued: this.#faux.getPendingResponseCount() });
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

function toFaux(response: FauxResponse): AssistantMessage {
	return "text" in response
		? fauxAssistantMessage([fauxText(response.text)])
		: fauxAssistantMessage([fauxToolCall("submit_result", response.result)], { stopReason: "toolUse" });
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const [, root, host] = new URL(request.url).pathname.split("/");
		if (root !== "runs" || host === undefined || host === "") return json({ error: "use /runs/<host>" }, 404);
		return env.HOST.getByName(host).fetch(request);
	},
} satisfies ExportedHandler<Env>;
