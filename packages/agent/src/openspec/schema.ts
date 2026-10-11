/**
 * The one way a value is checked against an ontology schema.
 *
 * Every type in this entry is declared once, as a TypeBox schema, and its static
 * type is `Static` of it. The schema is plain JSON Schema wherever JSON Schema
 * can say the rule. A few rules compare two fields of one value (a task id
 * against its group's number, a rename's `from` against its `to`); JSON Schema
 * has no way to say those, so they are TypeBox refinements on the schema itself,
 * and `Value.Check` alone enforces them. A consumer with only the serialised
 * JSON Schema gets every structural rule and none of the refinements.
 */

import Type, { type TLiteral, type TObject, type TProperties, type TSchema, type TUnion } from "typebox";
import Value from "typebox/value";

/** A closed object: a property the type does not name is refused, as at a boundary it must be. */
export const closed = <P extends TProperties>(properties: P): TObject<P> =>
	Type.Object(properties, { additionalProperties: false });

/** A union of string literals, one per value, in order. */
export const literals = <const T extends readonly [string, ...string[]]>(...values: T) =>
	Type.Union(values.map((value) => Type.Literal(value))) as unknown as TUnion<{ -readonly [K in keyof T]: TLiteral<T[K]> }>;

/** A string with at least one character. */
export const Name = () => Type.String({ minLength: 1 });

/** An integer within the safe range, so it round-trips through JSON and a JavaScript number exactly. */
export const Int = (bounds: { minimum?: number } = {}) =>
	Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, ...bounds });

/** True when `value` satisfies `schema`, refinements included. */
export function check(schema: TSchema, value: unknown): boolean {
	return Value.Check(schema, value);
}

/** Why `value` fails `schema`, one line per error; empty when it passes. */
export function explain(schema: TSchema, value: unknown): string[] {
	return Value.Errors(schema, value).map((error) => `${error.instancePath || "/"}: ${error.message}`);
}

/**
 * The JSON Schema of `schema`, as plain JSON a consumer can serialise, store or
 * hand to a model. A TypeBox schema already is one; its refinements (and
 * TypeBox's own bookkeeping) are non-enumerable properties, so they are left out
 * and the JSON Schema is the wider contract.
 */
export function toJSONSchema(schema: TSchema): Record<string, unknown> {
	return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
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
