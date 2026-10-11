/**
 * The OpenSpec ontology: the taxonomy of a change (`openspec/model`), its
 * lifecycle as typed steps (`openspec/process`), executing it as three nested
 * feedback loops (`openspec/loops`), and what a verdict may rest on
 * (`openspec/evidence`).
 *
 * Every type is one zod schema exported under the type's own name, with the
 * static type `z.infer` of it, so a value can be checked wherever it crosses a
 * boundary: `check(Clause, value)`, and exported as JSON Schema with
 * `toJSONSchema(Clause)`. This entry imports `zod` and nothing else: no model
 * client, no Node I/O, no peer. It reads no files and runs no loop; the
 * functions are pure rules over typed values.
 */

export * from "./evidence.js";
export * from "./loops.js";
export * from "./model.js";
export * from "./process.js";
export { check, explain, toJSONSchema } from "./schema.js";
