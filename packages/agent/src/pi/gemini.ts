import type { MutableModels, Provider } from "@earendil-works/pi-ai";

/** pi-ai's built-in provider id for the Gemini API. */
export const GEMINI_PROVIDER = "google";
/** pi-ai's base URL for the `google` provider's models. */
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Environment variables, as `process.env` holds them. */
export type GeminiEnv = Record<string, string | undefined>;

export interface GeminiOptions {
	/** The API's URL. Default: `GEMINI_BASE_URL`, else `GEMINI_DEFAULT_BASE_URL`. */
	baseUrl?: string;
	/** Where `GEMINI_BASE_URL` and `GEMINI_API_KEY` are read. Default: `process.env`. */
	env?: GeminiEnv;
}

export type RegisterGeminiResult = { ok: true; baseUrl: string; models: number } | { ok: false; baseUrl: string; reason: string };

/** The API URL: the option, else `GEMINI_BASE_URL`, else Google's endpoint; empty counts as unset, trailing `/` removed. */
export function geminiBaseUrl(options: GeminiOptions = {}): string {
	const env = options.env ?? process.env;
	const url = [options.baseUrl, env.GEMINI_BASE_URL].map((value) => value?.trim()).find((value) => value !== undefined && value !== "");
	return (url ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** `undefined` when `GEMINI_API_KEY` is set, else why a run on `google` can't start. */
export function geminiKeyIssue(env: GeminiEnv = process.env): string | undefined {
	return env.GEMINI_API_KEY !== undefined && env.GEMINI_API_KEY.trim() !== "" ? undefined : "GEMINI_API_KEY is not set";
}

/** The same provider, every model's `baseUrl` replaced. */
function repointed(provider: Provider, baseUrl: string): Provider {
	const getAllModels = provider.getAllModels;
	return {
		...provider,
		baseUrl,
		getModels: () => provider.getModels().map((model) => ({ ...model, baseUrl })),
		...(getAllModels === undefined ? {} : { getAllModels: () => getAllModels.call(provider).map((model) => ({ ...model, baseUrl })) }),
	};
}

/** Point `google` at the base URL when it isn't the default, then check the key. No request; never rejects. */
export async function registerGemini(models: MutableModels, options: GeminiOptions = {}): Promise<RegisterGeminiResult> {
	const baseUrl = geminiBaseUrl(options);
	try {
		if (baseUrl !== GEMINI_DEFAULT_BASE_URL) {
			const provider = models.getProvider(GEMINI_PROVIDER);
			if (provider === undefined) return { ok: false, baseUrl, reason: `no ${GEMINI_PROVIDER} provider in the collection` };
			models.setProvider(repointed(provider, baseUrl));
		}
		const reason = geminiKeyIssue(options.env ?? process.env);
		if (reason !== undefined) return { ok: false, baseUrl, reason };
		return { ok: true, baseUrl, models: models.getModels(GEMINI_PROVIDER).length };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, baseUrl, reason: message.trim() === "" ? "unknown error" : message };
	}
}
