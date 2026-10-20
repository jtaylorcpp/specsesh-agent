// Fail the build when an asset the CLI reads from the package root is missing. `agent new` reads
// `templates/new.agent`, `agent language` reads `docs/language/`, and `llm` and `<command> help`
// read `docs/llm/` and `templates/SKILL.md`, all beside `dist/` (they ship through `files`), so a
// missing asset must stop the build, not a user's command.
//   node scripts/check-assets.mjs     (run by the `build` script)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED = [
	"templates/new.agent",
	"docs/language",
	"templates/SKILL.md",
	...["guide", "change", "task", "agent", "durable"].map((page) => `docs/llm/${page}.md`),
];
const missing = REQUIRED.filter((path) => !existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))));
for (const path of missing) console.error(`check-assets: ${path} does not exist`);
process.exit(missing.length > 0 ? 1 : 0);
