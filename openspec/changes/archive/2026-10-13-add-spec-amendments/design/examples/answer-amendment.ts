// A host that runs one task loop and answers an amend-spec block.
// Slice 1 only: the principal writes the delta themselves before answering
// "amendment-applied". Slice 3's `pnpm change build <change> --amend` will
// write, validate and answer in one step.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startTaskLoop,
  waitForTaskLoopResult,
  answerEscalation,
  taskLoopExtensions,
} from "@specsesh/agent/task";
import { makeHarness, makeContext } from "./host"; // the host's own wiring

const changeDir = "openspec/changes/demo-change";
const harness = makeHarness(taskLoopExtensions({ workspace: ".", checks: ["pnpm test"], allow: ["pnpm"] }));
const context = makeContext();

const id = await startTaskLoop(harness, { change: { dir: changeDir }, task: "1.4", workspace: "." }, context);
const { outcome, notes } = await waitForTaskLoopResult(harness, id, context);

if (outcome.status === "blocked" && outcome.escalation) {
  const escalation = outcome.escalation;
  console.log(escalation.question);
  for (const n of notes) console.log("note:", n); // e.g. "amendment dropped: amend_text is empty"

  if (escalation.amendment) {
    // The principal reads the proposal and decides to apply it.
    // delta is relative to the change directory: "specs/<capability>/spec.md".
    await writeFile(join(changeDir, escalation.amendment.delta), escalation.amendment.text);

    await answerEscalation(harness, id, {
      escalation,
      by: "principal",
      decision: "amendment-applied", // carried becomes: "The principal applied your amendment to <delta>. That delta now reads: …"
      feedback: [],
    }, context);
  } else {
    // No amendment (an ask, or a dropped one): answer with text, exactly as today.
    await answerEscalation(harness, id, {
      escalation,
      by: "principal",
      decision: "Keep the spec; make run check variables before the lint.",
      feedback: [],
    }, context);
  }
}
