/**
 * The bins' model collection: pi-ai's built-ins plus `claude-code`, and `ollama` only when a
 * command needs a model on it (`design.md` of add-ollama-durable, decisions 1 and 3). `google`'s
 * base URL and key are settled the same way (`design.md` of add-gemini-provider, decision 5).
 */

import type { Models, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ModelRef } from "@earendil-works/pi-durable";
import { lazyMcpBridge } from "./mcp.js";
import { GEMINI_PROVIDER, registerGemini, type GeminiEnv, type RegisterGeminiResult } from "../pi/gemini.js";
import { OLLAMA_PROVIDER_ID, registerOllama, type RegisterOllamaResult } from "../pi/ollama.js";

/** What a command passes to `cliModels`. */
export interface CliModelOptions {
	/** `claude-code`'s `maxTurns` for a step offering tools; unset: its default. */
	readonly maxTurns?: number;
	/** `claude-code`'s `timeoutMs`, its time limit on one turn (not counting the host's tools); unset: its default. */
	readonly turnTimeoutMs?: number;
}

/** pi-ai's built-in providers plus `claude-code`. No network call. */
export async function cliModels(options: CliModelOptions = {}): Promise<MutableModels> {
	const { claudeCodeProvider } = await import("../claude-code/index.js");
	const models = builtinModels();
	models.setProvider(
		claudeCodeProvider({
			bridge: lazyMcpBridge(),
			...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
			...(options.turnTimeoutMs !== undefined ? { timeoutMs: options.turnTimeoutMs } : {}),
		}),
	);
	return models;
}

/** `cliModels`' options for the turn limits given, leaving out the unset ones. */
export const turnOptions = (limits: { readonly maxTurns?: number | undefined; readonly turnTimeoutMs?: number | undefined }): CliModelOptions => ({
	...(limits.maxTurns !== undefined ? { maxTurns: limits.maxTurns } : {}),
	...(limits.turnTimeoutMs !== undefined ? { turnTimeoutMs: limits.turnTimeoutMs } : {}),
});

/** What a resume hint repeats of the turn limits given on the command line: ` --max-turns <n> --turn-timeout <ms>`, either, or `""`. */
export const turnFlags = (limits: { readonly maxTurns?: number | string | undefined; readonly turnTimeoutMs?: number | string | undefined }): string =>
	`${limits.maxTurns !== undefined ? ` --max-turns ${limits.maxTurns}` : ""}${limits.turnTimeoutMs !== undefined ? ` --turn-timeout ${limits.turnTimeoutMs}` : ""}`;

/**
 * Registers and refreshes `ollama` on `models` when any ref is on it, and answers what
 * `registerOllama` did; otherwise touches nothing and answers `undefined`. Never rejects.
 */
export async function withOllama(models: Models, refs: readonly ModelRef[]): Promise<RegisterOllamaResult | undefined> {
	if (!refs.some((ref) => ref.provider === OLLAMA_PROVIDER_ID)) return undefined;
	if (!isMutable(models)) {
		return { ok: false, baseUrl: "", reason: "the model collection cannot take a provider" };
	}
	return registerOllama(models);
}

/**
 * Points `google` at `GEMINI_BASE_URL` and checks `GEMINI_API_KEY` when any ref is on it, and
 * answers what `registerGemini` did; otherwise touches nothing and answers `undefined`. Never rejects.
 */
export async function withGemini(
	models: Models,
	refs: readonly ModelRef[],
	env: GeminiEnv = process.env,
): Promise<RegisterGeminiResult | undefined> {
	if (!refs.some((ref) => ref.provider === GEMINI_PROVIDER)) return undefined;
	if (!isMutable(models)) {
		return { ok: false, baseUrl: "", reason: "the model collection cannot take a provider" };
	}
	return registerGemini(models, { env });
}

/** `google: <reason>` when `registerGemini` refused, else `undefined`. */
export function geminiRefusal(result: RegisterGeminiResult | undefined): string | undefined {
	return result === undefined || result.ok ? undefined : `${GEMINI_PROVIDER}: ${result.reason}`;
}

/** ` (Ollama at <url>: <reason>)` when `provider` is `ollama` and the server didn't answer, else `""`. */
export function ollamaSuffix(result: RegisterOllamaResult | undefined, provider: string): string {
	if (provider !== OLLAMA_PROVIDER_ID || result === undefined || result.ok) return "";
	return ` (Ollama at ${result.baseUrl}: ${result.reason})`;
}

function isMutable(models: Models): models is MutableModels {
	return typeof (models as Partial<MutableModels>).setProvider === "function";
}
