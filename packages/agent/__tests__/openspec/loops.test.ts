import { describe, expect, it } from "vitest";
import {
	Action,
	type Budget,
	ChangeOutcome,
	ContextRef,
	type EscalationAnswer,
	EscalationAnswer as EscalationAnswerSchema,
	type GroupOutcome,
	GroupOutcome as GroupOutcomeSchema,
	Iteration,
	LoopInput,
	LoopOutcome,
	type LoopInput as LoopInputType,
	type Task,
	Task as TaskSchema,
	TaskGroup,
	TaskList,
	TaskOutcome,
	Verdict,
	carriedInto,
	changeTargets,
	check,
	checkFeedback,
	concludeLoop,
	feedbackFor,
	groupTargets,
	handedUp,
	judge,
	outcomeStatus,
	recordTaskRun,
	resolves,
	resume,
	startChangeOutcome,
	taskTargets,
	tick,
	toJSONSchema,
	untick,
} from "../../src/openspec/index.js";
import {
	GREEN_SUITE,
	RUN_TASK,
	STEP_REF,
	demoChange,
	fail,
	finding,
	metIteration,
	pass,
	task,
	taskConverged,
	threeRef,
	unmetIteration,
} from "./fixtures.js";

const BUDGET: Budget = { maxIterations: 3 };

/** Task 2.4, linking three CLI scenarios by name. */
const CLI_SCENARIOS = ["No command prints usage", "resume with no ID", "Non-integer task ID"].map((scenario) => ({
	capability: ["durable", "cli"],
	requirement: "The CLI refuses bad input",
	scenario,
}));
const TASK_24: Task = task(
	"2.4",
	CLI_SCENARIOS.map((target) => ({ target, basis: "scenario-named" as const, confidence: 1 as const })),
);

describe("A loop has one shape at every level", () => {
	it("Scenario: Three levels, one shape", () => {
		const levels = [
			{ goal: TaskSchema, out: TaskOutcome },
			{ goal: TaskGroup, out: GroupOutcomeSchema },
			{ goal: TaskList, out: ChangeOutcome },
		];
		const inputs = levels.map(({ goal }) => LoopInput(goal));
		const outcomes = levels.map(({ out }) => LoopOutcome(out));
		// The same constructor, differing only in the goal and the result.
		for (const input of inputs) {
			expect(Object.keys(input.properties)).toEqual(["goal", "context", "budget", "carried"]);
			expect(toJSONSchema(input.properties.carried)).toEqual(toJSONSchema(inputs[0]!.properties.carried));
			expect(input.properties.budget).toBe(inputs[0]!.properties.budget);
		}
		inputs.forEach((input, i) => expect(input.properties.goal).toBe(levels[i]!.goal));
		const strip = (schema: Parameters<typeof toJSONSchema>[0]) =>
			JSON.parse(JSON.stringify(toJSONSchema(schema), (key, value) => (key === "result" ? undefined : value)));
		for (const outcome of outcomes) expect(strip(outcome)).toEqual(strip(outcomes[0]!));
		// And each accepts its own level's values.
		expect(check(outcomes[0]!, taskConverged("2.4"))).toBe(true);
		expect(check(inputs[0]!, { goal: TASK_24, context: [], budget: BUDGET, carried: [] })).toBe(true);
	});
});

describe("A loop input carries the goal, context, budget and carried feedback", () => {
	it("Scenario: A zero budget is refused", () => {
		const input = { goal: TASK_24, context: [], budget: { maxIterations: 0 }, carried: [] };
		expect(check(LoopInput(TaskSchema), input)).toBe(false);
		expect(check(LoopInput(TaskSchema), { ...input, budget: { maxIterations: 1 } })).toBe(true);
	});
});

describe("An iteration plans, acts, gathers evidence and judges", () => {
	it("Scenario: Iterations are numbered from 1", () => {
		const three = { status: "exhausted", iterations: [1, 2, 3].map((n) => unmetIteration(n)) };
		expect(check(LoopOutcome(TaskOutcome), three)).toBe(true);
		expect(three.iterations.map((iteration) => iteration.n)).toEqual([1, 2, 3]);
		expect(check(LoopOutcome(TaskOutcome), { ...three, iterations: [0, 1, 2].map((n) => unmetIteration(n)) })).toBe(false);
		expect(check(LoopOutcome(TaskOutcome), { ...three, iterations: [1, 3, 4].map((n) => unmetIteration(n)) })).toBe(false);
	});
});

