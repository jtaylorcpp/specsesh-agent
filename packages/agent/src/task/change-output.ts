/**
 * `draft`'s result as text, ending with the command to run next:
 *
 *   # <change> — <state>
 *   ## <stage>: approved                  one per approved stage
 *   ### <stage> draft <n>: clean|<k> issues
 *      <level> <path>: <message>
 *
 *   then, after the approval of a sliced proposal, a draft command per later slice;
 *   then, by state: review (revise, approve), question (answer), drafted (next) or failed (retry).
 *
 * Pure: it prints nothing and reads nothing. The exit code is the result's own.
 */

import type { DraftRefusal, DraftResult } from "./cmd-draft.js";
import { issueLine } from "./spec-loop.js";

/** A settled draft: anything `runDraft` returns but a refusal, which is only its message. */
export type DraftShown = Exclude<DraftResult, DraftRefusal>;

export interface DraftOutputContext {
	/** The change directory as the output names it: under the config's `changesDir`. */
	readonly changePath: string;
	/** Every entry of `slices.md`, this change first: given only for the run that approved a sliced proposal. */
	readonly slices?: readonly { readonly id: string; readonly intent: string }[];
}

/** `s` in double quotes, with `"`, `\`, `$` and `` ` `` escaped, so the printed command pastes safely. */
const shellQuote = (s: string) => `"${s.replace(/["\\$`]/g, "\\$&")}"`;

export const reviseCmd = (change: string) => `pnpm change draft ${change} "<what to change>"`;
export const approveCmd = (change: string) => `pnpm change approve ${change}`;
export const answerCmd = (change: string) => `pnpm change draft ${change} "<answer>"`;
export const nextGroupCmd = (change: string) => `pnpm task ${change} --next-group`;
export const retryCmd = (change: string) => `pnpm change draft ${change}`;
export const sliceCmd = (slice: { readonly id: string; readonly intent: string }) => `pnpm change draft ${slice.id} --intent ${shellQuote(slice.intent)}`;

const plural = (k: number) => `${k} issue${k === 1 ? "" : "s"}`;

function header(result: DraftShown): string {
	switch (result.kind) {
		case "review":
			return `waiting for review of the ${result.stage}`;
		case "question":
			return `waiting for an answer on the ${result.stage}`;
		case "drafted":
			return "drafted: every stage is approved";
		case "failed":
			return `draft ${result.status}${result.stage !== undefined ? ` at the ${result.stage}` : ""}`;
	}
}

/** A settled draft as text, ending with the next command. */
export function formatDraftOutput(result: DraftShown, context: DraftOutputContext): string[] {
	const { change } = result;
	const lines = [`# ${change} — ${header(result)}`];
	for (const stage of result.approved) lines.push(`## ${stage}: approved`);
	if (result.kind !== "drafted") {
		const stage = result.kind === "failed" ? (result.stage ?? "stage") : result.stage;
		for (const draft of result.drafts) {
			lines.push(`### ${stage} draft ${draft.n}: ${draft.issues.length === 0 ? "clean" : plural(draft.issues.length)}`);
			for (const issue of draft.issues) lines.push(`   ${issueLine(issue)}`);
		}
	}

	// The other slices come before the ending, so the last line stays the command to run next.
	const later = (context.slices ?? []).slice(1);
	if (later.length > 0) {
		lines.push("", `Sliced into ${context.slices?.length} changes. Draft the others when you're ready:`);
		for (const slice of later) lines.push(`  ${sliceCmd(slice)}`);
	}

	lines.push("");
	switch (result.kind) {
		case "review": {
			lines.push(
				`Review ${result.files.map((file) => `${context.changePath}/${file}`).join(", ")}, then:`,
				`  revise:   ${reviseCmd(change)}`,
				`  approve:  ${approveCmd(change)}`,
			);
			break;
		}
		case "question":
			lines.push(`question: ${result.question}`, `  answer:   ${answerCmd(change)}`);
			break;
		case "drafted":
			lines.push(`  next:     ${nextGroupCmd(change)}`);
			break;
		case "failed":
			// An exhausted or failed draft is restarted by the next `draft`, with a fresh budget.
			if (result.reason !== result.status) lines.push(`reason: ${result.reason}`);
			lines.push(`  retry:    ${retryCmd(change)}`);
			break;
	}
	return lines;
}
