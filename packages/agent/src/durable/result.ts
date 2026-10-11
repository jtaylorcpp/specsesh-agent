/**
 * Check a submitted result against the step's schema, before it is recorded.
 *
 * The interpreter's schemas are deliberately small: an object of named fields,
 * each a string, number or boolean, all required. This checks exactly that, and
 * says what is wrong in words the model can act on when it calls again.
 */

type JsonType = "string" | "number" | "boolean";

export function checkResult(schema: Record<string, unknown> | null, value: unknown): string | undefined {
	if (schema === null) return "This step takes no structured result; answer in text instead.";
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return "The result must be an object.";
	}
	const properties = (schema.properties ?? {}) as Record<string, { type?: JsonType }>;
	const required = (schema.required ?? Object.keys(properties)) as string[];
	const record = value as Record<string, unknown>;

	const problems: string[] = [];
	for (const field of required) {
		if (!(field in record)) problems.push(`missing "${field}"`);
	}
	for (const [field, spec] of Object.entries(properties)) {
		if (!(field in record) || spec.type === undefined) continue;
		const actual = typeof record[field];
		if (actual !== spec.type) problems.push(`"${field}" must be a ${spec.type}, got ${actual}`);
	}
	return problems.length === 0 ? undefined : `The result was not recorded: ${problems.join("; ")}. Call again.`;
}
