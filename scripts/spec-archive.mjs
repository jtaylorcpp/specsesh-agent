// Archive an OpenSpec change only if it validates strictly AND folds into specs that validate strictly.
// openspec 1.14.1's `archive --yes` archives a change with no deltas, or with an
// ignored header, with exit 0 — dropping requirements. And a change can validate
// while the specs it folds into do not (a MODIFIED requirement can grow past the
// length limit only once merged). So: validate the change, fold it into a temporary
// copy of openspec/ and validate the result, and only then archive for real.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const id = process.argv[2];
if (id === undefined) {
	console.error("usage: pnpm spec:archive <change-id>");
	process.exit(2);
}
const env = { ...process.env, OPENSPEC_TELEMETRY: "0" };
const openspec = (cwd, ...args) =>
	spawnSync("openspec", args, { cwd, stdio: "inherit", env }).status ?? 1;

if (openspec(process.cwd(), "validate", id, "--strict") !== 0) {
	console.error(`refusing to archive ${id}: it does not pass openspec validate --strict`);
	process.exit(1);
}

const trial = mkdtempSync(join(tmpdir(), "spec-archive-"));
try {
	cpSync(join(process.cwd(), "openspec"), join(trial, "openspec"), { recursive: true });
	if (openspec(trial, "archive", id, "--yes") !== 0 || openspec(trial, "validate", "--specs", "--strict") !== 0) {
		console.error(`refusing to archive ${id}: folded into a copy of openspec/, the specs do not pass validate --specs --strict`);
		process.exit(1);
	}
} finally {
	rmSync(trial, { recursive: true, force: true });
}

process.exit(openspec(process.cwd(), "archive", id, "--yes"));
