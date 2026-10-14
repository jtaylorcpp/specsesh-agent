import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { amendmentTarget, applyAmendment, unifiedDiff, type AmendmentCheck } from "../../src/task/amend.js";
import { resetOpenspecCache } from "../../src/task/openspec-bin.js";
import { cleanTemps, temp } from "./helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";
const DELTA = "specs/plan/export/spec.md";

describe("amendmentTarget", () => {
	it("refuses tasks.md, naming it", () => {
		expect(amendmentTarget("/repo/openspec/changes", CHANGE, "tasks.md")).toEqual({ ok: false, message: 'amendment delta "tasks.md" is not specs/**/spec.md' });
	});

	it("resolves a spec.md under specs/, normalised, under the change", () => {
		expect(amendmentTarget("/repo/openspec/changes", CHANGE, DELTA)).toEqual({ ok: true, path: `/repo/openspec/changes/${CHANGE}/${DELTA}` });
		expect(amendmentTarget("/repo/openspec/changes", CHANGE, "./specs/a/spec.md")).toEqual({ ok: true, path: `/repo/openspec/changes/${CHANGE}/specs/a/spec.md` });
	});

	it.each(["/abs/specs/x/spec.md", "C:\\specs\\x\\spec.md", "specs/../tasks.md", "specs/x/../../proposal.md", "specs/x/..\\..\\spec.md", "specs/spec.md", "specs/x/notes.md"])(
		"refuses %s, naming the raw delta",
		(delta) => {
			expect(amendmentTarget("/repo/openspec/changes", CHANGE, delta)).toEqual({ ok: false, message: `amendment delta "${delta}" is not specs/**/spec.md` });
		},
	);
});

describe("unifiedDiff", () => {
	const shown = `openspec/changes/${CHANGE}/${DELTA}`;
	const filler = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);
	const file = (then: string) =>
		[...filler(1, 12), "#### Scenario: Export writes JSON", "- **WHEN** `plan export p1` runs", then, ...filler(16, 18)].join("\n") + "\n";

	it("diffs the file on disk to the amendment, headed on disk and amended", () => {
		const before = file("- **THEN** stdout SHALL be the plan as JSON");
		const after = file("- **THEN** stdout SHALL be the plan as JSON, with keys sorted");
		expect(unifiedDiff(shown, before, after)).toBe(
			[
				`--- ${shown} (on disk)`,
				`+++ ${shown} (amended)`,
				"@@ -12,7 +12,7 @@",
				" line 12",
				" #### Scenario: Export writes JSON",
				" - **WHEN** `plan export p1` runs",
				"-- **THEN** stdout SHALL be the plan as JSON",
				"+- **THEN** stdout SHALL be the plan as JSON, with keys sorted",
				" line 16",
				" line 17",
				" line 18",
				"",
			].join("\n"),
		);
	});

	it("diffs a missing file from nothing, and is empty when nothing changes", () => {
		expect(unifiedDiff(shown, null, "a\nb\n")).toBe(`--- ${shown} (on disk)\n+++ ${shown} (amended)\n@@ -0,0 +1,2 @@\n+a\n+b\n`);
		expect(unifiedDiff(shown, "a\nb\n", "a\nb\n")).toBe("");
	});

	it("splits changes more than six lines apart into separate hunks", () => {
		const before = filler(1, 20).join("\n");
		const after = before.replace("line 2\n", "two\n").replace("line 19\n", "nineteen\n");
		const diff = unifiedDiff(shown, before, after);
		expect(diff.match(/^@@ .* @@$/gm)).toEqual(["@@ -1,5 +1,5 @@", "@@ -16,5 +16,5 @@"]);
	});
});