describe("An action records what an iteration did", () => {
	it("Scenario: Running the tests is a command action", () => {
		const command = "pnpm --filter agentscript-durable test";
		const action: Action = { kind: "command", summary: "run the durable tests", refs: [command] };
		expect(check(Action, action)).toBe(true);
		// The result is not stored on the action...
		expect(check(Action, { ...action, exitCode: 0 })).toBe(false);
		expect(check(Action, { ...action, output: "all passed" })).toBe(false);
		// ...but as evidence beside it.
		const iteration = { ...metIteration(1, [{ kind: "check", command, exitCode: 0, output: "" }]), actions: [action] };
		expect(check(Iteration, iteration)).toBe(true);
	});

	it("Scenario: An unknown action kind is refused", () => {
		expect(check(Action, { kind: "think", summary: "ponder", refs: [] })).toBe(false);
	});
});

describe("A context reference names what a loop reads", () => {
	it("Scenario: A context reference to a spec item can be checked", () => {
		const dangling: ContextRef = { kind: "scenario", ref: "durable/run-task › The step number is the index of the step being run › No such scenario" };
		expect(check(ContextRef, dangling)).toBe(true);
		expect(resolves(dangling, [RUN_TASK])).toBe(false);
		const real: ContextRef = { kind: "scenario", ref: "durable/run-task › The step number is the index of the step being run › The first and second model steps are numbered 0 and 1" };
		expect(resolves(real, [RUN_TASK])).toBe(true);
		expect(resolves({ kind: "capability", ref: "durable/run-task" }, [RUN_TASK])).toBe(true);
		expect(resolves({ kind: "capability", ref: "durable/nope" }, [RUN_TASK])).toBe(false);
		// A ref of the wrong shape for its kind is refused outright.
		expect(check(ContextRef, { kind: "scenario", ref: "durable/run-task" })).toBe(false);
		expect(check(ContextRef, { kind: "file", ref: "packages/agent/src/openspec/model.ts" })).toBe(true);
	});
});

describe("A verdict lists satisfied and unmet targets", () => {
	it("Scenario: One unmet target means not met", () => {
		const verdict = judge([threeRef("one"), threeRef("two"), threeRef("three")], [pass(threeRef("one")), pass(threeRef("two"))]);
		expect(verdict.satisfied).toHaveLength(2);
		expect(verdict.unmet).toHaveLength(1);
		expect(verdict.met).toBe(false);
		expect(check(Verdict, verdict)).toBe(true);
		expect(check(Verdict, { ...verdict, met: true })).toBe(false);
		expect(check(Verdict, { met: false, satisfied: [], unmet: [] })).toBe(false);
	});
});

describe("Feedback names a finding and an action", () => {
	it("Scenario: An unmet target produces feedback", () => {
		const iteration = unmetIteration(1);
		expect(check(Iteration, iteration)).toBe(true);
		expect(iteration.feedback.some((item) => item.from.target === STEP_REF)).toBe(true);
		expect(check(Iteration, { ...iteration, feedback: [] })).toBe(false);
		expect(check(Iteration, { ...iteration, feedback: [{ from: finding("code-defect", threeRef("one")), action: "retry" }] })).toBe(false);
	});
});

describe("A loop outcome has one of four statuses", () => {
	it("Scenario: A converged loop carries its result", () => {
		const outcome = taskConverged("2.4");
		expect(check(LoopOutcome(TaskOutcome), outcome)).toBe(true);
		const { result: _, ...noResult } = outcome;
		expect(check(LoopOutcome(TaskOutcome), noResult)).toBe(false);
		const escalation = { level: "task", to: "principal", reason: "r", question: "q?" };
		expect(check(LoopOutcome(TaskOutcome), { ...outcome, escalation })).toBe(false);
		expect(concludeLoop({ level: "task", iterations: [metIteration(1)], budget: BUDGET, result: outcome.result })).toEqual({
			status: "converged",
			iterations: [metIteration(1)],
			result: outcome.result,
		});
	});
});

