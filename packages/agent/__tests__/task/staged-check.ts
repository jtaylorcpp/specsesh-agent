/**
 * A check command whose exit code follows a list, one entry per call. Task loops gate on the
 * same checks as their group, so a group test that needs every child to converge and the group
 * check to fail cannot use an always-failing command: it stages the calls instead.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { temp } from "./helpers.js";

/**
 * `node <script> <counter>`: call n exits 0 when `passes[n]` is true, else prints `output` and exits 1.
 * Past the end of the list the last entry repeats. `calls()` is how many times it has run.
 */
export function stagedCheck(passes: readonly boolean[], output = "check failed\n"): { command: string; calls: () => number } {
	const dir = temp("staged-check-");
	const script = join(dir, "check.cjs");
	const counter = join(dir, "counter");
	writeFileSync(
		script,
		[
			'const fs = require("node:fs");',
			"const file = process.argv[2];",
			`const passes = ${JSON.stringify(passes)};`,
			"let n = 0;",
			'try { n = Number(fs.readFileSync(file, "utf8")); } catch {}',
			"fs.writeFileSync(file, String(n + 1));",
			"if (passes[Math.min(n, passes.length - 1)]) process.exit(0);",
			`process.stdout.write(${JSON.stringify(output)});`,
			"process.exit(1);",
			"",
		].join("\n"),
	);
	return {
		command: `${process.execPath} ${script} ${counter}`,
		calls: () => {
			try {
				return Number(readFileSync(counter, "utf8"));
			} catch {
				return 0;
			}
		},
	};
}
