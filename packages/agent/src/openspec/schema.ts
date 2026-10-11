/**
 * The one way a value is checked against an ontology schema.
 *
 * Every type in this entry is declared once, as a zod schema, and its static
 * type is `z.infer` of it. A few rules compare two fields of one value (a task
 * id against its group's number, a rename's `from` against its `to`); they are
 * refinements on the schema itself, so `schema.safeParse` alone enforces them.
 * `toJSONSchema` cannot say those, so a consumer with only the serialised JSON
 * Schema gets every structural rule and none of the refinements.
 */

import { z } from "zod";

/** A closed object: a property the type does not name is refused, as at a boundary it must be. */
export const closed = <S extends z.ZodRawShape>(shape: S) => z.strictObject(shape);

/** A union of string literals, one per value, in order. */
export const literals = <const T extends readonly [string, ...string[]]>(...values: T) => z.enum(values);

/** A string with at least one character. */
export const Name = () => z.string().min(1);

/** True when `value` satisfies `schema`, refinements included. */
export function check(schema: z.ZodType, value: unknown): boolean {
	return schema.safeParse(value).success;
}

/** Why `value` fails `schema`, one line per issue; empty when it passes. */
export function explain(schema: z.ZodType, value: unknown): string[] {
	const result = schema.safeParse(value);
	if (result.success) return [];
	return result.error.issues.map((issue) => `${issue.path.length > 0 ? `/${issue.path.join("/")}` : "/"}: ${issue.message}`);
}

/**
 * The JSON Schema of `schema`, as a consumer's input. Refinements cannot be
 * stated in JSON Schema; they are left out rather than throwing, so the JSON
 * Schema is the wider contract.
 */
export function toJSONSchema(schema: z.ZodType) {
	return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

/** Structural equality over JSON values, for comparing references and targets. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every((key) => key in right && sameValue(left[key], right[key]));
}
