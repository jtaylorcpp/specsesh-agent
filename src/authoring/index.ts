/**
 * Agent Script as an AUTHORING format.
 *
 * Parse, analyse and lint a document; never compile one. Agent Script's
 * compiler targets a Salesforce-internal specification format that executes
 * only on Salesforce infrastructure, so a compile from here would produce a
 * build that can never be run.
 *
 * That boundary is enforced by what this package depends on, not only by what
 * it calls. The dependencies are `@sf-agentscript/language` (analysis engine,
 * lint passes), `@sf-agentscript/parser-javascript` (error-tolerant parser) and
 * `@sf-agentscript/agentscript-dialect` (the base schema). The compiler ships in
 * `@sf-agentscript/agentforce`, which is NOT a dependency of this package and
 * does not appear anywhere in its transitive tree — so `compileSource()` is not
 * merely uncalled, it is unreachable.
 */

export { Document, analyze, parse } from "./document.js";
export type { Analysis } from "./document.js";
/**
 * The subset now lives beside the interpreter, which is what it is a statement
 * ABOUT — authoring accepts the whole language and only execution has a
 * boundary. Re-exported here so a consumer that imported it from the authoring
 * entry keeps working, and so there is still exactly one declaration.
 */
export { SUPPORTED_CONSTRUCTS } from "../interpreter/subset.js";
export type { SupportedConstruct } from "../interpreter/subset.js";