describe("Each status has one cause", () => {
	it("Scenario: The budget runs out", () => {
		const iterations = [1, 2, 3].map((n) => unmetIteration(n));
		expect(outcomeStatus(iterations.slice(0, 2), BUDGET)).toBeUndefined();
		expect(outcomeStatus(iterations, BUDGET)).toBe("exhausted");
		const outcome = concludeLoop({ level: "task", iterations, budget: BUDGET });
		expect(outcome).toMatchObject({ status: "exhausted" });
		expect(outcome?.iterations).toHaveLength(3);
		// The other causes.
		expect(outcomeStatus([unmetIteration(1), metIteration(2)], BUDGET)).toBe("converged");
		expect(outcomeStatus([unmetIteration(1, "ask", "needs-decision")], BUDGET)).toBe("blocked");
		expect(outcomeStatus([unmetIteration(1)], BUDGET, new Error("disk full"))).toBe("failed");
		expect(outcomeStatus([], BUDGET)).toBeUndefined();
	});
});

describe("An escalation names who must decide and what", () => {
	it("Scenario: A task loop escalates", () => {
		const outcome = concludeLoop({ level: "task", iterations: [unmetIteration(1, "ask", "needs-decision")], budget: BUDGET });
		expect(outcome?.status).toBe("blocked");
		expect(outcome?.status === "blocked" && outcome.escalation.level).toBe("task");
		expect(check(LoopOutcome(TaskOutcome), outcome)).toBe(true);
	});

	it("Scenario: An escalation can go to an agent", () => {
		const outcome = concludeLoop({ level: "task", iterations: [unmetIteration(1, "ask", "test-defect")], budget: BUDGET, to: "agent" });
		expect(outcome?.status).toBe("blocked");
		expect(outcome?.status === "blocked" && outcome.escalation.to).toBe("agent");
		expect(check(LoopOutcome(TaskOutcome), outcome)).toBe(true);
	});
});

describe("An answered escalation resumes the loop", () => {
	it("Scenario: A blocked task loop resumes with the answer", () => {
		const input: LoopInputType<Task> = { goal: TASK_24, context: [], budget: BUDGET, carried: [] };
		const blocked = concludeLoop({ level: "task", iterations: [unmetIteration(1, "ask", "needs-decision")], budget: BUDGET })!;
		const before = structuredClone(blocked);
		const retry = { from: finding("needs-decision", STEP_REF), action: "retry" as const };
		const answer: EscalationAnswer = {
			escalation: (blocked as Extract<typeof blocked, { status: "blocked" }>).escalation,
			by: "principal",
			decision: "keep the current behaviour",
			feedback: [retry],
		};
		const resumed = resume(input, answer);
		expect(resumed).toEqual({ ok: true, value: { ...input, carried: [retry] } });
		expect(resumed.ok && check(LoopInput(TaskSchema), resumed.value)).toBe(true);
		// The earlier run stays recorded as it was.
		expect(blocked).toEqual(before);
		expect(input.carried).toEqual([]);
	});

	it("Scenario: Only the named recipient answers", () => {
		const escalation = { level: "task" as const, to: "principal" as const, reason: "r", question: "Which behaviour is intended?" };
		const answer = { escalation, by: "agent" as const, decision: "d", feedback: [] };
		expect(check(EscalationAnswerSchema, answer)).toBe(false);
		expect(check(EscalationAnswerSchema, { ...answer, by: "principal" })).toBe(true);
		expect(resume({ goal: TASK_24, context: [], budget: BUDGET, carried: [] }, answer).ok).toBe(false);
	});
});

describe("The task loop drives one task to its targets", () => {
	it("Scenario: A task's targets are its links", () => {
		expect(taskTargets(TASK_24)).toEqual(CLI_SCENARIOS);
		const verdict = judge(taskTargets(TASK_24), [pass(CLI_SCENARIOS[0]!), pass(STEP_REF)]);
		const judged = [...verdict.satisfied, ...verdict.unmet.map((u) => u.target)];
		expect(judged).toHaveLength(3);
		expect(judged).toEqual(expect.arrayContaining(CLI_SCENARIOS));
		expect(judged).not.toContainEqual(STEP_REF);
	});
});

describe("The group loop drives one feature set", () => {
	it("Scenario: A regression fails the group check", () => {
		const S = STEP_REF;
		const group2 = { number: 2, title: "Two", tasks: [TASK_24] };
		const targets = groupTargets(group2, [S]);
		expect(targets).toContainEqual(S);
		const verdict = judge(targets, [...CLI_SCENARIOS.map(pass), fail(S)]);
		expect(verdict.unmet.map((u) => u.target)).toEqual([S]);
		expect(verdict.met).toBe(false);
	});
});

