import { createProvider, type Model, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export const OLLAMA_PROVIDER_ID = "ollama";
const DEFAULT_BASE_URL = "http://localhost:11434";

export interface OllamaOptions {
	/** The server's URL. Default: `OLLAMA_HOST`, else `http://localhost:11434`. */
	baseUrl?: string;
	/** Model ids available before any refresh. */
	models?: string[];
}

export type RegisterOllamaResult = { ok: true; baseUrl: string; models: number } | { ok: false; baseUrl: string; reason: string };

/** The server URL: the option, else `OLLAMA_HOST`, else localhost; `http://` added when there is no scheme, trailing `/` removed. */
export function ollamaBaseUrl(options: OllamaOptions = {}): string {
	let url = (options.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_BASE_URL).trim();
	if (url === "") url = DEFAULT_BASE_URL;
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
	return url.replace(/\/+$/, "");
}

/** A chat model for any id the server may hold, on the OpenAI-compatible API at `<baseUrl>/v1`. */
export function ollamaModel(id: string, options: OllamaOptions = {}): Model<"openai-completions"> {
	return {
		id,
		name: `${id} (Ollama)`,
		provider: OLLAMA_PROVIDER_ID,
		api: "openai-completions",
		baseUrl: `${ollamaBaseUrl(options)}/v1`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 8192,
		compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
	};
}

/** `GET <baseUrl>/api/tags`, one model per pulled name in the server's order. */
async function fetchPulled(options: OllamaOptions, signal: AbortSignal): Promise<Model<"openai-completions">[]> {
	const response = await fetch(`${ollamaBaseUrl(options)}/api/tags`, { signal });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		throw new Error(`malformed /api/tags body: ${err instanceof Error ? err.message : String(err)}`);
	}
	const list = (body as { models?: unknown } | null)?.models;
	if (!Array.isArray(list)) throw new Error("malformed /api/tags body: no models array");
	return list.flatMap((entry) => {
		const name = (entry as { name?: unknown } | null)?.name;
		return typeof name === "string" && name !== "" ? [ollamaModel(name, options)] : [];
	});
}

/** A keyless pi-ai provider for a local Ollama server, its catalog the server's pulled models. */
export function ollamaProvider(options: OllamaOptions = {}): Provider<"openai-completions"> {
	return createProvider({
		id: OLLAMA_PROVIDER_ID,
		name: "Ollama (local)",
		baseUrl: `${ollamaBaseUrl(options)}/v1`,
		// Ollama ignores the bearer token; the placeholder only satisfies the OpenAI-compatible client.
		auth: { apiKey: { name: "Ollama (keyless)", resolve: async () => ({ auth: { apiKey: "ollama" }, source: "keyless" }) } },
		models: (options.models ?? []).map((id) => ollamaModel(id, options)),
		fetchModels: (context) => fetchPulled(options, context.signal),
		api: openAICompletionsApi(),
	});
}

/** Set the provider on `models` and refresh it from the server. Never rejects. */
export async function registerOllama(models: MutableModels, options: OllamaOptions = {}): Promise<RegisterOllamaResult> {
	const baseUrl = ollamaBaseUrl(options);
	try {
		models.setProvider(ollamaProvider(options));
		const { errors } = await models.refresh({ providers: [OLLAMA_PROVIDER_ID], allowNetwork: true, force: true });
		const error = errors.get(OLLAMA_PROVIDER_ID);
		if (error !== undefined) return { ok: false, baseUrl, reason: reasonOf(error) };
		return { ok: true, baseUrl, models: models.getModels(OLLAMA_PROVIDER_ID).length };
	} catch (err) {
		return { ok: false, baseUrl, reason: reasonOf(err) };
	}
}

function reasonOf(err: unknown): string {
	const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
	const message = err instanceof Error ? `${err.message}${cause}` : String(err);
	return message.trim() === "" ? "unknown error" : message;
}
