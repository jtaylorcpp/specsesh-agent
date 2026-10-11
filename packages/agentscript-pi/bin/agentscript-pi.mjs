#!/usr/bin/env node
// Runs the TypeScript CLI through tsx, because the core package ships raw .ts with .js-suffixed imports.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const result = spawnSync(process.execPath, [tsx, join(here, "..", "src", "cli.ts"), ...process.argv.slice(2)], {
	stdio: "inherit",
});
process.exit(result.status ?? 1);
