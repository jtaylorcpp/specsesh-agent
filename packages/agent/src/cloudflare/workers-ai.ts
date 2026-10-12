/**
 * Workers AI as a model for `AgentConfig.models`: the `AI` binding and a model ID,
 * built with `createAI({ binding })` exactly as `AgentScriptHost.createModel()` does.
 *
 * No `cloudflare:workers` import, so plain Node can load it.
 */

import { createAI } from "agents/models/pi-ai";
import type { ModelFactory } from "../durable/index.js";

/**
 * The provider and model for one Workers AI model, as a `ModelFactory` returns them.
 * Each call builds a fresh provider; building one never calls the binding.
 *
 *   models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") }
 */
export function workersAI(binding: Ai, modelId: string): ReturnType<ModelFactory<unknown>> {
	const ai = createAI({ binding });
	const model = ai(modelId);
	return { provider: ai.provider, model: { provider: model.provider, modelId: model.id } };
}
