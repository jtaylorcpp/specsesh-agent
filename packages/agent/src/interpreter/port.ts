/**
 * The reasoning port.
 *
 * One reasoning step goes out through this and nothing else. The package
 * declares the shape; the composing application injects an implementation.
 * `@specsesh/agent` is published and the harness it would otherwise call is
 * a private workspace package, so importing that harness here is not an option —
 * and taking the port as an argument is what keeps this package independently
 * buildable and reusable, which is why it is a package at all.
 *
 * DESCENDED FROM `packages/specsketch/src/workbench/agent/model-boundary.ts`,
 * which this change retires — deliberately, because that interface was already
 * this shape written in the codebase's own idiom, and its `cut-short` outcome is
 * a lesson worth carrying rather than rediscovering.
 *
 * WHAT IS DELIBERATELY ABSENT: a tool set, an executor that runs a tool, and a
 * bound on tool-call rounds. A contract holding those three IS a model boundary,
 * whatever it is called and however it is fed. `specsketch-workbench-agent`'s
 * `A Turn Is A Real Model Turn Through One Boundary` requires the boundary to own
 * the loop and to be one module; putting a second loop here would give the
 * product two, which is the shape this change exists to remove.
 */

/**
 * Why a step failed, when the model layer named a reason.
 *
 * The named categories are the ten the Claude Agent SDK's own
 * `SDKAssistantMessageError` union carries, because that union is what the only
 * in-repo implementation of this port reports. Naming four of them and letting
 * the other five arrive as `unrecognised` reopened one layer up the exact gap
 * the categories exist to close: a retryable `server_error` and a permanent
 * `invalid_request` reached a port consumer indistinguishable from each other.
 *
 * A port backed by some other layer still gets `unrecognised`, message intact.
 * The list is not a claim that every layer speaks this vocabulary — it is a
 * claim about which strings this runtime can name when it hears them.
 */
export type FailureCategory =
	| "authentication_failed"
	| "oauth_org_not_allowed"
	| "billing_error"
	| "rate_limit"
	| "overloaded"
	| "invalid_request"
	| "model_not_found"
	| "server_error"
	| "max_output_tokens"
	/**
	 * The layer said, in its own words, "unknown".
	 *
	 * Spelled apart from `unknown` below because the two are OPPOSITE facts and
	 * the SDK spells them with the same word: this one is a positive report that
	 * the layer could not classify a failure it definitely saw. Mapping it onto
	 * `unknown` would say nobody reported anything; mapping it onto
	 * `unrecognised` would say we do not know what the layer meant, when we do.
	 */
	| "layer_unknown"
	/** The layer named a category this set does not know. The original is carried. */
	| "unrecognised"
	/** The layer named no category at all. NEVER defaulted to a named one. */
	| "unknown";

/**
 * How a step ended. A discriminated union, so a caller distinguishes the cases
 * without reading message text — prose is not a protocol.
 */
export type StepOutcome =
	| {
			readonly kind: "answered";
			readonly text: string;
			/** Present only when the step requested one. */
			readonly structured?: unknown;
	  }
	/**
	 * The implementation stopped at its own bound. Named separately because a
	 * partial answer presented as a finished one is the failure this codebase
	 * keeps finding in other guises.
	 */
	| {
			readonly kind: "cut-short";
			readonly text: string;
			/** The implementation's own count, carried through unchanged. */
			readonly turns: number;
	  }
	| {
			readonly kind: "failed";
			readonly category: FailureCategory;
			/** What the layer said, kept verbatim even when the category is known. */
			readonly message: string;
	  };

/** One reasoning step, as handed to the port. */
export interface ReasoningRequest {
	/**
	 * The document's standing instructions, as their OWN channel.
	 *
	 * Not concatenated into the prompt: the system block is the agent's standing
	 * character and the prompt is this step's request, and a boundary that fuses
	 * them can never treat them differently again. The workbench does this by
	 * hand today (`${system}\n\n${prompt}`) while the SDK has had a systemPrompt
	 * option all along.
	 */
	readonly systemInstructions: string;
	/** The composed prompt for this step, in the document's source order. */
	readonly prompt: string;
	/**
	 * A schema for a structured result, when this step writes variables.
	 * Absent for a step that only produces text.
	 */
	readonly outputSchema?: Record<string, unknown>;
}

/**
 * The injected boundary. One method, because one reasoning step is the whole
 * contract — anything more and this becomes the thing it is avoiding.
 */
export interface ReasoningPort {
	reason(request: ReasoningRequest): Promise<StepOutcome>;
}

/** Raised when a run is attempted with no port. Never silently defaulted. */
export class NoReasoningPortError extends Error {
	constructor() {
		super(
			"no reasoning port was provided: @specsesh/agent declares the port and the " +
				"composing application injects it. This package constructs no default, because a " +
				"default would mean importing a model client it deliberately does not depend on.",
		);
		this.name = "NoReasoningPortError";
	}
}

/**
 * The categories a model layer may report, mapped to ours.
 *
 * Every entry is an IDENTITY except `unknown`, which is renamed rather than
 * mapped — see `layer_unknown`. Nothing here guesses: a string absent from this
 * table becomes `unrecognised`, never the nearest neighbour.
 */
const KNOWN: Readonly<Record<string, FailureCategory>> = {
	authentication_failed: "authentication_failed",
	oauth_org_not_allowed: "oauth_org_not_allowed",
	billing_error: "billing_error",
	rate_limit: "rate_limit",
	overloaded: "overloaded",
	invalid_request: "invalid_request",
	model_not_found: "model_not_found",
	server_error: "server_error",
	max_output_tokens: "max_output_tokens",
	unknown: "layer_unknown",
};

/** Every value of `FailureCategory`, including the three that are ours rather than a layer's. */
const OWN_CATEGORIES: ReadonlySet<string> = new Set<FailureCategory>([
	...Object.values(KNOWN),
	"unrecognised",
	"unknown",
]);

/**
 * Whether a string is already one of OUR categories, as a port is typed to report.
 *
 * `run()` keeps such a value as-is. Re-normalising it would turn a port's honest
 * `unknown` (nobody named a category) into `layer_unknown` (the layer said
 * "unknown"), which is the opposite fact.
 */
export function isFailureCategory(value: string): value is FailureCategory {
	return OWN_CATEGORIES.has(value);
}

/** Every category string this runtime can name, for a caller that needs the set. */
export const KNOWN_FAILURE_CATEGORIES: readonly string[] = Object.keys(KNOWN);

/**
 * Normalise whatever the implementation reported into our set.
 *
 * A category we do not know becomes `unrecognised` and keeps its message; no
 * category at all becomes `unknown`. Neither is folded into a named one —
 * guessing "probably a rate limit" is how a billing failure gets retried
 * forever.
 */
export function toFailureCategory(reported: string | undefined | null): FailureCategory {
	if (reported === undefined || reported === null || reported === "") return "unknown";
	return KNOWN[reported] ?? "unrecognised";
}
