// Archive an OpenSpec change only if it validates strictly.
// openspec 1.14.1's `archive --yes` archives a change with no deltas, or with an
// ignored header, with exit 0 — dropping requirements. This refuses first.
import { spawnSync } from "node:child_process";

const id = process.argv[2];
if (id === undefined) {
	console.error("usage: pnpm spec:archive <change-id>");
	process.exit(2);
}
const env = { ...process.env, OPENSPEC_TELEMETRY: "0" };
const openspec = (...args) => spawnSync("openspec", args, { stdio: "inherit", env }).status ?? 1;

if (openspec("validate", id, "--strict") !== 0) {
	console.error(`refusing to archive ${id}: it does not pass openspec validate --strict`);
	process.exit(1);
}
process.exit(openspec("archive", id, "--yes"));
