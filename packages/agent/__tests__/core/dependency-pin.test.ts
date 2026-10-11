import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = () => JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
const UPSTREAM = (deps: Record<string, string>) =>
	Object.entries(deps).filter(([n]) => n.startsWith("@sf-agentscript/"));

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The pin check: every `@sf-agentscript/*` dependency must be an exact
 * `major.minor.patch`. A caret would let the closed-spec upstream change our
 * subset's meaning on someone else's install, with nothing in this repo
 * recording it. Returns one failure per offender, naming it.
 */
function pinFailures(deps: Record<string, string>): string[] {
	return UPSTREAM(deps)
		.filter(([, range]) => !/^\d+\.\d+\.\d+$/.test(range))
		.map(([name, range]) => `${name} is not pinned exactly (declared ${range})`);
}

describe("platform-agentscript-authoring: The dependency is exact", () => {
	it("pins every upstream dependency to an exact version", () => {
		const upstream = UPSTREAM(manifest().dependencies ?? {});
		expect(upstream.length).toBeGreaterThan(0);
		expect(pinFailures(manifest().dependencies ?? {})).toEqual([]);
	});

	it("Scenario: A caret range is rejected", () => {
		const failures = pinFailures({
			"@sf-agentscript/language": "^3.2.3",
			"@sf-agentscript/parser-javascript": "3.1.3",
			"not-upstream": "^1.0.0",
		});
		// Only the caret dependency fails, and it is named.
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain("@sf-agentscript/language");
		expect(failures[0]).toContain("not pinned exactly");
	});
});

/** Run the conformance check, optionally against a substituted subset file. */
function conformance(subsetFile?: string) {
	const env = { ...process.env, ...(subsetFile ? { AGENTSCRIPT_SUBSET_FILE: subsetFile } : {}) };
	try {
		const stdout = execFileSync("node", ["scripts/check-subset-conformance.mjs", "--json"], {
			cwd: PKG_DIR,
			encoding: "utf8",
			env,
		});
		return { code: 0, report: JSON.parse(stdout) };
	} catch (err) {
		const e = err as { status?: number; stdout?: string };
		return { code: e.status ?? 1, report: e.stdout ? JSON.parse(e.stdout) : null };
	}
}

describe("platform-agentscript-authoring: Bumping the version", () => {
	it("re-runs the supported-subset conformance, and passes at the current pin", () => {
		const run = conformance();
		expect(run.code).toBe(0);
		expect(run.report.failures).toEqual([]);
		expect(run.report.checked).toBeGreaterThan(0);
	});

	it("is wired into the package's own test script, so a bump cannot skip it", () => {
		expect(manifest().scripts.test).toContain("check-subset-conformance");
	});
});

/** Write a modified copy of the subset declaration and run the check against it. */
function withSubset(edit: (source: string) => string) {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-bump-"));
	temps.push(dir);
	const subsetPath = join(dir, "subset.ts");
	writeFileSync(subsetPath, edit(readFileSync(join(PKG_DIR, "src/interpreter/subset.ts"), "utf8")));
	return conformance(subsetPath);
}

