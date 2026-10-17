// Fail the build when an asset the CLI reads from the package root is missing. `agent new` reads
// `templates/new.agent` and `agent language` reads `docs/language/` beside `dist/` (both ship
// through `files`), so a missing template must stop the build, not a user's `agent new`.
//   node scripts/check-assets.mjs     (run by the `build` script)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED = ["templates/new.agent", "docs/language"];
const missing = REQUIRED.filter((path) => !existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))));
for (const path of missing) console.error(`check-assets: ${path} does not exist`);
process.exit(missing.length > 0 ? 1 : 0);
