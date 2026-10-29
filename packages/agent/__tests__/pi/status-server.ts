import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface StatusServer {
	/** `http://127.0.0.1:<port>`, with no path. */
	origin: string;
	/** Requests answered so far. */
	readonly requests: number;
	close(): Promise<void>;
}

/**
 * A local server that answers every request, any method or path, with `status` and the JSON body
 * `{ error: { code: status, message: "nope" } }`. The request body is read first, so a client never
 * sees a reset.
 */
export async function startStatusServer(status: number): Promise<StatusServer> {
	let requests = 0;
	const body = JSON.stringify({ error: { code: status, message: "nope" } });
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			requests += 1;
			res.writeHead(status, { "content-type": "application/json" }).end(body);
		});
	});
	await listen(server);
	const { port } = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${port}`,
		get requests() {
			return requests;
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			}),
	};
}

function listen(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
}