describe("The change loop makes the spec real", () => {
	it("Scenario: An unclaimed scenario is still a target", () => {
		const change = demoChange({ groups: [{ number: 1, title: "One", tasks: [task("1.1")] }] });
		const targets = changeTargets(change);
		for (const ref of ["one", "two", "three"].map(threeRef)) expect(targets).toContainEqual(ref);
		expect(targets).toContainEqual({ check: "strict validation" });
		expect(targets).toContainEqual({ check: "full suite" });
	});
});

describe("A group outcome has one entry per task", () => {
	it("Scenario: A reworked task appears once", () => {
		let group: GroupOutcome = { group: 2, tasks: [] };
		group = recordTaskRun(group, "2.4", taskConverged("2.4"));
		const second = taskConverged("2.4", 2);
		group = recordTaskRun(group, "2.4", second);
		expect(group.tasks).toHaveLength(1);
		expect(group.tasks[0]).toEqual({ task: "2.4", outcome: second, runs: 2 });
		expect(check(GroupOutcomeSchema, group)).toBe(true);
		expect(check(GroupOutcomeSchema, { ...group, tasks: [...group.tasks, ...group.tasks] })).toBe(false);
	});

	it("Scenario: A task ticked before the group loop has no runs", () => {
		const ticked = { task: "2.1", outcome: { status: "converged", iterations: [], result: { task: "2.1", ticked: true } }, runs: 0 };
		expect(check(GroupOutcomeSchema, { group: 2, tasks: [ticked] })).toBe(true);
		expect(check(GroupOutcomeSchema, { group: 2, tasks: [{ ...ticked, runs: -1 }] })).toBe(false);
	});

	it("Scenario: A task that never converged is still listed", () => {
		const exhausted = concludeLoop<{ task: string; ticked: boolean }>({ level: "task", iterations: [1, 2, 3].map((n) => unmetIteration(n)), budget: BUDGET })!;
		const group = recordTaskRun({ group: 2, tasks: [] }, "2.4", exhausted);
		expect(group.tasks).toHaveLength(1);
		expect(group.tasks[0]!.outcome.status).toBe("exhausted");
		expect(check(GroupOutcomeSchema, group)).toBe(true);
	});
});

describe("The change loop reports its groups and what was unclaimed", () => {
	it("Scenario: Unclaimed scenarios are reported", () => {
		// Two scenarios unclaimed at the start; the change check adds tasks for them.
		const start = demoChange({
			groups: [{ number: 1, title: "One", tasks: [task("1.1", [{ target: threeRef("one"), basis: "scenario-named", confidence: 1 }])] }],
		});
		const outcome = startChangeOutcome(start);
		expect(outcome.unclaimed).toEqual([threeRef("two"), threeRef("three")]);
		const added = demoChange({
			groups: [
				{
					number: 1,
					title: "One",
					tasks: ["one", "two", "three"].map((s, i) => task(`1.${i + 1}`, [{ target: threeRef(s), basis: "scenario-named", confidence: 1 }])),
				},
			],
		});
		expect(startChangeOutcome(added).unclaimed).toEqual([]);
		// The outcome keeps what was unclaimed when execution started.
		expect(check(ChangeOutcome, outcome)).toBe(true);
	});
});

describe("Feedback retries inside a loop", () => {
	it("Scenario: A failing test is retried", () => {
		const iteration = unmetIteration(1, "retry");
		expect(carriedInto(iteration)).toEqual(iteration.feedback);
		// It does not leave the loop, even when the loop ends.
		const exhausted = concludeLoop({ level: "task", iterations: [iteration], budget: { maxIterations: 1 } })!;
		expect(exhausted.status).toBe("exhausted");
		expect(handedUp(exhausted)).toEqual([]);
	});
});

describe("Feedback rises to the enclosing loop", () => {
	it("Scenario: A group check adds a task", () => {
		const uncovered = threeRef("one");
		const group = { number: 2, title: "Two", tasks: [TASK_24] };
		const verdict = judge([...groupTargets(group), uncovered], [...CLI_SCENARIOS.map(pass), GREEN_SUITE]);
		const feedback = checkFeedback(group.tasks, verdict, [GREEN_SUITE]);
		expect(feedback).toEqual([expect.objectContaining({ action: "add-task" })]);
		expect(feedback[0]!.from.target).toEqual(uncovered);
		// A linked target that regressed is reworked instead.
		const regressed = judge(groupTargets(group), [pass(CLI_SCENARIOS[0]!), pass(CLI_SCENARIOS[1]!), fail(CLI_SCENARIOS[2]!)]);
		expect(checkFeedback(group.tasks, regressed, [fail(CLI_SCENARIOS[2]!)]).map((f) => f.action)).toEqual(["rework-task"]);
		// A blocked task loop's outcome rises with its question.
		const blocked = concludeLoop({ level: "task", iterations: [unmetIteration(1, "ask", "needs-decision")], budget: BUDGET })!;
		expect(handedUp(blocked).map((f) => f.action)).toEqual(["ask"]);
	});
});

