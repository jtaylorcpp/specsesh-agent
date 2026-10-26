/**
 * The bins' model collection: pi-ai's built-ins plus `claude-code`, and `ollama` only when a
 * command needs a model on it (`design.md` of add-ollama-durable, decisions 1 and 3).
 */

import type { Models, MutableModels } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import { OLLAMA_PROVIDER_ID, registerOllama, type RegisterOllamaResult } from "../pi/ollama.js";

/** pi-ai's built-in providers plus `claude-code`. No network call. */
export async function cliModels(): Promise<MutableModels> {
	const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
	const { claudeCodeProvider } = await import("../claude-code/index.js");
	const models = builtinModels();
	models.setProvider(claudeCodeProvider());
	return models;
}

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

/** ` (Ollama at <url>: <reason>)` when `provider` is `ollama` and the server didn't answer, else `""`. */
export function ollamaSuffix(result: RegisterOllamaResult | undefined, provider: string): string {
	if (provider !== OLLAMA_PROVIDER_ID || result === undefined || result.ok) return "";
	return ` (Ollama at ${result.baseUrl}: ${result.reason})`;
}

function isMutable(models: Models): models is MutableModels {
	return typeof (models as Partial<MutableModels>).setProvider === "function";
}