describe("applyAmendment", () => {
	const passing: AmendmentCheck = async () => ({ exitCode: 0, output: "✓ change/add-plan-export\n" });
	const setup = (before?: string) => {
		const root = temp("amend-");
		const target = join(root, "openspec", "changes", CHANGE, DELTA);
		if (before !== undefined) {
			mkdirSync(join(target, ".."), { recursive: true });
			writeFileSync(target, before);
		}
		return { root, target };
	};
	const recorded = (check: AmendmentCheck) => {
		const calls: string[] = [];
		const wrapped: AmendmentCheck = async () => {
			calls.push("ran");
			return check();
		};
		return { calls, check: wrapped };
	};

	it("writes the text and runs the trial fold when validation passes", async () => {
		const { root, target } = setup("old\n");
		const fold = recorded(async () => ({ exitCode: 0, output: "folded\n" }));
		const result = await applyAmendment({ target, text: "new\n", change: CHANGE, root, validate: passing, trialFold: fold.check });
		expect(result).toEqual({ passed: true, output: "✓ change/add-plan-export\nfolded\n" });
		expect(readFileSync(target, "utf8")).toBe("new\n");
		expect(fold.calls).toEqual(["ran"]);
	});

	it("puts back the exact uncommitted bytes on an [ERROR], without the trial fold", async () => {
		const uncommitted = Buffer.from("## MODIFIED Requirements\r\n\u00e9 uncommitted edit, no final newline", "utf8");
		const { root, target } = setup();
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, uncommitted);
		const fold = recorded(passing);
		const validate: AmendmentCheck = async () => ({ exitCode: 1, output: '✗ change/add-plan-export\n  [ERROR] requirement "Export writes JSON" is 534 characters (max 500)\n' });
		const result = await applyAmendment({ target, text: "amended\n", change: CHANGE, root, validate, trialFold: fold.check });
		expect(result).toEqual({ passed: false, output: expect.stringContaining("[ERROR] requirement"), restored: target });
		expect(readFileSync(target).equals(uncommitted)).toBe(true);
		expect(fold.calls).toEqual([]);
	});

	it("fails and restores on a [WARNING] from a trial fold that exits 0", async () => {
		const { root, target } = setup("before\n");
		const trialFold: AmendmentCheck = async () => ({ exitCode: 0, output: "  [WARNING] requirement text is 534 characters\n" });
		const result = await applyAmendment({ target, text: "amended\n", change: CHANGE, root, validate: passing, trialFold });
		expect(result).toMatchObject({ passed: false, output: expect.stringContaining("[WARNING]"), restored: target });
		expect(readFileSync(target, "utf8")).toBe("before\n");
	});

	it("deletes a file it created, and the directories it made, when a check fails", async () => {
		const { root, target } = setup();
		mkdirSync(join(root, "openspec", "changes", CHANGE, "specs"), { recursive: true });
		const validate: AmendmentCheck = async () => ({ exitCode: 1, output: "✗ change/add-plan-export\n" });
		const result = await applyAmendment({ target, text: "amended\n", change: CHANGE, root, validate, trialFold: passing });
		expect(result.passed).toBe(false);
		expect(existsSync(target)).toBe(false);
		expect(existsSync(join(root, "openspec", "changes", CHANGE, "specs", "plan"))).toBe(false);
		expect(existsSync(join(root, "openspec", "changes", CHANGE, "specs"))).toBe(true);
	});

	describe.skipIf(process.platform === "win32")("the default checks", () => {
		/** An `openspec` in `dir` that logs each call's args, cwd and telemetry to `log`, and passes. */
		const stub = (dir: string, log: string) => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "openspec"),
				[
					`#!${process.execPath}`,
					'const fs = require("node:fs");',
					"const args = process.argv.slice(2);",
					`fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), telemetry: process.env.OPENSPEC_TELEMETRY ?? null }) + "\\n");`,
					'if (args[0] === "--version") process.stdout.write("1.14.1\\n");',
					'else if (args[0] === "validate" && args[1] === "--specs") process.stdout.write(JSON.stringify({ items: [], version: "1.0" }));',
					'else process.stdout.write("ok\\n");',
					"",
				].join("\n"),
				{ mode: 0o755 },
			);
		};
		const calls = (log: string) =>
			existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; cwd: string; telemetry: string | null }) : [];

		let savedPath: string | undefined;
		beforeEach(() => {
			savedPath = process.env.PATH;
			resetOpenspecCache();
		});
		afterEach(() => {
			process.env.PATH = savedPath;
			resetOpenspecCache();
		});

		it("run the repository's own openspec, also in the trial fold's copy, without telemetry", async () => {
			const { root, target } = setup("old\n");
			const logs = temp("amend-logs-");
			const projectLog = join(logs, "project.jsonl");
			const pathLog = join(logs, "path.jsonl");
			stub(join(root, "node_modules", ".bin"), projectLog);
			const onPath = temp("amend-path-");
			stub(onPath, pathLog);
			process.env.PATH = `${onPath}:${savedPath ?? ""}`;

			const result = await applyAmendment({ target, text: "new\n", change: CHANGE, root });
			expect(result.passed).toBe(true);

			const ran = calls(projectLog).filter((call) => call.args[0] !== "--version");
			expect(ran.map((call) => call.args.join(" "))).toEqual(["validate --all --strict", `archive ${CHANGE} --yes`, "validate --specs --strict --json"]);
			for (const call of ran) expect(call.telemetry).toBe("0");
			expect(realpathSync(ran[0]!.cwd)).toBe(realpathSync(root));
			expect(ran[1]!.cwd).toBe(ran[2]!.cwd);
			expect(ran[1]!.cwd.startsWith(realpathSync(root))).toBe(false);
			expect(calls(projectLog).filter((call) => call.args[0] === "--version")).toHaveLength(1);
			expect(calls(pathLog)).toEqual([]);
		});

		it("fail the validation, naming none found, when there is no openspec", async () => {
			const { root, target } = setup("before\n");
			const result = await applyAmendment({ target, text: "amended\n", change: CHANGE, root, bin: null });
			expect(result).toEqual({ passed: false, output: "(could not start: spawn openspec ENOENT) (openspec not found)", restored: target });
			expect(readFileSync(target, "utf8")).toBe("before\n");
		});
	});

	it("restores the file and rethrows when a check throws", async () => {
		const { root, target } = setup("before\n");
		const validate: AmendmentCheck = async () => {
			throw new Error("openspec vanished");
		};
		await expect(applyAmendment({ target, text: "amended\n", change: CHANGE, root, validate, trialFold: passing })).rejects.toThrow("openspec vanished");
		expect(readFileSync(target, "utf8")).toBe("before\n");
	});
});
