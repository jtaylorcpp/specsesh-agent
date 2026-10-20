/**
 * package/llm: `specsesh llm` and `specsesh llm skill`, through `main`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USAGE, main } from "../../src/cli/index.js";

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
		for (const command of [
			"specsesh change draft",
			"specsesh change approve",
			"specsesh change build",
			"specsesh change close",
			"specsesh task answer",
			"specsesh agent list",
		]) {
			expect(stdout).toContain(command);
		}
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
		expect(stdout.split("\n")).toContain("  specsesh llm [skill [--out <path>]]");
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

describe("The guide and the skill ship in the package", () => {
	it("Scenario: Both are packed", () => {
		const [packed] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PACKAGE, encoding: "utf8" })) as [
			{ files: { path: string }[] },
		];
		const paths = packed.files.map((file) => file.path);
		expect(paths).toContain("docs/llm/guide.md");
		expect(paths).toContain("templates/SKILL.md");
	});

	it("Scenario: The build requires them", () => {
		// A copy of the script beside every asset it requires but the guide.
		const root = mkdtempSync(join(tmpdir(), "specsesh-assets-"));
		mkdirSync(join(root, "scripts"));
		copyFileSync(join(PACKAGE, "scripts/check-assets.mjs"), join(root, "scripts/check-assets.mjs"));
		mkdirSync(join(root, "templates"));
		writeFileSync(join(root, "templates/new.agent"), "");
		writeFileSync(join(root, "templates/SKILL.md"), "");
		mkdirSync(join(root, "docs/language"), { recursive: true });
		expect(existsSync(join(root, "docs/llm/guide.md"))).toBe(false);

		const ran = spawnSync(process.execPath, [join(root, "scripts/check-assets.mjs")], { encoding: "utf8" });
		expect(ran.status).toBe(1);
		expect(ran.stderr).toContain("docs/llm/guide.md");
	});
});
