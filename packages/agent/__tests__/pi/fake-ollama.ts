import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeOllamaReply = { text: string } | { toolCall: { name?: string; arguments: object } };

export interface FakeOllamaRequest {
	method: string;
	path: string;
	body: unknown;
}

export interface FakeOllama {
	url: string;
	requests: FakeOllamaRequest[];
	close(): Promise<void>;
}

/**
 * A local stand-in for Ollama: `/api/tags` from `models`, `/v1/chat/completions` streaming `reply`
 * (or what `reply` answers for the request's body).
 */
export async function startFakeOllama(options: { models: string[]; reply?: FakeOllamaReply | ((body: unknown) => FakeOllamaReply) }): Promise<FakeOllama> {
	const requests: FakeOllamaRequest[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const path = (req.url ?? "/").split("?")[0]!;
			const raw = Buffer.concat(chunks).toString("utf8");
			let body: unknown = raw;
			if (raw !== "") {
				try {
					body = JSON.parse(raw);
				} catch {
					// keep the raw text
				}
			}
			requests.push({ method: req.method ?? "", path, body });
			if (req.method === "GET" && path === "/api/tags") {
				const models = options.models.map((name) => ({ name, model: name, modified_at: "2026-10-26T00:00:00Z", size: 1, digest: "0", details: {} }));
				res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models }));
			} else if (req.method === "POST" && path === "/v1/chat/completions") {
				const model = (body as { model?: string } | null)?.model ?? "unknown";
				const reply = typeof options.reply === "function" ? options.reply(body) : options.reply;
				streamReply(res, model, reply ?? { text: "" });
			} else {
				res.writeHead(404, { "content-type": "text/plain" }).end("404 page not found");
			}
		});
	});
	await listen(server);
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/** The URL of a port nothing listens on: listened on, then closed. */
export async function closedPortUrl(): Promise<string> {
	const server = createServer();
	await listen(server);
	const { port } = server.address() as AddressInfo;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return `http://127.0.0.1:${port}`;
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
}

/** The OpenAI chat-completion chunk stream pi-ai's `openai-completions` client parses. */
function streamReply(res: ServerResponse, model: string, reply: FakeOllamaReply): void {
	const base = { id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model, system_fingerprint: "fp_ollama" };
	const chunk = (delta: object, finish_reason: string | null = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason }] });
	const events: object[] = [chunk({ role: "assistant", content: "" })];
	if ("text" in reply) {
		events.push(chunk({ content: reply.text }), chunk({}, "stop"));
	} else {
		const call = { index: 0, id: "call_fake", type: "function", function: { name: reply.toolCall.name ?? "submit_result", arguments: JSON.stringify(reply.toolCall.arguments) } };
		events.push(chunk({ tool_calls: [call] }), chunk({}, "tool_calls"));
	}
	events.push({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
	for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
	res.end("data: [DONE]\n\n");
}
