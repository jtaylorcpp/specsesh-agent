#!/usr/bin/env node
/**
 * Subset conformance against the PINNED upstream.
 *
 * The Agent Script language spec is closed to outside contribution and its
 * runtime is not open source, so drift travels one way: upstream changes and we
 * absorb it. That makes a version bump the moment our supported subset can
 * quietly stop meaning what it meant — a construct that used to parse cleanly
 * starts producing diagnostics, and nothing tells us until an author hits it.
 *
 * This parses one probe per supported construct against whatever version is
 * installed and fails naming every construct whose handling changed. It is run
 * by the package's own `test` script, so a bump cannot land without it.
 *
 * TWO checks, because "still parses" is not "still means the same thing":
 *
 *   1. PARSE — the probe still parses with no diagnostics.
 *   2. KINDS — the probe still produces every node kind the construct declares,
 *      and produces no kind the declaration as a whole has never heard of.
 *
 * The second is the one that matters for a bump. `scan.ts` and `compose.ts`
 * match on kind STRINGS, so an upstream rename (`ProcedureValue` → `Procedure`,
 * a restructured `ReasoningBlock`, a moved `defaultValue`) breaks them outright
 * while every probe still parses perfectly clean. With only check 1 this script
 * exited 0 on exactly the change it exists to catch — the header claimed to
 * fail "naming every construct whose handling changed" and could only see a
 * construct that stopped parsing.
 *
 *   node scripts/check-subset-conformance.mjs [--json]
 *
 * Exit 0 when every construct still parses clean AND still produces its kinds;
 * exit 1 naming those that do not.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const asJson = process.argv.includes("--json");

/** Load the subset declaration without a TypeScript build step. */
async function loadSubset() {
	// AGENTSCRIPT_SUBSET_FILE lets a test point this at a modified declaration
	// without copying the package (pnpm's symlinked node_modules does not survive
	// a copy). Unset in every real run.
	const subsetFile = process.env.AGENTSCRIPT_SUBSET_FILE ?? join(PKG_DIR, "src/interpreter/subset.ts");
	const source = readFileSync(subsetFile, "utf8");
	const body = source.slice(source.indexOf("export const SUPPORTED_CONSTRUCTS"));
	const start = body.indexOf("[");
	const end = body.indexOf("] as const;");
	if (start < 0 || end < 0) {
		throw new Error(
			"SUPPORTED_CONSTRUCTS is no longer a plain array literal ending in `] as const;`. " +
				"This reader deliberately keeps ONE list rather than a second copy that could drift — " +
				"keep the declaration a literal, or teach this reader the new shape.",
		);
	}
	// The declaration is a plain literal by design — see subset.ts.
	return new Function(`return ${body.slice(start, end + 1)}`)();
}

/**
 * Every `__kind` in a parsed tree.
 *
 * Walks the same way the scan does — over whatever the nodes actually hold —
 * rather than over a schema, because a schema is the thing that changed.
 * `__cst` / `__keyRange` are skipped: they are position metadata, carry no
 * kinds, and make the walk needlessly large.
 */
function collectKinds(root) {
	const kinds = new Set();
	const seen = new Set();
	const walk = (value) => {
		if (value === null || typeof value !== "object" || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		if (typeof value.__kind === "string") kinds.add(value.__kind);
		for (const [key, child] of Object.entries(value)) {
			if (key === "__cst" || key === "__keyRange") continue;
			walk(child);
		}
	};
	walk(root);
	return kinds;
}

async function main() {
	const [{ parse: parseSource }, { Dialect }, dialect] = await Promise.all([
		import("@sf-agentscript/parser-javascript"),
		import("@sf-agentscript/language"),
		import("@sf-agentscript/agentforce-dialect"),
	]);

	// The PIN is what our own manifest declares; the INSTALLED version is what is
	// on disk. Reporting the pin rather than the resolved copy is deliberate —
	// not every upstream package exports its own package.json, and the pin is the
	// thing a bump actually changes.
	const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
	const pinned = Object.fromEntries(
		Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith("@sf-agentscript/")),
	);

	const constructs = await loadSubset();
	const failures = [];
	const declared = new Set(constructs.flatMap((c) => c.kinds ?? []));
	const produced = new Set();

	for (const construct of constructs) {
		try {
			const { rootNode } = parseSource(construct.probe);
			const result = new Dialect().parse(rootNode, dialect.AgentforceSchema);
			const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
			if (diagnostics.length > 0) {
				failures.push({
					id: construct.id,
					summary: construct.summary,
					diagnostics: diagnostics.map((d) => d.message ?? String(d)),
				});
				continue;
			}

			// The handling check. An empty `kinds` is itself a failure: a declared
			// empty collection is a construct every loop over it skips in silence,
			// which is how `reasoning.structured-output` sat unchecked.
			const kinds = collectKinds(result?.value ?? result);
			for (const kind of kinds) produced.add(kind);
			const claimed = construct.kinds ?? [];
			if (claimed.length === 0) {
				failures.push({
					id: construct.id,
					summary: construct.summary,
					diagnostics: [
						"declares no node kinds, so nothing about its handling is checked. " +
							`The probe produces: ${[...kinds].sort().join(", ")}`,
					],
				});
				continue;
			}
			const missing = claimed.filter((kind) => !kinds.has(kind));
			if (missing.length > 0) {
				failures.push({
					id: construct.id,
					summary: construct.summary,
					diagnostics: [
						`the pinned version no longer produces ${missing.join(", ")} for this probe. ` +
							`It produces: ${[...kinds].sort().join(", ")}. src/interpreter/scan.ts and ` +
							"compose.ts match on those strings, so this is a silent break, not a parse error.",
					],
				});
			}
		} catch (err) {
			failures.push({
				id: construct.id,
				summary: construct.summary,
				diagnostics: [`threw: ${err instanceof Error ? err.message : String(err)}`],
			});
		}
	}

	// The other direction: a kind the probes now produce that NO construct
	// declares. That is an upstream split or addition — the shape the subset
	// describes has grown a part nothing in this package has been told about.
	const undeclared = [...produced].filter((kind) => !declared.has(kind)).sort();
	if (undeclared.length > 0) {
		failures.push({
			id: "(subset)",
			summary: "node kinds the probes produce that no construct declares",
			diagnostics: [
				`${undeclared.join(", ")} — the pinned version produces these and the declaration ` +
					"names none of them. Declare them on the construct they belong to, or narrow the " +
					"probe that started producing them.",
			],
		});
	}

	if (asJson) {
		console.log(JSON.stringify({ pinned, checked: constructs.length, failures }, null, 2));
	} else {
		console.log(`Agent Script subset conformance — ${constructs.length} constructs`);
		for (const [name, version] of Object.entries(pinned)) console.log(`  pinned ${name}@${version}`);
		if (failures.length === 0) {
			console.log(
				`\nEvery supported construct still parses clean against the pinned version, and still` +
					`\nproduces every one of the ${declared.size} node kinds the declaration claims for it.`,
			);
		} else {
			console.error(`\n${failures.length} construct(s) changed handling under the installed version:`);
			for (const f of failures) {
				console.error(`\n  ✗ ${f.id} — ${f.summary}`);
				for (const d of f.diagnostics) console.error(`      ${d}`);
			}
			console.error(
				"\nThe upstream spec is closed to us, so this is absorbed, not upstreamed:" +
					"\neither narrow the declared subset in src/interpreter/subset.ts, or adapt to the" +
					"\nnew handling — but do not adopt the bump while a construct silently changed.",
			);
		}
	}

	process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(`conformance check could not run: ${err?.stack ?? err}`);
	process.exit(1);
});
