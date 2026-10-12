/**
 * The run routes `AgentScriptHost` and `defineAgentHost` share, over the host's pi harness:
 *
 *   POST /runs/<host>            { source, entry?, variables?, model? }  → 202 { task }
 *   POST /runs/<host>?wait=1     same                                   → 200 { task, result }
 *   GET  /runs/<host>/<task>     → { task, status, phase?, step? } or { task, status, outcome }
 *
 * A refused start is 422; a `RouteError` from `model` answers its own status; an unknown
 * task or route is 404. No `cloudflare:workers` import, so plain Node can load it.
 */

import type { RunResult, StartOptions } from "../interpreter/index.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness, ModelRef, TaskId } from "@earendil-works/pi-durable";
import { startScript, waitForScript } from "../durable/index.js";

export interface RunRequest extends StartOptions {
	readonly source: string;
	/** A model name; what it means is the host's (`AgentScriptHost` ignores it). */
	readonly model?: string;
}

/** Thrown by `RunRoutes.model` to answer with `status` instead of starting. */
export class RouteError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "RouteError";
	}
}

export interface RunRoutes {
	readonly pi: Harness;
	/** The model a start request runs on. Throws `RouteError` to refuse it. */
	model(body: RunRequest): ModelRef;
}

export async function handleRunRoutes(request: Request, routes: RunRoutes): Promise<Response> {
	const url = new URL(request.url);
	const [, , , task] = url.pathname.split("/");
	const { pi } = routes;
	const context = BACKGROUND_CONTEXT;

	if (request.method === "POST" && task === undefined) {
		const body = (await request.json()) as RunRequest;
		let id: TaskId<RunResult>;
		try {
			id = await startScript(
				pi,
				body.source,
				{
					model: routes.model(body),
					...(body.entry !== undefined ? { entry: body.entry } : {}),
					...(body.variables !== undefined ? { variables: body.variables } : {}),
				},
				context,
			);
		} catch (error) {
			if (error instanceof RouteError) return json({ error: error.message }, error.status);
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

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}
