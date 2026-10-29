import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** One SSE chunk of a reply: text, or a function call. */
export type FakeGeminiChunk = { text: string } | { functionCall: { name: string; args: object } };

/** One reply: its chunks, each written as its own `data:` event, or an HTTP error with a JSON body. */
export type FakeGeminiReply = FakeGeminiChunk[] | FakeGeminiError;

export interface FakeGeminiError {
	error: { status: number; body: unknown };
}

export interface FakeGeminiRequest {
	path: string;
	model: string;
	/** The `x-goog-api-key` header, as the SDK sent it. */
	apiKey: string | undefined;
	body: unknown;
}

export interface FakeGemini {
	/** The base URL to give the `google` models: the server's origin plus `/v1beta`. */
	url: string;
	requests: FakeGeminiRequest[];
	/** Queue replies, answered first in, first out, one per request. */
	reply(...replies: FakeGeminiReply[]): void;
	close(): Promise<void>;
}

export const textReply = (...chunks: string[]): FakeGeminiReply => chunks.map((text) => ({ text }));

export const callReply = (name: string, args: object): FakeGeminiReply => [{ functionCall: { name, args } }];

const GOOGLE_STATUS: Record<number, string> = { 400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND", 429: "RESOURCE_EXHAUSTED", 500: "INTERNAL", 503: "UNAVAILABLE" };

/** An HTTP error reply; the body defaults to Google's `{ error: { code, message, status } }`. */
export const errorReply = (status: number, body?: unknown): FakeGeminiReply => ({
	error: { status, body: body ?? { error: { code: status, message: "nope", status: GOOGLE_STATUS[status] ?? "UNKNOWN" } } },
});

const STREAM_PATH = /^(?:\/v1beta)?\/models\/([^/:]+):streamGenerateContent$/;

/**
 * A local stand-in for the Gemini API: `POST [/v1beta]/models/<id>:streamGenerateContent` (any query,
 * `alt=sse` from the SDK) answers the next queued reply as SSE `GenerateContentResponse` chunks, or,
 * for an `errorReply`, as that HTTP status and JSON body. An
 * empty queue answers 500, so a test that sends one request too many fails loudly.
 */
export async function startFakeGemini(): Promise<FakeGemini> {
	const requests: FakeGeminiRequest[] = [];
	const queue: FakeGeminiReply[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const path = (req.url ?? "/").split("?")[0]!;
			const match = req.method === "POST" ? STREAM_PATH.exec(path) : null;
			if (match === null) {
				res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 404, message: `no route ${req.method} ${path}`, status: "NOT_FOUND" } }));
				return;
			}
			const raw = Buffer.concat(chunks).toString("utf8");
			let body: unknown = raw;
			try {
				body = JSON.parse(raw);
			} catch {
				// keep the raw text
			}
			const apiKey = req.headers["x-goog-api-key"];
			requests.push({ path, model: match[1]!, apiKey: Array.isArray(apiKey) ? apiKey[0] : apiKey, body });
			const reply = queue.shift();
			if (reply === undefined) {
				res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 500, message: "fake-gemini: no reply queued", status: "INTERNAL" } }));
				return;
			}
			if (!Array.isArray(reply)) {
				res.writeHead(reply.error.status, { "content-type": "application/json" }).end(JSON.stringify(reply.error.body));
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			reply.forEach((chunk, index) => {
				const last = index === reply.length - 1;
				const candidate = { content: { role: "model", parts: [chunk] }, index: 0, ...(last ? { finishReason: "STOP" } : {}) };
				const response = {
					candidates: [candidate],
					...(last ? { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } } : {}),
					modelVersion: match[1],
				};
				res.write(`data: ${JSON.stringify(response)}\r\n\r\n`);
			});
			res.end();
		});
	});
	await listen(server);
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/v1beta`,
		requests,
		reply: (...replies) => {
			queue.push(...replies);
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
}
