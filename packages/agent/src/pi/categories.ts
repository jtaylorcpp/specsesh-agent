/**
 * An HTTP status, when pi carried one, mapped to the port's category vocabulary.
 *
 * Only the status is read. pi does not classify failures itself, and the port's
 * rule is that a category comes from a structured fact, never from the wording
 * of a message. No status means no category, which the port reports as
 * `unknown` rather than a guess.
 */
export function categoryFromStatus(code: string | number | undefined): string | undefined {
	const status = typeof code === "number" ? code : Number.parseInt(code ?? "", 10);
	if (!Number.isInteger(status)) return undefined;
	if (status === 401 || status === 403) return "authentication_failed";
	if (status === 402) return "billing_error";
	if (status === 404) return "model_not_found";
	if (status === 429) return "rate_limit";
	if (status === 529 || status === 503) return "overloaded";
	if (status === 400 || status === 413 || status === 422) return "invalid_request";
	if (status >= 500 && status <= 599) return "server_error";
	return undefined;
}

/**
 * The HTTP status in Google's error envelope, for `google-generative-ai` and
 * `google-vertex` errors, whose adapters take no recording `fetch`.
 *
 * This is not reading message text: `@google/genai` throws with the
 * `JSON.stringify` of the response body as its message, and pi passes it on
 * unchanged. The whole string must parse as `{ error: { code } }` with an
 * integer `code`, Google's own HTTP status field. No substring, regex or
 * keyword; anything else (a mid-stream `got status: …` included) is `undefined`.
 */
export function googleStatus(message: string | undefined): number | undefined {
	if (message === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(message);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
	const error = (parsed as { error?: unknown }).error;
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}
