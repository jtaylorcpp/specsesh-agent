/**
 * Narrow views onto the pinned dialect's parse tree.
 *
 * `Dialect.parse()` returns nodes whose public types upstream does not export in
 * a form we can name, so this file states the SHAPE we rely on and nothing else.
 * Written as structural reads rather than casts at each use site: when upstream
 * renames a field, one file stops compiling instead of ten silently reading
 * `undefined` — and reading `undefined` here means a construct is skipped, which
 * is the exact failure the interpreter exists to prevent.
 */

/** A position in the source, as the dialect reports it (0-based). */
export interface Position {
	readonly line: number;
	readonly character: number;
}

export interface Range {
	readonly start: Position;
	readonly end: Position;
}

/** Every node carries its kind and, usually, its span. */
export interface Node {
	readonly __kind?: string;
	readonly __cst?: { readonly range?: Range };
	readonly __keyRange?: Range;
	readonly __children?: readonly Child[];
	readonly [key: string]: unknown;
}

/**
 * A block's authored entry: either a `key: value` field or a named map entry.
 *
 * Both are read rather than the block's own convenience properties, because the
 * children are what the author WROTE. A block object exposes only the fields its
 * schema knows; an authored field the schema stores elsewhere would be invisible
 * to a walk over properties, and invisible is how a construct gets skipped.
 */
export interface Child {
	readonly __type?: string;
	readonly key?: string;
	readonly name?: string;
	readonly _value?: unknown;
	readonly value?: unknown;
	readonly __keyRange?: Range;
	readonly __cst?: { readonly range?: Range };
	readonly __kind?: string;
}

/**
 * The range used when the parser reported none.
 *
 * A SINGLETON, so `isUnreportedRange` can tell it apart by identity from a real
 * range that happens to sit at the top of the file. A refusal claiming "1:1"
 * when the position is simply unknown is indistinguishable from one the surface
 * invented, and sends an author to the wrong line.
 */
const ORIGIN: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/** True when this range is the "the parser reported no position" placeholder. */
export function isUnreportedRange(range: Range): boolean {
	return range === ORIGIN;
}

export function isNode(value: unknown): value is Node {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The document root, from either shape a caller might hold.
 *
 * `Dialect.parse()` returns `{ value, diagnostics }` and `Analysis.parsed` keeps
 * that wrapper, so the root is one hop in. Unwrapping HERE rather than at each
 * call site is not tidiness: a walk handed the wrapper finds no children, reports
 * nothing, and every construct in the document is silently skipped — which is
 * the one failure this package exists to prevent, wearing the shape of a green
 * test. Returns undefined when there is no root to read.
 */
export function documentRoot(parsed: unknown): Node | undefined {
	if (!isNode(parsed)) return undefined;
	if ("value" in parsed && "diagnostics" in parsed) {
		const inner = parsed["value"];
		return isNode(inner) ? inner : undefined;
	}
	return parsed;
}

export function kindOf(value: unknown): string | undefined {
	return isNode(value) ? value.__kind : undefined;
}

/** The value a child holds, whichever spelling this child kind uses for it. */
export function childValue(child: Child): unknown {
	return child._value !== undefined ? child._value : child.value;
}

/** The name a child was written under, whichever spelling this child kind uses. */
export function childName(child: Child): string {
	return child.key ?? child.name ?? "(unnamed)";
}

/**
 * Where to point a human at this child.
 *
 * The key's range when there is one — a diagnostic about `actions:` belongs on
 * the word `actions`, not on the forty lines beneath it. Falls back to the
 * child's own span, then the value's, then the origin, because a refusal with a
 * slightly wrong position still beats no refusal.
 */
export function childRange(child: Child): Range {
	const value = childValue(child);
	return (
		child.__keyRange ??
		child.__cst?.range ??
		(isNode(value) ? value.__cst?.range : undefined) ??
		ORIGIN
	);
}

export function nodeRange(value: unknown): Range {
	return (isNode(value) ? value.__cst?.range : undefined) ?? ORIGIN;
}

export function childrenOf(value: unknown): readonly Child[] {
	if (!isNode(value)) return [];
	const children = value.__children;
	return Array.isArray(children) ? children : [];
}

/** `line:character`, 1-based, because that is how an editor numbers them. */
export function formatPosition(range: Range): string {
	return `${range.start.line + 1}:${range.start.character + 1}`;
}
