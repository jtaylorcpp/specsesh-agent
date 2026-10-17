// Mark every `bin` target of the manifest executable. `tsc` writes new files without the
// execute bit, so without this a fresh `pnpm build` leaves bins that a link or a direct run
// refuses with "Permission denied". Run by the `build` and `check` scripts.
//   node scripts/chmod-bins.mjs     (CHMOD_BINS_MANIFEST=<package.json> picks another manifest)
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = process.env.CHMOD_BINS_MANIFEST ?? fileURLToPath(new URL("../package.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bins = typeof manifest.bin === "string" ? { [manifest.name]: manifest.bin } : (manifest.bin ?? {});
const missing = [];
for (const target of Object.values(bins)) {
	const file = resolve(dirname(manifestPath), target);
	if (!existsSync(file)) missing.push(target);
	else chmodSync(file, 0o755);
}
for (const target of missing) console.error(`chmod-bins: bin target ${target} does not exist`);
process.exit(missing.length > 0 ? 1 : 0);