describe("platform-agentscript-authoring: A bump that breaks the subset", () => {
	it("Scenario: A declaration that is no longer a plain literal", () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-bump-"));
		temps.push(dir);
		const subsetPath = join(dir, "subset.ts");
		const original = readFileSync(join(PKG_DIR, "src/interpreter/subset.ts"), "utf8");
		const edited = original.replaceAll("] as const;", "];");
		// The edit really removed the terminator the script looks for.
		expect(original).toContain("] as const;");
		expect(edited).not.toContain("] as const;");
		writeFileSync(subsetPath, edited);

		let status = 0;
		let stderr = "";
		try {
			execFileSync("node", ["scripts/check-subset-conformance.mjs", "--json"], {
				cwd: PKG_DIR,
				encoding: "utf8",
				stdio: "pipe",
				env: { ...process.env, AGENTSCRIPT_SUBSET_FILE: subsetPath },
			});
		} catch (err) {
			const e = err as { status?: number; stderr?: string };
			status = e.status ?? 1;
			stderr = e.stderr ?? "";
		}
		expect(status, "a non-literal declaration must fail the run").not.toBe(0);
		expect(stderr).toContain("SUPPORTED_CONSTRUCTS is no longer a plain array literal");
	});

	it("fails naming the constructs whose HANDLING changed, not only those that stopped parsing", () => {
		// The failure mode the requirement is actually about, and the one the
		// script could not see. An upstream RENAME — `ProcedureValue` → `Procedure`
		// — leaves every probe parsing perfectly clean while breaking `scan.ts` and
		// `compose.ts` outright, because they match on the kind STRING. Standing in
		// for a bump by renaming the kind in the declaration is the same shape: the
		// declared kind is no longer one the pinned version produces.
		//
		// Before the script walked the parse, this exited 0 with "Every supported
		// construct still parses clean" — a green check on precisely the change it
		// exists to catch.
		const run = withSubset((source) => source.replaceAll('"ProcedureValue"', '"Procedure"'));

		expect(run.code, "a renamed node kind must fail the run").not.toBe(0);
		const failures = run.report.failures as { id: string; diagnostics: string[] }[];
		expect(failures.map((f) => f.id)).toContain("subagent.reasoning");
		const named = failures.find((f) => f.id === "subagent.reasoning");
		expect(named?.diagnostics.join("\n")).toContain("Procedure");
		// It says WHY this is dangerous rather than reporting a bare mismatch.
		expect(named?.diagnostics.join("\n")).toMatch(/scan\.ts|compose\.ts/);

		// And from the other side: `ProcedureValue` is now a kind the probes
		// produce that no construct declares, which is what an upstream SPLIT would
		// look like.
		expect(failures.map((f) => f.id)).toContain("(subset)");
	});

	it("fails a construct that declares no kinds at all, so an empty list cannot hide", () => {
		// `reasoning.structured-output` shipped with `kinds: []`. A declared empty
		// collection is skipped in silence by every loop over it — the construct
		// with the most machinery behind it was the one construct nothing checked.
		const run = withSubset((source) =>
			source.replace(/kinds: \["SetClause", "MemberExpression", "AtIdentifier"\]/, "kinds: []"),
		);

		expect(run.code).not.toBe(0);
		const failures = run.report.failures as { id: string; diagnostics: string[] }[];
		const named = failures.find((f) => f.id === "reasoning.structured-output");
		expect(named, "an empty kinds list passed unnoticed").toBeDefined();
		expect(named?.diagnostics.join("\n")).toContain("declares no node kinds");
	});

	it("fails naming the constructs whose handling changed, and is not adopted", () => {
		// Stand in for a bump by changing what the subset claims upstream supports.
		// The failure mode is identical: a construct the pin no longer parses clean.
		const dir = mkdtempSync(join(tmpdir(), "agentscript-bump-"));
		temps.push(dir);
		const subsetPath = join(dir, "subset.ts");
		const subset = readFileSync(join(PKG_DIR, "src/interpreter/subset.ts"), "utf8").replace(
			"] as const;",
			`	{
		id: "retired-construct",
		summary: "a construct the pinned version no longer accepts",
		probe: "definitely_not_a_block:\\n    nope: 1\\n",
	},
] as const;`,
		);
		writeFileSync(subsetPath, subset);

		const run = conformance(subsetPath);
		expect(run.code, "a broken subset must fail the run").not.toBe(0);
		expect(run.report.failures.map((f: { id: string }) => f.id)).toContain("retired-construct");
		// Naming it is the point: "conformance failed" sends someone hunting.
		expect(JSON.stringify(run.report.failures)).toMatch(/retired-construct/);
	});
});
