/**
 * package/command: `specsesh` prints its usage with no command, an unknown command or
 * `--help`, and its manifest's version with `--version`. None of these reach a route, so no
 * database is opened and no model is called.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main, USAGE, type CliDeps } from "../../src/cli/index.js";

const USAGE_LINES = [
	"specsesh change <draft|approve|build|close> <change> [options]",
	"specsesh task <change> <task-id>|<group>|--next|--next-group [options]",
	"specsesh task <run|spec|resume|answer|status> [options]",
	"specsesh durable <run|resume> [options]",
	"specsesh agent <run|models> [options]",
	"specsesh --version",
	"specsesh --help",
];

/** Runs `main` with `out` and `err` collecting lines. */
async function run(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const deps: CliDeps = { out: (line) => out.push(line), err: (line) => err.push(line) };
	const code = await main(argv, deps);
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("specsesh prints its usage and its version", () => {
	it("Scenario: No command prints usage", async () => {
		const { code, stdout, stderr } = await run([]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
		expect(stderr.startsWith("usage:")).toBe(true);
		const lines = stderr.split("\n").map((line) => line.trim());
		for (const line of USAGE_LINES) expect(lines).toContain(line);
	});

	it("Scenario: --help prints usage to stdout", async () => {
		for (const flag of ["--help", "-h", "help"]) {
			const { code, stdout, stderr } = await run([flag]);
			expect(code, flag).toBe(0);
			expect(stdout, flag).toBe(USAGE);
			expect(stderr, flag).toBe("");
		}
	});

	it("Scenario: An unknown command prints usage", async () => {
		const { code, stdout, stderr } = await run(["frobnicate"]);
		expect(code).toBe(2);
		expect(stdout).toBe("");
		expect(stderr).toContain("usage:");
	});

	it("Scenario: --version prints the manifest's version", async () => {
		const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
		for (const flag of ["--version", "-v"]) {
			const { code, stdout, stderr } = await run([flag]);
			expect(code, flag).toBe(0);
			expect(stdout, flag).toBe(`specsesh ${version}`);
			expect(stderr, flag).toBe("");
		}
	});
});
