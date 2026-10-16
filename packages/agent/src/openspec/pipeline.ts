/**
 * Pipeline (`pipeline`): what Specsesh CI is handed when a task closes.
 *
 * `TestPick` is the tests an agent picked to cover one closed task: repository
 * paths (`tests`), test names (`names`) and why each test was picked
 * (`reasons`). `testPattern` turns the names into the filter Specsesh CI's
 * `{!@ci.test_pattern}` template takes; `tests` fills `{!@ci.selected_tests}`.
 *
 * These are shared with Specsesh and are being added to
 * `@specsesh/ontology/pipeline` in parallel. They are defined here, beside the
 * other ontology schemas, until that package is published; then they move
 * there and this file re-exports them. Pure: nothing here reads a file.
 */

import Type, { type Static } from "typebox";
import { Name, closed } from "./schema.js";

/** Why one test was picked. */
export const TestReason = closed({ test: Name(), why: Name() });
export type TestReason = Static<typeof TestReason>;

/** The tests picked for one closed task. `tests` are repository-relative paths. */
export const TestPick = closed({
	tests: Type.Array(Name()),
	names: Type.Array(Name()),
	reasons: Type.Array(TestReason),
});
export type TestPick = Static<typeof TestPick>;

/** Regular-expression metacharacters, and `/`, which a test runner's pattern flag may treat as a delimiter. */
const SPECIAL = /[\\^$.*+?()[\]{}|/]/g;

/** The names, each regular-expression escaped, joined with `|`; `""` for none. */
export function testPattern(names: readonly string[]): string {
	return names.map((name) => name.replace(SPECIAL, "\\$&")).join("|");
}
