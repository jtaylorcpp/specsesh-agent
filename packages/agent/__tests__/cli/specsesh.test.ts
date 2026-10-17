/**
 * package/command: `specsesh` routes `change`, `durable` and `agent` to their bins' `main`,
 * except the `agent` usage and subcommands it handles itself, and importing
 * `@specsesh/agent/cli` runs nothing. Each route is compared with the bin it names, called
 * directly with the arguments after the command.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as changeMain } from "../../src/bin/agentscript-change.js";
import { main as durableMain } from "../../src/bin/agentscript-durable.js";
import { main as piMain } from "../../src/bin/agentscript-pi.js";
import { AGENT_USAGE, main, type CliDeps } from "../../src/cli/index.js";

// dist/ is built by the suite's global setup (`pnpm build`).
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

afterEach(() => {
	vi.restoreAllMocks();
});

/** `deps` whose `out` and `err` collect lines; everything else keeps the bins' defaults. */
function capture() {
	const out: string[] = [];
	const err: string[] = [];
	const deps: CliDeps = { out: (line) => out.push(line), err: (line) => err.push(line) };
	return { deps, out: () => out.join("\n"), err: () => err.join("\n") };
}

describe("specsesh routes four commands to their CLIs", () => {
	it("Scenario: change routes to the change CLI", async () => {
		const routed = capture();
		expect(await main(["change"], routed.deps)).toBe(2);
		const direct = capture();
		await changeMain([], direct.deps);
		expect(routed.err()).toBe(direct.err());
	});

	it("Scenario: durable routes to the durable CLI", async () => {
		// A bare `run` is refused for its missing file and database before any model or database is opened.
		const routed = capture();
		const direct = capture();
		const code = await main(["durable", "run"], routed.deps);
		expect(code).toBe(await durableMain(["run"], direct.deps));
		expect(routed.err()).toBe(direct.err());
	});

	it("Scenario: agent routes to the pi CLI", async () => {
		// agentscript-pi writes through `console` and takes no deps.
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(await main(["agent", "run"])).toBe(2);
		const text = [...error.mock.calls, ...stderr.mock.calls].map((call) => String(call[0])).join("\n");
		expect(text.startsWith("usage:")).toBe(true);
		expect(text).toContain("agentscript-pi run <file>");
		expect(log).not.toHaveBeenCalled();
	});

	it("Scenario: run still runs a script", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await main(["agent", "run"])).toBe(2);
		const routed = error.mock.calls.map((call) => String(call[0]));
		error.mockClear();
		expect(await piMain(["run"])).toBe(2);
		expect(routed).toEqual(error.mock.calls.map((call) => String(call[0])));
		expect(routed.length).toBeGreaterThan(0);
	});

	it("Scenario: agent alone prints the agent usage", async () => {
		const routed = capture();
		expect(await main(["agent"], routed.deps)).toBe(2);
		expect(routed.out()).toBe("");
		expect(routed.err()).toBe(AGENT_USAGE);
		expect(routed.err().startsWith("usage:")).toBe(true);
		for (const sub of ["run", "models", "list", "show", "new", "check", "language", "actions"]) {
			expect(routed.err()).toContain(`specsesh agent ${sub}`);
		}
	});

	it("Scenario: agent usage covers every subcommand", async () => {
		const routed = capture();
		expect(await main(["agent"], routed.deps)).toBe(2);
		const lines = routed.err().split("\n").map((line) => line.trim());
		expect(lines[0]).toBe("usage:");
		for (const sub of ["run", "models", "list", "show", "new", "check", "language", "actions"]) {
			expect(lines.filter((line) => line.startsWith(`specsesh agent ${sub}`)), sub).toHaveLength(1);
		}
		for (const flag of ["--help", "-h", "help"]) {
			const help = capture();
			expect(await main(["agent", flag], help.deps), flag).toBe(0);
			expect(help.out(), flag).toBe(AGENT_USAGE);
			expect(help.err(), flag).toBe("");
		}
	});

	it("Scenario: Importing the cli entry runs nothing", () => {
		// Run from the package root, so the self-reference resolves through the exports map to dist/.
		const child = spawnSync(process.execPath, ["--input-type=module", "-e", "import '@specsesh/agent/cli'"], { cwd: PKG_DIR, encoding: "utf8" });
		expect(child.status).toBe(0);
		expect(child.stdout).toBe("");
		expect(child.stderr).toBe("");
	});
});