describe("A spec defect leaves the loops as an amendment", () => {
	it("Scenario: The 2026-10-11 amendment", () => {
		const defect = {
			...finding("spec-defect", STEP_REF, [fail(STEP_REF)]),
			message: "run is specced to throw UndeclaredVariableError, but the dialect's lint refuses the script first",
		};
		const feedback = feedbackFor(defect);
		expect(feedback.action).toBe("amend-spec");
		const iteration = { ...unmetIteration(1), feedback: [feedback] };
		const outcome = concludeLoop({ level: "change", iterations: [iteration], budget: BUDGET })!;
		expect(outcome.status).toBe("blocked");
		expect(outcome.status === "blocked" && outcome.escalation).toMatchObject({ level: "change", to: "principal", question: defect.message });
		// The remedy is the spec, not the code: nothing in the outcome retries or reworks.
		expect(handedUp(outcome).map((f) => f.action)).toEqual(["amend-spec"]);
	});
});

describe("A question goes to the escalation's recipient", () => {
	it("Scenario: A needs-decision finding blocks", () => {
		const decision = { ...finding("needs-decision", STEP_REF, [fail(STEP_REF)]), message: "Should nested ifs be refused or allowed?" };
		const feedback = feedbackFor(decision);
		expect(feedback.action).toBe("ask");
		const outcome = concludeLoop({ level: "group", iterations: [{ ...unmetIteration(1), feedback: [feedback] }], budget: BUDGET })!;
		expect(outcome.status).toBe("blocked");
		expect(outcome.status === "blocked" && outcome.escalation.question).toBe("Should nested ifs be refused or allowed?");
		expect(outcome.status === "blocked" && outcome.escalation.to).toBe("principal");
	});
});

describe("Only a converged task loop ticks its box", () => {
	it("Scenario: A passing summary line does not tick", () => {
		const list = { groups: [{ number: 2, title: "Two", tasks: [TASK_24] }] };
		// The runner printed "all passed", but no test claims the task's scenarios.
		const verdict = judge(taskTargets(TASK_24), [GREEN_SUITE]);
		expect(verdict.met).toBe(false);
		const iterations = [1, 2, 3].map((n) => ({
			...metIteration(n, [GREEN_SUITE]),
			verdict,
			feedback: verdict.unmet.map(({ target }) => feedbackFor(finding("code-defect", target))),
		}));
		const outcome = concludeLoop<{ task: string; ticked: boolean }>({ level: "task", iterations, budget: BUDGET, result: { task: "2.4", ticked: true } })!;
		expect(outcome.status).toBe("exhausted");
		expect(tick(list, outcome).groups[0]!.tasks[0]!.done).toBe(false);
		// Converged, it ticks.
		expect(tick(list, taskConverged("2.4")).groups[0]!.tasks[0]!.done).toBe(true);
	});
});

describe("Rework unticks a task", () => {
	it("Scenario: A regressed task is reopened", () => {
		const list = { groups: [{ number: 2, title: "Two", tasks: [{ ...TASK_24, done: true }] }] };
		const verdict = judge(taskTargets(TASK_24), [fail(CLI_SCENARIOS[0]!), pass(CLI_SCENARIOS[1]!), pass(CLI_SCENARIOS[2]!)]);
		const [rework] = checkFeedback(list.groups[0]!.tasks, verdict, [fail(CLI_SCENARIOS[0]!)]);
		expect(rework!.action).toBe("rework-task");
		const reopened = untick(list, "2.4");
		expect(reopened.groups[0]!.tasks[0]!.done).toBe(false);
		expect(list.groups[0]!.tasks[0]!.done).toBe(true);
		// Only a converged run ticks it again.
		expect(tick(reopened, { status: "exhausted", iterations: [unmetIteration(1)] }).groups[0]!.tasks[0]!.done).toBe(false);
		expect(tick(reopened, taskConverged("2.4", 2)).groups[0]!.tasks[0]!.done).toBe(true);
	});
});
