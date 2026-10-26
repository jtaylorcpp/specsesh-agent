/**
 * package/llm: `specsesh llm` and `specsesh llm skill`, through `main`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_USAGE, USAGE, main } from "../../src/cli/index.js";
import { HELP_COMMANDS } from "../../src/cli/llm.js";

const PACKAGE = fileURLToPath(new URL("../../", import.meta.url));

/** Runs `main(argv)` in `cwd` with `out` and `err` collecting lines. */
async function run(argv: string[], cwd?: string) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, { ...(cwd !== undefined ? { cwd } : {}), out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

const version = (JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { version: string }).version;

/** The skill's front matter lines and its body, split at the second `---`. */
function frontMatter(text: string): { head: string[]; body: string } {
	const lines = text.split("\n");
	const end = lines.indexOf("---", 1);
	return { head: lines.slice(0, end + 1), body: lines.slice(end + 1).join("\n") };
}

describe("specsesh llm prints the guide for LLM agents", () => {
	it("Scenario: The guide carries the usage", async () => {
		const { code, stdout, stderr } = await run(["llm"]);
		expect(stderr).toBe("");
		expect(code).toBe(0);
		expect(stdout.startsWith("# ")).toBe(true);
		for (const line of USAGE.split("\n")) expect(stdout).toContain(line);
	});

	it("Scenario: The guide names its version and leaves no placeholder", async () => {
		const { stdout } = await run(["llm"]);
		expect(stdout).toContain(`specsesh ${version}`);
		expect(stdout).not.toContain("{{");
	});

	it("Scenario: The guide covers the workflow and its rules", async () => {
		const { stdout } = await run(["llm"]);
		expect(stdout.split("\n").length).toBeLessThanOrEqual(60);
		for (const command of HELP_COMMANDS) expect(stdout).toContain(`specsesh ${command} help`);
		expect(stdout).toContain("specsesh llm providers");
		expect(stdout).toContain("specsesh llm deploy");
		expect(stdout).toContain("specsesh never commits");
		expect(stdout).toContain("Only the principal approves");
	});
});

describe("specsesh llm skill prints a starter skill", () => {
	it("Scenario: The skill has front matter", async () => {
		const { code, stdout } = await run(["llm", "skill"]);
		expect(code).toBe(0);
		const { head } = frontMatter(stdout);
		expect(head[0]).toBe("---");
		expect(head).toContain("name: specsesh");
		expect(head.some((line) => /^description: \S/.test(line))).toBe(true);
		expect(head.at(-1)).toBe("---");
		expect(head.length).toBeGreaterThan(3);
	});

	it("Scenario: The skill points at the guide", async () => {
		const { stdout } = await run(["llm", "skill"]);
		const { body } = frontMatter(stdout);
		expect(body).toContain("specsesh llm");
		expect(body).toContain("specsesh <command> help");
		expect(body).toContain("principal");
		expect(stdout).not.toContain("{{");
	});
});

describe("specsesh llm skill --out writes the skill without overwriting", () => {
	it("Scenario: Write into a new directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "specsesh-llm-"));
		const path = ".claude/skills/specsesh/SKILL.md";
		const { code, stdout } = await run(["llm", "skill", "--out", path], dir);
		expect(code).toBe(0);
		expect(stdout).toBe(`wrote ${join(dir, path)}`);
		expect(readFileSync(join(dir, path), "utf8")).toBe(`${(await run(["llm", "skill"])).stdout}\n`);
	});

	it("Scenario: No overwrite", async () => {
		const dir = mkdtempSync(join(tmpdir(), "specsesh-llm-"));
		const file = join(dir, "SKILL.md");
		writeFileSync(file, "sentinel");
		const { code, stderr } = await run(["llm", "skill", "--out", "SKILL.md"], dir);
		expect(code).toBe(1);
		expect(stderr).toContain(file);
		expect(readFileSync(file, "utf8")).toBe("sentinel");
	});
});

describe("The usage names llm", () => {
	it("Scenario: Help lists llm", async () => {
		const { code, stdout } = await run(["--help"]);
		expect(code).toBe(0);
		expect(stdout.split("\n")).toContain("  specsesh llm [skill [--out <path>] | providers [<name>] | deploy <local|cloudflare>]");
	});

	it("Scenario: An unknown llm subcommand prints usage", async () => {
		for (const argv of [
			["llm", "frobnicate"],
			["llm", "skill", "--out"],
		]) {
			const { code, stderr } = await run(argv);
			expect(code, argv.join(" ")).toBe(2);
			expect(stderr.startsWith("usage: specsesh llm"), argv.join(" ")).toBe(true);
		}
	});
});

