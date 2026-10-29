/**
 * Picking the tests that cover one closed task, for a narrow CI run.
 *
 * `pickTests` runs the bundled `ci-test-pick.agent` once: a deterministic
 * pre-filter (`siblingTests`) first adds every test that sits beside a changed
 * file, then the model picks from the repository's test files. The script
 * answers one string, `pick`, holding JSON; it is checked against `TestPick`
 * (`./openspec`), every path not among the test files is dropped and
 * everything is deduped.
 *
 * It never throws. A timeout, a provider failure, unparsable or invalid output
 * and an empty pick each answer `{ ok: false, reason }`, and the caller (Specsesh
 * CI) runs the full suite instead.
 */

import { readFileSync } from "node:fs";
import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createClaudeCodeReasoningPort, CLAUDE_CODE_PROVIDER } from "../claude-code/index.js";
import { run, type ReasoningPort } from "../interpreter/index.js";
import { TestPick, check, explain, type TestReason } from "../openspec/index.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, createPiReasoningPort, resolveModel } from "../pi/index.js";

export { testPattern, type TestPick, type TestReason } from "../openspec/index.js";

/** The bundled picker script, beside this module in `src/` and in `dist/` alike. */
export const CI_TEST_PICK_SCRIPT = new URL("./scripts/ci-test-pick.agent", import.meta.url);

export const DEFAULT_PICK_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_DIFF_CHARS = 20_000;

/** What the picker reads. Lists are newline-separated, paths repository-relative. */
export interface PickTestsInput {
	readonly task_id: string;
	readonly task_text: string;
	/** The task's linked scenarios, as text. */
	readonly scenarios: string;
	/** The files the task changed, one per line. */
	readonly changed_files: string;
	/** Every test file in the repository, one per line. A pick never leaves this list. */
	readonly test_files: string;
	/** The task's diff; cut to `maxDiffChars`. */
	readonly diff?: string;
}

export interface PickTestsOptions {
	/** The reasoning port the script runs on. When set, `provider`, `model` and `models` are not used. */
	readonly port?: ReasoningPort;
	/** A pi provider id, or `claude-code`. Defaults to `anthropic`. */
	readonly provider?: string;
	/** The model id on that provider. Defaults to `claude-haiku-4-5`. */
	readonly model?: string;
	/** The pi model collection for a pi provider. Defaults to every built-in pi provider. */
	readonly models?: Models;
	/** How long the run may take. Defaults to 120000. */
	readonly timeoutMs?: number;
	/** The Agent Script source to run. Defaults to the bundled `ci-test-pick.agent`. */
	readonly script?: string;
	/** The diff is cut to this many characters. Defaults to 20000. */
	readonly maxDiffChars?: number;
}

export type PickTestsResult = { readonly ok: true; readonly pick: TestPick } | { readonly ok: false; readonly reason: string };

/** Lines of a newline list, trimmed, without a leading `./`, empty ones dropped. */
export function pathLines(list: string): string[] {
	return list
		.split(/\r?\n/)
		.map(normalPath)
		.filter((line) => line !== "");
}

const normalPath = (path: string) => path.trim().replace(/^(\.\/)+/, "");

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);

/** The basename without its last extension. */
const stemOf = (path: string) => {
	const base = baseOf(path);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
};

/** The stem a test file's name says it tests: `x.test.ts`, `x.spec.ts`, `x_test.go`, `test_x.py` → `x`. */
function subjectOf(testPath: string): string | undefined {
	const stem = stemOf(testPath);
	const marked = /^(.+)\.(test|spec)$/.exec(stem) ?? /^(.+)_test$/.exec(stem);
	if (marked !== null) return marked[1];
	const prefixed = /^test_(.+)$/.exec(stem);
	return prefixed?.[1];
}

const TEST_DIRS = ["", "__tests__", "tests", "test"];

/**
 * The test files that sit beside a changed file, in changed-file order: same
 * stem, in the same directory or its `__tests__`, `tests` or `test`
 * subdirectory. A changed file that is itself a test file is included.
 */
export function siblingTests(changed: readonly string[], tests: readonly string[]): string[] {
	const out: string[] = [];
	const known = new Set(tests);
	const add = (path: string) => {
		if (!out.includes(path)) out.push(path);
	};
	for (const file of changed.map(normalPath)) {
		if (file === "") continue;
		if (known.has(file)) {
			add(file);
			continue;
		}
		const stem = stemOf(file);
		const homes = TEST_DIRS.map((sub) => join(dirOf(file), sub).replace(/\/$/, ""));
		for (const test of tests) {
			if (homes.includes(dirOf(test)) && subjectOf(test) === stem) add(test);
		}
	}
	return out;
}

