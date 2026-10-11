import type { Api, Model, Models } from "@earendil-works/pi-ai";

/** The testing default: Claude Haiku on Anthropic. Override per run or with env. */
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-4-5";

export class UnknownModelError extends Error {
	constructor(provider: string, id: string, known: readonly string[]) {
		const hint = known.length > 0 ? ` Known ${provider} models include: ${known.slice(0, 12).join(", ")}.` : ` "${provider}" is not a registered provider.`;
		super(`no model "${id}" on provider "${provider}".${hint}`);
		this.name = "UnknownModelError";
	}
}

/** Look a model up in the collection, failing by name instead of returning undefined. */
export function resolveModel(models: Models, provider: string, id: string): Model<Api> {
	const model = models.getModel(provider, id);
	if (model !== undefined) return model;
	throw new UnknownModelError(
		provider,
		id,
		models.getModels(provider).map((m) => m.id),
	);
}
