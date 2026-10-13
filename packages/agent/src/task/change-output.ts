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
 * `build`'s result as text, ending the same way:
 *
 *   # <change> — built|waiting for an answer|exhausted|failed
 *   ## group <n>: <status> (<k> tasks, <r> reworks)    one per group entered; `blocked at <task>` when it did
 *   ## change check: passed|failed                     when it ran, a failure followed by its commands and output
 *   ## unclaimed: <n>                                  when any, then one scenario per line
 *
 *   then, by state: waiting (the question, answer), built (changed files, close) or failed (retry).
 *
 * Pure: it prints nothing and reads nothing. The exit code is the result's own.
 */

import { formatRef } from "../openspec/index.js";
import type { BuildRefusal, BuildResult } from "./cmd-build.js";
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
export const buildCmd = (change: string) => `pnpm change build ${change}`;
export const buildAnswerCmd = (change: string) => `pnpm change build ${change} "<answer>"`;
export const closeCmd = (change: string) => `pnpm change close ${change}`;
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
			lines.push(`  next:     ${buildCmd(change)}`);
			break;
		case "failed":
			// An exhausted or failed draft is restarted by the next `draft`, with a fresh budget.
			if (result.reason !== result.status) lines.push(`reason: ${result.reason}`);
			lines.push(`  retry:    ${retryCmd(change)}`);
			break;
	}
	return lines;
}

/** A settled build: anything `runBuild` returns but a refusal, which is only its message. */
export type BuildShown = Exclude<BuildResult, BuildRefusal>;

const count = (k: number, noun: string) => `${k} ${noun}${k === 1 ? "" : "s"}`;

/** The change loop's own prefix on a failed change check; the commands and their output follow it. */
const CHECK_FAILED = "change check failed:\n";

function buildHeader(result: BuildShown): string {
	switch (result.kind) {
		case "built":
			return "built";
		case "waiting":
			return "waiting for an answer";
		case "failed":
			return result.status;
	}
}

/** A settled build as text, ending with the next command. */
export function formatBuildOutput(result: BuildShown): string[] {
	const { change } = result;
	const lines = [`# ${change} — ${buildHeader(result)}`];
	for (const group of result.groups) {
		lines.push(
			group.blockedAt !== undefined
				? `## group ${group.group}: blocked at ${group.blockedAt}`
				: `## group ${group.group}: ${group.status} (${count(group.tasks, "task")}, ${count(group.reworks, "rework")})`,
		);
	}
	if (result.check?.passed === true) lines.push("## change check: passed");
	else if (result.check?.passed === false) {
		const reason = result.check.reason.startsWith(CHECK_FAILED) ? result.check.reason.slice(CHECK_FAILED.length) : result.check.reason;
		lines.push("## change check: failed", ...reason.split("\n").map((line) => (line === "" ? "" : `   ${line}`)));
	}
	if (result.unclaimed.length > 0) {
		lines.push(`## unclaimed: ${result.unclaimed.length}`);
		for (const ref of result.unclaimed) lines.push(`   ${formatRef(ref)}`);
	}

	lines.push("");
	switch (result.kind) {
		case "waiting":
			lines.push(`${result.group !== undefined ? `group ${result.group} asks` : "question"}: ${result.question}`, `  answer:  ${buildAnswerCmd(change)}`);
			break;
		case "built":
			if (result.changed.length > 0) lines.push(`Changed: ${result.changed.join(", ")}`);
			lines.push(closeCmd(change));
			break;
		case "failed":
			// An exhausted or failed build is restarted by the next `build`, with a fresh budget.
			if (result.reason !== result.status) lines.push(`reason: ${result.reason}`);
			lines.push(`  retry:   ${buildCmd(change)}`);
			break;
	}
	return lines;
}
