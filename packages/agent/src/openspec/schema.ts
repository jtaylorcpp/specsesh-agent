/**
 * The one way a value is checked against an ontology schema.
 *
 * Every type in this entry is declared once, as a TypeBox schema, and its static
 * type is derived from it. The schema is plain JSON Schema wherever JSON Schema
 * can say the rule. A few rules compare two fields of one value (a task id
 * against its group's number, a rename's `from` against its `to`); JSON Schema
 * has no way to say those, so they are TypeBox refinements. `check` runs both.
 * A consumer with only the serialised JSON Schema gets every structural rule
 * and none of the refinements.
 */

import Type, { type TLiteral, type TObject, type TProperties, type TSchema, type TUnion } from "typebox";
import Value from "typebox/value";

/** A closed object: a property the type does not name is refused, as at a boundary it must be. */
export const closed = <P extends TProperties>(properties: P): TObject<P> =>
	Type.Object(properties, { additionalProperties: false });

/** A union of string literals, one per value, in order. */
export const literals = <const T extends readonly string[]>(...values: T) =>
	Type.Union(values.map((value) => Type.Literal(value))) as unknown as TUnion<{ -readonly [K in keyof T]: TLiteral<T[K]> }>;

/** A string with at least one character. */
export const Name = () => Type.String({ minLength: 1 });

/** True when `value` satisfies `schema`, refinements included. */
export function check(schema: TSchema, value: unknown): boolean {
	return Value.Check(schema, value);
}

/** Why `value` fails `schema`, one line per error; empty when it passes. */
export function explain(schema: TSchema, value: unknown): string[] {
	return Value.Errors(schema, value).map((error) => `${error.instancePath || "/"}: ${error.message}`);
}

/** Structural equality over JSON values, for comparing references and targets. */
export function sameValue(a: unknown, b: unknown): boolean {
	return Value.Equal(a, b);
}
