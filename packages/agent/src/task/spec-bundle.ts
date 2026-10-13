/**
 * A stage's `files` bundle: one string of sections, each opened by a line
 * `=== <path>` and running to the next such line. Reading it is pure: it
 * picks out the files the stage may write and turns every other section into
 * an `ERROR` issue for the gate round. Nothing here touches the disk.
 */

import { type SpecStage, type StageIssue, owns } from "./spec-stage.js";

export interface BundleRead {
	/** The owned sections, by path relative to the change directory, each with exactly its section text. */
	readonly files: Record<string, string>;
	/** One `ERROR` per section that must not be written, or one for a bundle with no section. */
	readonly issues: StageIssue[];
}

const HEADER = "=== ";

/** Why `path` may not be written by `stage`, or `undefined` when it may. */
function refusal(stage: Pick<SpecStage, "name" | "owns">, path: string): string | undefined {
	if (path === "") return "section has no path";
	if (/^[/\\]/.test(path) || /^[A-Za-z]:/.test(path)) return "absolute path is not allowed";
	if (path.split(/[/\\]/).includes("..")) return "path leaves the change directory";
	if (!owns(stage, path)) return `\`${path}\` is not owned by the ${stage.name} stage (owns: ${stage.owns.join(", ")})`;
	return undefined;
}

/** Reads a bundle into the files `stage` owns and the issues for the rest; a repeated path keeps its last section. */
export function readBundle(text: string, stage: Pick<SpecStage, "name" | "owns">): BundleRead {
	const lines = text.replace(/\r\n/g, "\n").split(/(?<=\n)/);
	const sections: { path: string; body: string[] }[] = [];
	for (const line of lines) {
		if (line.startsWith(HEADER)) sections.push({ path: line.slice(HEADER.length).trim(), body: [] });
		else sections.at(-1)?.body.push(line);
	}
	if (sections.length === 0) {
		return { files: {}, issues: [{ level: "ERROR", path: "files", message: `the ${stage.name} stage wrote no files` }] };
	}
	const files: Record<string, string> = {};
	const issues: StageIssue[] = [];
	for (const { path, body } of sections) {
		const reason = refusal(stage, path);
		if (reason === undefined) files[path] = body.join("");
		else issues.push({ level: "ERROR", path: path === "" ? "files" : path, message: reason });
	}
	return { files, issues };
}
