/**
 * An Agent Script document, as an authoring artifact.
 *
 * The TEXT is the document. Everything else — the parsed tree, the diagnostics —
 * is derived from it and recomputed on edit. That ordering is deliberate: a
 * surface that treats a parsed model as the document has to serialise back out,
 * and a serialiser normalises what it did not author.
 */

import { parse as parseSource } from "@sf-agentscript/parser-javascript";
import { Dialect } from "@sf-agentscript/language";
import type { AstRoot, Diagnostic } from "@sf-agentscript/language";
import { LintEngine } from "@sf-agentscript/language/lint";
import { type Node, documentRoot } from "../interpreter/ast.js";
/**
 * The AGENTFORCE dialect, not the base one — it is the dialect that has
 * `topic`/`reasoning`, which is the vocabulary this product's prompts are
 * written in and the one Salesforce's own documentation uses. The base dialect
 * rejects `topic` outright ("Unknown block: topic").
 *
 * Taking it does NOT take the compiler. `@sf-agentscript/agentforce-dialect` is
 * schema and lint rules, depending only on `language`, `types` and the base
 * dialect. `compileSource()` lives in `@sf-agentscript/agentforce`, a different
 * package, which stays out of this tree — see `__tests__/no-compiler.test.ts`.
 */
import {
	AgentforceSchema,
	agentforceSchemaContext,
	defaultRules,
} from "@sf-agentscript/agentforce-dialect";

