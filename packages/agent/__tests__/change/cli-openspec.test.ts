/**
 * change/cli: every command that runs openspec refuses one older than 1.14.1, or of unknown
 * version, before it does anything else. `agentscript-change` in process, on a faux model, with
 * PATH holding only a fake `openspec` and the system directories, and no
 * `node_modules/.bin/openspec` in the workspace. The fake, a shell script, appends each call's
 * arguments to a log and prints its version for `--version`. The spec's `/usr/local/bin` and
 * `/opt/tools` paths cannot be created here, so each message names the fake's temp path.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetOpenspecCache } from "../../src/task/openspec-bin.js";
import { write } from "../task/cli-helpers.js";
import { cleanTemps, temp } from "../task/helpers.js";
import { CHANGE, OPENSPEC_BIN, change, planExportTask22, workspace } from "./helpers.js";

const SAVED_ENV = ["PATH", "OPENSPEC_TELEMETRY", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(SAVED_ENV.map((key) => [key, process.env[key]]));
	process.env["OPENSPEC_TELEMETRY"] = "0";
	// git reads an empty temp global gitconfig, never the real one.
	const gitconfig = join(temp("openspec-gitconfig-"), "gitconfig");
	writeFileSync(gitconfig, "");
	process.env["GIT_CONFIG_GLOBAL"] = gitconfig;
	process.env["GIT_CONFIG_NOSYSTEM"] = "1";
	resetOpenspecCache();
});

afterEach(() => {
	for (const key of SAVED_ENV) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	resetOpenspecCache();
	cleanTemps();
});

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/**
 * An executable `openspec` in `dir` that prints `versionText` for `--version` and exits 0 on
 * anything, logging each call's arguments as one line. Only it, then `/usr/bin` and `/bin`, are
 * on PATH from now on, so no real or global openspec is found.
 */
function makeFakeOpenspec(dir: string, versionText: string) {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "openspec");
	const log = join(dir, "calls.log");
	writeFileSync(
		path,
		[
			"#!/bin/sh",
			`printf '%s\\n' "$*" >> ${quote(log)}`,
			`if [ "$1" = "--version" ]; then printf '%s\\n' ${quote(versionText)}; fi`,
			"exit 0",
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	process.env.PATH = `${dir}:/usr/bin:/bin`;
	resetOpenspecCache();
	return {
		path,
		/** Every call's arguments, one string per call, in order. */
		calls: (): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : []),
	};
}

/** A workspace (`workspace()`: config, database at `loops.sqlite`) holding `openspec/` with `files`, relative to the change directory, under `add-plan-export`. */
function makeWorkspace(files: Record<string, string> = {}) {
	const ws = workspace();
	write(ws.dir, {
		[join("openspec", "config.yaml")]: "schema: spec-driven\n",
		[join("openspec", "specs", "plan", "cli", "spec.md")]: "# plan/cli Specification\n\n## Purpose\nThe plan command line.\n",
		...Object.fromEntries(Object.entries(files).map(([path, text]) => [join("openspec", "changes", CHANGE, path), text])),
	});
	return ws;
}

/** Every file under `dir`, in path order: its path relative to `dir` and the sha256 of its bytes. */
function snapshotTree(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.sort()
		.filter((path) => statSync(join(dir, path)).isFile())
		.map((path) => `${relative(dir, join(dir, path))} ${createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")}`);
}

const refusal = (shown: string) => `${shown} is below the minimum supported version 1.14.1`;