/** The JSON in `text`, unwrapping one surrounding Markdown code fence. */
function parseJson(text: string): unknown {
	const fenced = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
	return JSON.parse(fenced !== null ? (fenced[1] as string) : text);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The port `options` name: theirs, else claude-code or a pi provider. */
async function portOf(options: PickTestsOptions, signal: AbortSignal): Promise<ReasoningPort> {
	if (options.port !== undefined) return options.port;
	const provider = options.provider ?? DEFAULT_PROVIDER;
	const modelId = options.model ?? DEFAULT_MODEL;
	if (provider === CLAUDE_CODE_PROVIDER) {
		return createClaudeCodeReasoningPort({ model: modelId, timeoutMs: options.timeoutMs ?? DEFAULT_PICK_TIMEOUT_MS });
	}
	const models = options.models ?? builtinModels();
	return createPiReasoningPort({ models, model: resolveModel(models, provider, modelId), signal });
}

/** Keep `items` whose key is new, first wins. */
const dedupe = <T>(items: readonly T[], key: (item: T) => string) => {
	const seen = new Set<string>();
	return items.filter((item) => {
		const k = key(item);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
};

/**
 * Pick the tests that cover one closed task. Never throws: every failure is
 * `{ ok: false, reason }`, and the caller runs the full suite.
 */
export async function pickTests(input: PickTestsInput, options: PickTestsOptions = {}): Promise<PickTestsResult> {
	try {
		return await pick(input, options);
	} catch (error) {
		return { ok: false, reason: `the picker failed: ${message(error)}` };
	}
}

async function pick(input: PickTestsInput, options: PickTestsOptions): Promise<PickTestsResult> {
	const tests = dedupe(pathLines(input.test_files ?? ""), (path) => path);
	if (tests.length === 0) return { ok: false, reason: "no test files to pick from" };
	const changed = pathLines(input.changed_files ?? "");
	const siblings = siblingTests(changed, tests);

	const source = options.script ?? readFileSync(CI_TEST_PICK_SCRIPT, "utf8");
	const abort = new AbortController();
	const port = await portOf(options, abort.signal);
	const maxDiff = options.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
	const diff = input.diff ?? "";
	const variables = {
		task_id: input.task_id ?? "",
		task_text: input.task_text ?? "",
		scenarios: input.scenarios ?? "",
		changed_files: changed.join("\n"),
		test_files: tests.join("\n"),
		diff: diff.length > maxDiff ? `${diff.slice(0, maxDiff)}\n[diff truncated]` : diff,
		siblings: siblings.join("\n"),
	};

	const timeoutMs = options.timeoutMs ?? DEFAULT_PICK_TIMEOUT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	const running = run(source, { port, variables });
	// A late rejection after the timeout is not an unhandled one.
	running.catch(() => {});
	const settled = await Promise.race([running, timeout]).finally(() => clearTimeout(timer));
	if (settled === "timeout") {
		abort.abort();
		return { ok: false, reason: `the picker timed out after ${timeoutMs}ms` };
	}

	if (settled.kind !== "completed") {
		const last = settled.steps.at(-1)?.outcome;
		const why = last?.kind === "failed" ? `${last.category}: ${last.message}` : settled.kind;
		return { ok: false, reason: `the picker's run did not complete (${why})` };
	}
	const text = settled.variables["pick"];
	if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "the picker answered no pick" };

	let parsed: unknown;
	try {
		parsed = parseJson(text);
	} catch (error) {
		return { ok: false, reason: `the pick is not JSON: ${message(error)}` };
	}
	if (!check(TestPick, parsed)) {
		return { ok: false, reason: `the pick is not a TestPick: ${explain(TestPick, parsed).join("; ")}` };
	}
	const value = parsed as TestPick;

	const known = new Set(tests);
	const picked = value.tests.map(normalPath).filter((path) => known.has(path));
	const allTests = dedupe([...siblings, ...picked], (path) => path);
	const kept = new Set(allTests);
	const modelReasons: TestReason[] = value.reasons
		.map((reason) => ({ test: normalPath(reason.test), why: reason.why }))
		.filter((reason) => kept.has(reason.test));
	// One reason per kept test, in `tests` order: the model's, else the pre-filter's for a sibling.
	const reasons = allTests.flatMap((test): TestReason[] => {
		const given = modelReasons.find((reason) => reason.test === test);
		if (given !== undefined) return [given];
		return siblings.includes(test) ? [{ test, why: siblingWhy(test, changed) }] : [];
	});
	const names = dedupe(
		value.names.map((name) => name.trim()).filter((name) => name !== ""),
		(name) => name,
	);
	if (allTests.length === 0 && names.length === 0) return { ok: false, reason: "the pick names no test" };
	return { ok: true, pick: { tests: allTests, names, reasons } };
}

function siblingWhy(test: string, changed: readonly string[]): string {
	if (changed.includes(test)) return "the task changed this test file";
	const stem = subjectOf(test);
	const source = changed.find((file) => stemOf(file) === stem);
	return source !== undefined ? `sits beside the changed file ${source}` : "sits beside a changed file";
}