/** A parse plus its diagnostics. Both are derived from `source`. */
export interface Analysis {
	/** The exact text this analysis was produced from. */
	readonly source: string;
	/** The parsed document, or null when the source could not be parsed at all. */
	readonly parsed: unknown;
	/** Parse and lint diagnostics together, in the order they were produced. */
	readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse and lint one document.
 *
 * Error-tolerant by construction: a half-written document yields diagnostics
 * and whatever tree could be recovered, never a thrown exception. An author
 * mid-keystroke is the normal case, not the exceptional one, and a parser that
 * throws on it takes the editor down with it.
 */
export function analyze(source: string): Analysis {
	const diagnostics: Diagnostic[] = [];
	let parsed: unknown = null;

	try {
		const { rootNode } = parseSource(source);
		const dialect = new Dialect();
		const result = dialect.parse(rootNode, AgentforceSchema);
		parsed = result;

		if (result && typeof result === "object" && "diagnostics" in result) {
			const parseDiagnostics = (result as { diagnostics?: readonly Diagnostic[] }).diagnostics;
			if (Array.isArray(parseDiagnostics)) diagnostics.push(...parseDiagnostics);
		}

		try {
			// TWO ways this silently stops linting, both of which happened here:
			//
			// 1. `defaultRules` is a FACTORY, not an array. Passing it uncalled makes
			//    LintEngine throw on every document, which the catch below then
			//    reports as a per-document lint failure.
			// 2. `dialect.parse()` returns `{ value, diagnostics }` — the AST root is
			//    `.value`. Handing LintEngine the WRAPPER gives it an object with no
			//    `variables`/`subagent` keys, so every pass no-ops and the run returns
			//    an empty array. No error, no warning, nothing to notice.
			//
			// The second was hidden by an `as never` cast, which is the only reason it
			// type-checked. Parse-stage diagnostics kept flowing from
			// `result.diagnostics`, so the package's tests stayed green while half the
			// analysis was dead. A cast that silences the compiler on a boundary like
			// this buys nothing and costs exactly this.
			const engine = new LintEngine({ passes: defaultRules(), source: "agentscript" });
			const linted = engine.run(parsedRoot(result), agentforceSchemaContext);
			diagnostics.push(...linted.diagnostics);
		} catch (err) {
			// Linting a tree the parser only partly recovered can fail on its own.
			// That is a diagnostic about the document, not a crash of the surface.
			diagnostics.push(lintFailure(err));
		}
	} catch (err) {
		diagnostics.push(parseFailure(err));
	}

	return { source, parsed, diagnostics: dedupe(diagnostics) };
}

/**
 * The AST root out of a `ParseResult`, as the type `LintEngine` asks for.
 *
 * Narrow here, once, rather than casting at the call site: the wrapper and the
 * root are both objects, so nothing downstream can tell them apart by shape —
 * handing over the wrong one produces silence, not an error.
 *
 * The return type is `AstRoot`, upstream's own, and NOT `never`. A declared
 * `never` is assignable to everything, so it is the strongest possible "stop
 * checking" instruction to the compiler — `LintEngine.run()`'s first parameter
 * was never validated against what we handed it, which is the identical
 * silencing that let the wrapper reach the engine in the first place. With a
 * real type, the next upstream shape change stops compiling here.
 *
 * `documentRoot` is the ONE unwrap predicate in this package, shared with the
 * interpreter; two definitions of the same wrapper is how they come to disagree.
 * The runtime guard is what earns the type: `AstRoot` claims `__cst` and
 * `__diagnostics`, so we check for them rather than assert them.
 */
function parsedRoot(result: unknown): AstRoot {
	const root: Node | undefined = documentRoot(result);
	if (root === undefined) {
		throw new Error(
			"dialect.parse() returned no readable root — its { value, diagnostics } wrapper held no " +
				"object. Linting a non-root silently finds no keys to walk and reports nothing.",
		);
	}
	if (!("__cst" in root) || !Array.isArray(root["__diagnostics"])) {
		throw new Error(
			"dialect.parse() returned a root missing __cst / __diagnostics, which every lint pass " +
				"reads. The upstream node shape has changed; adapt to it rather than casting past it.",
		);
	}
	return root as AstRoot;
}

/**
 * Parse and lint both report schema violations, so an unknown field arrives
 * twice. Two identical diagnostics on one range is noise that makes an author
 * hunt for a second problem that isn't there.
 */
function dedupe(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	const seen = new Set<string>();
	const out: Diagnostic[] = [];
	for (const d of diagnostics) {
		const key = JSON.stringify([
			(d as { code?: unknown }).code ?? "",
			d.message,
			(d as { range?: unknown }).range ?? "",
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(d);
	}
	return out;
}

/**
 * Parse one script into a document plus its diagnostics.
 *
 * A script that does not fully parse still returns a document — the author's
 * text is never discarded because the parser could not finish with it. Each
 * diagnostic carries its own position, so a caller can put the problem where
 * the problem is rather than at the top of the file.
 */
export function parse(source: string): { document: Document; diagnostics: readonly Diagnostic[] } {
	const document = new Document(source);
	return { document, diagnostics: document.analysis.diagnostics };
}

/**
 * A document with an edit history.
 *
 * Undo and redo move over whole-text snapshots rather than tree operations,
 * because the text is what is stored, and an undo that reconstructs text from a
 * tree can hand back bytes the author never typed.
 */
export class Document {
	#past: string[] = [];
	#future: string[] = [];
	#current: string;
	#analysis: Analysis;

	constructor(source = "") {
		this.#current = source;
		this.#analysis = analyze(source);
	}

	/** The document's text. This is the artifact; everything else is derived. */
	get source(): string {
		return this.#current;
	}

	/** The current parse and its diagnostics, recomputed on every edit. */
	get analysis(): Analysis {
		return this.#analysis;
	}

	get canUndo(): boolean {
		return this.#past.length > 0;
	}

	get canRedo(): boolean {
		return this.#future.length > 0;
	}

	/**
	 * Replace the text. A no-op edit records no history entry, so undo never
	 * spends a step returning to where it already is.
	 */
	edit(next: string): this {
		if (next === this.#current) return this;
		this.#past.push(this.#current);
		this.#future.length = 0;
		this.#current = next;
		this.#analysis = analyze(next);
		return this;
	}

	undo(): this {
		const previous = this.#past.pop();
		if (previous === undefined) return this;
		this.#future.push(this.#current);
		this.#current = previous;
		this.#analysis = analyze(previous);
		return this;
	}

	redo(): this {
		const next = this.#future.pop();
		if (next === undefined) return this;
		this.#past.push(this.#current);
		this.#current = next;
		this.#analysis = analyze(next);
		return this;
	}
}

function parseFailure(err: unknown): Diagnostic {
	return synthetic(`the document could not be parsed: ${message(err)}`);
}

function lintFailure(err: unknown): Diagnostic {
	return synthetic(`the document was parsed but could not be linted: ${message(err)}`);
}

/**
 * A diagnostic we raise ourselves, shaped like the upstream's so a caller never
 * has to branch on where a problem came from.
 */
function synthetic(text: string): Diagnostic {
	return {
		message: text,
		severity: 1,
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
	} as unknown as Diagnostic;
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