describe.skipIf(process.platform === "win32")("Commands that run openspec refuse one that is too old", () => {
	it("Scenario: draft refuses an old openspec", async () => {
		const { dir, db } = makeWorkspace();
		const fake = makeFakeOpenspec(join(temp("openspec-usr-"), "local", "bin"), "1.9.0");
		const before = snapshotTree(dir);

		const run = await change(["draft", "add-spec-amendments-cli", "--intent", "Amend specs from the CLI"], dir);
		// One line; `change()` joins the lines `err` was given, so no trailing newline.
		expect(run.err).toBe(refusal(`openspec 1.9.0 at ${fake.path}`));
		expect(run.code).toBe(2);
		expect(run.calls).toBe(0);
		expect(snapshotTree(dir)).toEqual(before);
		expect(existsSync(db)).toBe(false);
		expect(existsSync(join(dir, "openspec", "changes", "add-spec-amendments-cli"))).toBe(false);
		expect(fake.calls()).toEqual(["--version"]);
	});

	it("Scenario: approve refuses an unreadable version", async () => {
		const { dir, db } = makeWorkspace({ "proposal.md": "## Why\nPlans export.\n" });
		const fake = makeFakeOpenspec(join(temp("openspec-root-"), "opt", "tools"), "openspec dev build");
		const before = snapshotTree(dir);

		const run = await change(["approve", CHANGE], dir);
		expect(run.err).toBe(refusal(`openspec (version unknown) at ${fake.path}`));
		expect(run.code).toBe(2);
		expect(run.calls).toBe(0);
		expect(snapshotTree(dir)).toEqual(before);
		expect(existsSync(db)).toBe(false);
		expect(fake.calls()).toEqual(["--version"]);
	});

	it("Scenario: close refuses an old openspec", async () => {
		// Closeable but for openspec: every task ticked, a delta for a new capability.
		const { dir, db } = makeWorkspace({
			"proposal.md": "## Why\nPlans have to leave the tool, for a reason long enough to pass.\n\n## What Changes\n- Exports a plan.\n",
			"design.md": "## Context\nA design.\n",
			[join("specs", "plan", "export", "spec.md")]:
				"## Purpose\nPlans leave the tool as files.\n\n## ADDED Requirements\n\n### Requirement: Plans export\nA plan SHALL export as JSON.\n\n#### Scenario: A plan exports\n- **WHEN** it runs\n- **THEN** it SHALL work\n",
			"tasks.md": '## 1. Export\n\n- [x] 1.1 `src/export.ts`: "A plan exports"\n',
		});
		const fake = makeFakeOpenspec(join(temp("openspec-usr-"), "local", "bin"), "1.9.0");
		const before = snapshotTree(join(dir, "openspec"));
		const wholeBefore = snapshotTree(dir);

		const run = await change(["close", CHANGE], dir);
		expect(run.err).toBe(refusal(`openspec 1.9.0 at ${fake.path}`));
		expect(run.code).toBe(2);
		expect(run.out).toBe("");
		// Not archived, nothing folded.
		expect(snapshotTree(join(dir, "openspec"))).toEqual(before);
		expect(snapshotTree(dir)).toEqual(wholeBefore);
		expect(existsSync(db)).toBe(false);
		expect(fake.calls()).toEqual(["--version"]);
	});

	it("Scenario: --amend refuses an old openspec", async () => {
		// Seeding validates the change with the repo's pinned openspec; only then does the fake take over.
		process.env.PATH = `${OPENSPEC_BIN}:${saved["PATH"] ?? ""}`;
		const seeded = await planExportTask22();
		const fake = makeFakeOpenspec(join(temp("openspec-usr-"), "local", "bin"), "1.9.0");
		const openspecBefore = snapshotTree(join(seeded.dir, "openspec"));
		const deltaBefore = seeded.readDelta();
		const loopStateBefore = snapshotTree(dirname(seeded.db));

		const run = await seeded.build(["--amend"]);
		expect(run.err).toBe(refusal(`openspec 1.9.0 at ${fake.path}`));
		expect(run.code).toBe(2);
		expect(run.calls).toBe(0);
		// The delta is not written.
		expect(seeded.readDelta()).toEqual(deltaBefore);
		expect(snapshotTree(join(seeded.dir, "openspec"))).toEqual(openspecBefore);
		// The escalation still waits: the loop database is byte for byte as it was, its newest change loop blocked.
		expect(snapshotTree(dirname(seeded.db))).toEqual(loopStateBefore);
		expect((await seeded.changeLoops()).at(-1)!.status).toBe("blocked");
		expect(fake.calls()).toEqual(["--version"]);
	}, 120_000);
});
