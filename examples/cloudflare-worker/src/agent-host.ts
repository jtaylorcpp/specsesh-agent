/**
 * `FauxAgentHost`: a Durable Object built with `defineAgentHost` from an `AgentConfig`,
 * over scripted faux models and an in-memory workspace. Local testing only; the Worker
 * routes `/agent/...` to it (see `./index.ts`).
 *
 *   POST /runs/<host>            { source, entry?, variables?, model? }  → 202 { task }
 *   POST /runs/<host>?wait=1     same                                   → 200 { task, result }
 *   GET  /runs/<host>/<task>     → { task, status, phase?, step? } or { task, status, outcome }
 *   GET  /workspace/<host>/<path>  → { path, content }  a file of this object's workspace
 *
 * Models `default` and `reviewer` are two models of one faux provider. Each step's first
 * turn calls the `edit` tool with `{ content: "new" }`; once a tool result is in the
 * transcript it answers `done by <model>`, so a result's steps name the model that ran.
 * The workspace starts as `{ "notes.txt": "old" }`.
 *
 * With the Workers AI binding, the same host is:
 *
 *   models: { default: (env) => workersAI(env.AI!, "@cf/meta/llama-4-scout") },
 */

import { defineAgentHost } from "@specsesh/agent/cloudflare";
import { memoryWorkspace, type Workspace } from "@specsesh/agent/durable";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	type FauxResponseFactory,
} from "@earendil-works/pi-ai";

export interface AgentHostEnv {
	AI?: Ai;
}

// Keyed by each object's own env (the constructor copies it), so two objects never share.
const providers = new WeakMap<object, ReturnType<typeof fauxProvider>>();
const workspaces = new WeakMap<object, Workspace>();

function faux(env: object): ReturnType<typeof fauxProvider> {
	let provider = providers.get(env);
	if (provider === undefined) {
		provider = fauxProvider({ provider: "faux", models: [{ id: "default" }, { id: "reviewer" }] });
		const respond: FauxResponseFactory = (context, _options, _state, model) => {
			provider!.appendResponses([respond]);
			return context.messages.some((message) => message.role === "toolResult")
				? fauxAssistantMessage([fauxText(`done by ${model.id}`)])
				: fauxAssistantMessage([fauxToolCall("edit", { content: "new" })], { stopReason: "toolUse" });
		};
		provider.setResponses([respond]);
		providers.set(env, provider);
	}
	return provider;
}

function fauxModel(env: object, id: string) {
	const provider = faux(env);
	return { provider: provider.provider, model: { provider: provider.getModel(id)!.provider, modelId: id } };
}

function workspaceOf(env: object): Workspace {
	let workspace = workspaces.get(env);
	if (workspace === undefined) {
		workspace = memoryWorkspace({ "notes.txt": "old" });
		workspaces.set(env, workspace);
	}
	return workspace;
}

export class FauxAgentHost extends defineAgentHost<AgentHostEnv>({
	models: {
		default: (env) => fauxModel(env, "default"),
		reviewer: (env) => fauxModel(env, "reviewer"),
	},
	workspace: (env) => workspaceOf(env),
}) {
	constructor(ctx: DurableObjectState, env: AgentHostEnv) {
		super(ctx, { ...env });
	}

	override async onRequest(request: Request): Promise<Response> {
		const [, root, , ...path] = new URL(request.url).pathname.split("/");
		if (request.method !== "GET" || root !== "workspace") return super.onRequest(request);
		await this.harness.pi(); // the config's workspace is built with the harness
		const file = decodeURIComponent(path.join("/"));
		try {
			return json({ path: file, content: await workspaceOf(this.env).read(file) });
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 404);
		}
	}
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}
