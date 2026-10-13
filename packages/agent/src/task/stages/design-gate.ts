/**
 * The design stage's gate, as pure rules over the stage's files: `design.md`
 * has sections, `design/` holds a mock and an example, every mock is one
 * self-contained HTML document, and every `design/…` path design.md names
 * exists. Shape and facts, not quality.
 */

import type { StageIssue } from "../spec-stage.js";
import { proposalSections } from "./proposal-md.js";

type Files = Readonly<Record<string, string>>;

const DESIGN = "design.md";
const DOCTYPE = /^<!doctype\s+html\s*>/i;
const ATTRIBUTE = /\b(?:src|href)\s*=\s*(["']?)([^"'\s>]*)\1/gi;
const NETWORK = /^(?:https?:|\/\/)/i;
const BACKTICKED = /`(design\/[^`\s]+)`/g;
const LINKED = /\]\((?:\.\/)?(design\/[^)\s#]+)/g;

const error = (path: string, message: string): StageIssue => ({ level: "ERROR", path, message });

/** An `ERROR` when design.md is missing or has fewer than `min` `## ` sections outside ``` fences. */
export function sectionCount(text: string | undefined, min: number): StageIssue[] {
	const count = text === undefined ? 0 : proposalSections(text).length;
	return count < min ? [error(DESIGN, `design.md needs at least ${min} ## sections; it has ${count}`)] : [];
}

/** The files under `prefix`, by path. */
export function under(files: Files, prefix: string): Record<string, string> {
	return Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix) && path.length > prefix.length));
}

/** The `.html` files under `prefix`, in any case, by path. */
export function htmlUnder(files: Files, prefix: string): Record<string, string> {
	return Object.fromEntries(Object.entries(under(files, prefix)).filter(([path]) => /\.html$/i.test(path)));
}

/** An `ERROR` when there is no mock, and one per breach in each mock, naming its file. */
export function mockIssues(mocks: Files): StageIssue[] {
	if (Object.keys(mocks).length === 0) return [error("design/", "a mock is needed: no .html file under design/")];
	const issues: StageIssue[] = [];
	for (const [path, text] of Object.entries(mocks)) {
		if (!DOCTYPE.test(text.trimStart())) issues.push(error(path, `\`${path}\` is not a complete document: it must begin with <!doctype html>`));
		if (!/<\/html>/i.test(text)) issues.push(error(path, `\`${path}\` is not a complete document: it must contain </html>`));
		for (const match of text.matchAll(ATTRIBUTE)) {
			const value = match[2] as string;
			if (NETWORK.test(value)) issues.push(error(path, `\`${path}\` loads ${value} from the network; inline it so the mock opens from disk`));
		}
	}
	return issues;
}

/** An `ERROR` when no file is under `design/examples/`. */
export function exampleIssues(examples: Files): StageIssue[] {
	return Object.keys(examples).length === 0 ? [error("design/examples/", "an example is needed under design/examples/")] : [];
}

/** The `design/…` paths design.md names, in backticks or as link targets, in first appearance order. */
export function designReferences(markdown: string): string[] {
	const found = new Set<string>();
	for (const pattern of [BACKTICKED, LINKED]) {
		for (const match of markdown.matchAll(pattern)) found.add((match[1] as string).replace(/[.,;:!?]+$/, ""));
	}
	return [...found];
}

/** An `ERROR` per `design/…` path design.md names that is not among `files`; a path ending in `/` needs a file under it. */
export function referenceIssues(markdown: string | undefined, files: Files): StageIssue[] {
	const exists = (path: string) => (path.endsWith("/") ? Object.keys(under(files, path)).length > 0 : path in files);
	return designReferences(markdown ?? "")
		.filter((path) => !exists(path))
		.map((path) => error(DESIGN, `design.md names \`${path}\`, which does not exist`));
}

/** Every design rule, in the design's order. */
export function designGate({ files }: { readonly files: Files }): StageIssue[] {
	return [
		...sectionCount(files[DESIGN], 2),
		...mockIssues(htmlUnder(files, "design/")),
		...exampleIssues(under(files, "design/examples/")),
		...referenceIssues(files[DESIGN], files),
	];
}