describe("specsesh llm providers and deploy print the shipped pages", () => {
	/** What the process writes is `stdout` plus the newline `out` adds. */
	const printed = async (argv: string[]) => {
		const { code, stdout, stderr } = await run(argv);
		return { code, stderr, text: `${stdout}\n` };
	};
	const shipped = (path: string) => readFileSync(join(PACKAGE, path), "utf8");

	it("Scenario: providers prints the matrix", async () => {
		const { code, stderr, text } = await printed(["llm", "providers"]);
		expect(stderr).toBe("");
		expect(code).toBe(0);
		expect(text).toBe(shipped("docs/providers/README.md"));
	});

	it("Scenario: A provider page prints by name", async () => {
		const { code, text } = await printed(["llm", "providers", "ollama"]);
		expect(code).toBe(0);
		expect(text).toBe(shipped("docs/providers/ollama.md"));
	});

	it("Scenario: A deployment page prints by name", async () => {
		const { code, text } = await printed(["llm", "deploy", "cloudflare"]);
		expect(code).toBe(0);
		expect(text).toBe(shipped("docs/deploy/cloudflare.md"));
	});

	it("Scenario: An unknown page prints usage", async () => {
		for (const argv of [
			["llm", "providers", "nope"],
			["llm", "deploy"],
		]) {
			const { code, stdout, stderr } = await run(argv);
			expect(code, argv.join(" ")).toBe(2);
			expect(stdout, argv.join(" ")).toBe("");
			expect(stderr.startsWith("usage: specsesh llm"), argv.join(" ")).toBe(true);
		}
	});
});

describe("The guide and the skill ship in the package", () => {
	it("Scenario: Both are packed", () => {
		const [packed] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PACKAGE, encoding: "utf8" })) as [
			{ files: { path: string }[] },
		];
		const paths = packed.files.map((file) => file.path);
		for (const page of ["guide", ...HELP_COMMANDS]) expect(paths).toContain(`docs/llm/${page}.md`);
		expect(paths).toContain("templates/SKILL.md");
	});

	it("Scenario: The build requires them", () => {
		for (const missing of ["guide", "task"]) {
			// A copy of the script beside every asset it requires but one page.
			const root = mkdtempSync(join(tmpdir(), "specsesh-assets-"));
			mkdirSync(join(root, "scripts"));
			copyFileSync(join(PACKAGE, "scripts/check-assets.mjs"), join(root, "scripts/check-assets.mjs"));
			mkdirSync(join(root, "templates"));
			writeFileSync(join(root, "templates/new.agent"), "");
			writeFileSync(join(root, "templates/SKILL.md"), "");
			mkdirSync(join(root, "docs/language"), { recursive: true });
			mkdirSync(join(root, "docs/llm"));
			for (const page of ["guide", ...HELP_COMMANDS]) if (page !== missing) writeFileSync(join(root, `docs/llm/${page}.md`), "");
			mkdirSync(join(root, "docs/providers"));
			for (const page of ["README", "api-keys", "claude-code", "ollama", "workers-ai"]) writeFileSync(join(root, `docs/providers/${page}.md`), "");
			mkdirSync(join(root, "docs/deploy"));
			for (const page of ["local", "cloudflare"]) writeFileSync(join(root, `docs/deploy/${page}.md`), "");
			expect(existsSync(join(root, `docs/llm/${missing}.md`))).toBe(false);

			const ran = spawnSync(process.execPath, [join(root, "scripts/check-assets.mjs")], { encoding: "utf8" });
			expect(ran.status, missing).toBe(1);
			expect(ran.stderr, missing).toContain(`docs/llm/${missing}.md`);
		}
	});
});

describe("specsesh <command> help explains the command in depth", () => {
	/** The first heading of a command's page, as shipped. */
	const heading = (command: string) => readFileSync(join(PACKAGE, `docs/llm/${command}.md`), "utf8").split("\n")[0] as string;

	it("Scenario: Each command explains itself", async () => {
		for (const command of HELP_COMMANDS) {
			const { code, stdout, stderr } = await run([command, "help"]);
			expect(stderr, command).toBe("");
			expect(code, command).toBe(0);
			expect(stdout.startsWith("usage:"), command).toBe(true);
			expect(stdout, command).toContain(`specsesh ${command}`);
			expect(stdout, command).toContain(heading(command));
			expect(stdout, command).not.toContain("{{");
		}
	});

	it("Scenario: --help and -h say the same", async () => {
		const help = await run(["change", "help"]);
		for (const flag of ["--help", "-h"]) {
			const other = await run(["change", flag]);
			expect(other.code, flag).toBe(0);
			expect(other.stdout, flag).toBe(help.stdout);
		}
	});

	it("Scenario: task help is not a change", async () => {
		const { code, stdout, stderr } = await run(["task", "help"]);
		expect(code).toBe(0);
		expect(stdout + stderr).not.toContain("give exactly one of");
	});

	it("Scenario: agent help still lists every subcommand", async () => {
		const { stdout } = await run(["agent", "help"]);
		for (const line of AGENT_USAGE.split("\n")) expect(stdout).toContain(line);
	});

	it("Scenario: durable help names specsesh", async () => {
		const { stdout } = await run(["durable", "help"]);
		expect(stdout).toContain("specsesh durable run");
		expect(stdout).not.toContain("agentscript-durable");
	});
});
