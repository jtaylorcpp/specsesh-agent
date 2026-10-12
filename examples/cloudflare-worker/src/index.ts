/**
 * Example Worker: Agent Script runs as pi-durable tasks inside a Durable Object,
 * through `AgentScriptHost` from `@specsesh/agent/cloudflare`.
 *
 *   POST /runs/<host>            { source, entry?, variables?, faux? }  → { task }
 *   POST /runs/<host>?wait=1     same, and waits for the result
 *   GET  /runs/<host>/<task>     → { status, outcome? }
 *   POST /runs/<host>/faux       [responses]  queue faux responses (AGENTSCRIPT_FAUX=1 only)
 *
 * Models: Workers AI by default (AGENTSCRIPT_MODEL picks one), from the published host.
 * `FauxAgentScriptHost` adds the local-testing hooks: with AGENTSCRIPT_FAUX=1 a scripted
 * faux provider replaces Workers AI, and a start request may carry `faux: [...]`, the
 * responses to queue. AGENTSCRIPT_FAUX_TPS paces faux output, so a test can kill the
 * process mid-step. AGENTSCRIPT_FAUX_SEED (JSON) queues responses at construction,
 * before pi resumes any work, so a restarted object has its answers ready.
 *
 * `/agent/runs/...` and `/agent/workspace/...` go to `FauxAgentHost` (`./agent-host.ts`),
 * built with `defineAgentHost` over faux models `default` and `reviewer`:
 *
 *   POST /agent/runs/<host>[?wait=1]     { source, entry?, variables?, model? }
 *   GET  /agent/runs/<host>/<task>
 *   GET  /agent/workspace/<host>/<path>  a file of that object's in-memory workspace
 */

import { AgentScriptHost, type AgentScriptEnv, type ModelChoice } from "@specsesh/agent/cloudflare";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type AssistantMessage } from "@earendil-works/pi-ai";
import type { Harness } from "@earendil-works/pi-durable";
import type { FauxAgentHost } from "./agent-host.js";

export { FauxAgentHost } from "./agent-host.js";

export interface Env extends AgentScriptEnv {
	HOST: DurableObjectNamespace<FauxAgentScriptHost>;
	AGENT_HOST: DurableObjectNamespace<FauxAgentHost>;
	AGENTSCRIPT_FAUX?: string;
	AGENTSCRIPT_FAUX_TPS?: string;
	AGENTSCRIPT_FAUX_SEED?: string;
}

/** One scripted faux response: text, or a submit_result call. Local testing only. */
type FauxResponse = { text: string } | { result: Record<string, string | number | boolean> };

interface FauxChoice extends ModelChoice {
	readonly faux?: ReturnType<typeof fauxProvider>;
}

export class FauxAgentScriptHost extends AgentScriptHost<Env> {
	// Runs inside the base constructor: reads only this.env.
	protected override createModel(): FauxChoice {
		if (this.env.AGENTSCRIPT_FAUX !== "1") return super.createModel();
		const tps = Number(this.env.AGENTSCRIPT_FAUX_TPS);
		const faux = fauxProvider(Number.isFinite(tps) && tps > 0 ? { tokensPerSecond: tps } : {});
		if (this.env.AGENTSCRIPT_FAUX_SEED !== undefined) {
			faux.appendResponses((JSON.parse(this.env.AGENTSCRIPT_FAUX_SEED) as FauxResponse[]).map(toFaux));
		}
		const model = faux.getModel();
		return { provider: faux.provider, model: { provider: model.provider, modelId: model.id }, faux };
	}

	protected override async beforeRoutes(request: Request, pi: Harness): Promise<Response | undefined> {
		const [, , , task] = new URL(request.url).pathname.split("/");
		const faux = (this.modelChoice as FauxChoice).faux;

		if (request.method === "POST" && task === undefined) {
			const body = (await request.clone().json()) as { faux?: FauxResponse[] };
			if (body.faux !== undefined) {
				if (faux === undefined) return json({ error: "faux responses need AGENTSCRIPT_FAUX=1" }, 400);
				faux.appendResponses(body.faux.map(toFaux));
			}
			return undefined;
		}

		if (request.method === "POST" && task === "faux") {
			if (faux === undefined) return json({ error: "faux responses need AGENTSCRIPT_FAUX=1" }, 400);
			faux.appendResponses(((await request.json()) as FauxResponse[]).map(toFaux));
			pi.resume();
			return json({ queued: faux.getPendingResponseCount() });
		}

		return undefined;
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
		const url = new URL(request.url);
		const [, root, host] = url.pathname.split("/");
		if (root === "agent") {
			// `/agent/<rest>` reaches the object as `/<rest>`, the path its routes expect.
			const [, , route, name] = url.pathname.split("/");
			if ((route !== "runs" && route !== "workspace") || name === undefined || name === "") {
				return json({ error: "use /agent/runs/<host> or /agent/workspace/<host>/<path>" }, 404);
			}
			url.pathname = url.pathname.slice("/agent".length);
			return env.AGENT_HOST.getByName(name).fetch(new Request(url, request));
		}
		if (root !== "runs" || host === undefined || host === "") return json({ error: "use /runs/<host>" }, 404);
		return env.HOST.getByName(host).fetch(request);
	},
} satisfies ExportedHandler<Env>;
