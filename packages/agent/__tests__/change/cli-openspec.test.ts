/**
 * change/cli: every command that runs openspec refuses one older than 1.14.1, or of unknown
 * version, before it does anything else. `agentscript-change` in process, on a faux model, with
 * PATH holding only a fake `openspec` and the system directories, and no
 * `node_modules/.bin/openspec` in the workspace. The fake, a shell script, appends each call's
 * arguments to a log and prints its version for `--version`. The spec's `/usr/local/bin` and
 * `/opt/tools` paths cannot be created here, so each message names the fake's temp path.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOpenspec, resetOpenspecCache, resolveOpenspec } from "../../src/task/openspec-bin.js";
import { write } from "../task/cli-helpers.js";
import { cleanTemps, temp, verdict } from "../task/helpers.js";
import { CHANGE, OPENSPEC_BIN, change, noAmendment, planExportTask22, workspace } from "./helpers.js";

// The real module, with its resolver and version check counted.
vi.mock("../../src/task/openspec-bin.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("../../src/task/openspec-bin.js")>();
	return { ...real, resolveOpenspec: vi.fn(real.resolveOpenspec), checkOpenspec: vi.fn(real.checkOpenspec) };
});

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

/** A workspace whose `add-plan-export` is closeable but for openspec: every task ticked, a delta for a new capability. */
function closeableWorkspace() {
	const ws = makeWorkspace({
		"proposal.md": "## Why\nPlans have to leave the tool, for a reason long enough to pass.\n\n## What Changes\n- Exports a plan.\n",
		"design.md": "## Context\nA design.\n",
		[join("specs", "plan", "export", "spec.md")]:
			"## Purpose\nPlans leave the tool as files that other tools can read back in.\n\n## ADDED Requirements\n\n### Requirement: Plans export\nA plan SHALL export as JSON.\n\n#### Scenario: A plan exports\n- **WHEN** it runs\n- **THEN** it SHALL work\n",
		"tasks.md": '## 1. Export\n\n- [x] 1.1 `src/export.ts`: "A plan exports"\n',
	});
	// A valid existing spec, so a real trial fold passes.
	write(ws.dir, {
		[join("openspec", "specs", "plan", "cli", "spec.md")]:
			"# plan/cli Specification\n\n## Purpose\nThe plan command line, which reads and writes plans for the principal.\n\n## Requirements\n\n### Requirement: Plans list\nThe CLI SHALL list plans.\n\n#### Scenario: Plans are listed\n- **WHEN** it runs\n- **THEN** it SHALL list them\n",
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
	it("Scenario: An old PATH openspec refuses draft", async () => {
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

	it("Scenario: An unreadable version refuses approve", async () => {
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

	it("Scenario: 1.14.0 refuses close", async () => {
		const { dir, db } = closeableWorkspace();
		const fake = makeFakeOpenspec(join(temp("openspec-usr-"), "local", "bin"), "1.14.0");
		const before = snapshotTree(join(dir, "openspec"));
		const wholeBefore = snapshotTree(dir);

		const run = await change(["close", CHANGE], dir);
		expect(run.err).toBe(refusal(`openspec 1.14.0 at ${fake.path}`));
		expect(run.code).toBe(2);
		expect(run.out).toBe("");
		// Not archived, nothing folded.
		expect(snapshotTree(join(dir, "openspec"))).toEqual(before);
		expect(snapshotTree(dir)).toEqual(wholeBefore);
		expect(existsSync(db)).toBe(false);
		expect(fake.calls()).toEqual(["--version"]);
	});

	it("Scenario: An old openspec refuses --amend", async () => {
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
		expect(run.out).not.toMatch(/^amended/m);
		// The delta is not written.
		expect(seeded.readDelta()).toEqual(deltaBefore);
		expect(snapshotTree(join(seeded.dir, "openspec"))).toEqual(openspecBefore);
		// The escalation still waits: the loop database is byte for byte as it was, its newest change loop blocked.
		expect(snapshotTree(dirname(seeded.db))).toEqual(loopStateBefore);
		expect((await seeded.changeLoops()).at(-1)!.status).toBe("blocked");
		expect(fake.calls()).toEqual(["--version"]);
	}, 120_000);

	it("Scenario: A text answer to build is not checked", async () => {
		// Seeding validates the change with the repo's pinned openspec; only then does the fake take over.
		process.env.PATH = `${OPENSPEC_BIN}:${saved["PATH"] ?? ""}`;
		const seeded = await noAmendment({ change: CHANGE, capability: "plan/export" });
		expect(existsSync(join(seeded.dir, "node_modules", ".bin", "openspec"))).toBe(false);
		const fake = makeFakeOpenspec(join(temp("openspec-usr-"), "local", "bin"), "1.9.0");
		vi.mocked(resolveOpenspec).mockClear();
		vi.mocked(checkOpenspec).mockClear();

		// 2.2 asks again, so no change check or trial fold runs openspec after the answer:
		// any `--version` in the log would have run before it.
		const run = await seeded.build(["Use the v2 API"], [verdict(false, "still two APIs", "ask", "Which v2 endpoint?")]);
		expect(run.err).not.toContain("below the minimum supported version");
		expect(run.code).toBe(1);
		expect(run.out).toContain("Which v2 endpoint?");
		// Group 2's run answering the blocked one, and 2.2 rerun, each with the decision as given.
		const answers = await seeded.answers();
		expect(answers.length).toBeGreaterThan(0);
		for (const answer of answers) expect(answer.decision).toBe("Use the v2 API");
		expect(answers.some((answer) => answer.kind === "task" && answer.task === "2.2")).toBe(true);
		expect(fake.calls()).not.toContain("--version");
		expect(vi.mocked(checkOpenspec)).not.toHaveBeenCalled();
		expect(vi.mocked(resolveOpenspec)).not.toHaveBeenCalled();
	}, 120_000);
});

describe.skipIf(process.platform === "win32")("close and --amend run the openspec resolved for the repository", () => {
	/** PATH with only node (for the pinned openspec's shim) and the system directories; no openspec on any of them. */
	const pathWithoutOpenspec = () => {
		const nodeDir = temp("openspec-node-");
		symlinkSync(process.execPath, join(nodeDir, "node"));
		return `${nodeDir}:/usr/bin:/bin`;
	};

	it("Scenario: The trial fold uses the repository's openspec", async () => {
		const { dir } = closeableWorkspace();
		// The project's own openspec: logs `$0`, its directory, OPENSPEC_TELEMETRY and its arguments, then is the pinned one.
		const bin = join(dir, "node_modules", ".bin");
		mkdirSync(bin, { recursive: true });
		const path = join(bin, "openspec");
		const log = join(temp("openspec-log-"), "calls.log");
		writeFileSync(
			path,
			[
				"#!/bin/sh",
				`printf '%s\\t%s\\t%s\\t%s\\n' "$0" "$(pwd -P)" "\${OPENSPEC_TELEMETRY-unset}" "$*" >> ${quote(log)}`,
				`exec ${quote(join(OPENSPEC_BIN, "openspec"))} "$@"`,
				"",
			].join("\n"),
			{ mode: 0o755 },
		);
		process.env.PATH = pathWithoutOpenspec();
		// Only runOpenspec may switch telemetry off.
		delete process.env["OPENSPEC_TELEMETRY"];

		const run = await change(["close", CHANGE], dir);
		expect(run.err).toBe("");
		expect(run.code).toBe(0);
		const calls = readFileSync(log, "utf8").split("\n").filter((line) => line !== "").map((line) => line.split("\t"));
		const trialDir = join(realpathSync(tmpdir()), "close-");
		const trialArchive = calls.filter(([, cwd, , args]) => args === `archive ${CHANGE} --yes` && cwd!.startsWith(trialDir));
		expect(trialArchive).toHaveLength(1);
		expect(trialArchive[0]![0]).toBe(path);
		expect(trialArchive[0]![2]).toBe("0");
		// Every call, in the copy or the repository, ran the repository's openspec with telemetry off.
		for (const [ran, , telemetry] of calls) {
			expect(ran).toBe(path);
			expect(telemetry).toBe("0");
		}
		expect(calls.some(([, cwd, , args]) => args === `archive ${CHANGE} --yes` && cwd === realpathSync(dir))).toBe(true);
		// Resolved once, for the repository: the trial copy is not resolved again.
		expect(calls.filter(([, , , args]) => args === "--version")).toHaveLength(1);
	}, 120_000);

	it("Scenario: A missing openspec is not a version refusal", async () => {
		const { dir } = closeableWorkspace();
		process.env.PATH = pathWithoutOpenspec();
		const before = snapshotTree(join(dir, "openspec"));

		const run = await change(["close", CHANGE], dir);
		expect(run.err).not.toContain("below the minimum supported version");
		expect(run.err).toContain("openspec not found");
		expect(run.code).toBe(2);
		expect(snapshotTree(join(dir, "openspec"))).toEqual(before);
	});
});
