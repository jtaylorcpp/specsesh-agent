// Host flow: run a group, surface the judge's amendment, resume once applied.
import {
  startGroupLoop,
  waitForGroupLoop,
  answerGroupEscalation,
  groupLoopExtensions,
} from "@specsesh/agent/task";

const options = {
  change: "add-queue",
  group: 1,
  checks: ["pnpm test"],
  escalateTo: "principal",
};
// install groupLoopExtensions(options) on the harness before starting

const id = await startGroupLoop(harness, options, ctx);
let outcome = await waitForGroupLoop(harness, id, ctx);

if (outcome.status === "blocked" && outcome.escalation.amendment) {
  // exactly what the judge proposed; delta is relative to the change dir
  const { delta, text } = outcome.escalation.amendment; // e.g. "specs/task/queue/spec.md"
  const file = `openspec/changes/${options.change}/${delta}`;
  console.log(`Judge proposes replacing ${file}:\n${text}`);

  // The principal reviews and writes `text` to `file` (by hand here;
  // add-spec-amendments-cli will do this step). This change never writes it.
  await reviewAndApply(file, text);

  await answerGroupEscalation(
    harness,
    id,
    { by: "principal", decision: "amendment-applied" },
    ctx,
  );
  outcome = await waitForGroupLoop(harness, id, ctx); // deltas re-read, check reruns
} else if (outcome.status === "blocked") {
  // ask, or amend-spec whose amendment was dropped (empty amend_path / blank amend_text):
  // answer the question with an ordinary decision.
  console.log(outcome.escalation.question);
}

console.log(outcome.status);
