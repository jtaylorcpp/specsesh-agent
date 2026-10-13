/**
 * The tasks stage's gate, the part with no `openspec` call: `tasks.md` read as
 * the ontology's `TaskList` with no task ticked, each task's claims (the
 * scenario names it quotes), the scenarios no task claims, and the change's
 * groups and tasks limits. Pure rules over the file and the deltas `openspec
 * show` parsed.
 */

import {
	type Change,
	type ScenarioRef,
	type Task,
	type TaskGroup,
	TaskList,
	explain,
	formatRef,
	sizeIssues,
} from "../../openspec/index.js";
import type { StageIssue } from "../spec-stage.js";
import { taskLines } from "../tasks-md.js";
import type { Delta } from "./openspec-cli.js";

const TASKS = "tasks.md";
const GROUP_HEADING = /^## ([1-9][0-9]*)\. (.+)$/;

const error = (message: string): StageIssue => ({ level: "ERROR", path: TASKS, message });

/** The groups and their tasks, and an `ERROR` per line, ticked task or `TaskList` rule that fails. */
export interface ReadTaskList {
	readonly groups: TaskGroup[];
	readonly tasks: Task[];
	readonly issues: StageIssue[];
}

/**
 * `tasks.md` as `## <n>. <title>` groups of `- [ ] <id> <text>` tasks. Text
 * before the first heading is ignored; under a heading, a blank line, or an
 * indented one after a task (its continuation, joined to its text), is allowed,
 * and any other line is an `ERROR` naming its line number.
 */
export function readTaskList(md: string): ReadTaskList {
	const groups: { number: number; title: string; tasks: Task[] }[] = [];
	const issues: StageIssue[] = [];
	let task: Task | undefined;
	md.split(/\r?\n/).forEach((line, i) => {
		const heading = GROUP_HEADING.exec(line);
		if (heading !== null) {
			groups.push({ number: Number(heading[1]), title: heading[2] as string, tasks: [] });
			task = undefined;
			return;
		}
		const group = groups.at(-1);
		if (group === undefined || line.trim() === "") return;
		const [parsed] = taskLines(line);
		if (parsed !== undefined) {
			task = { id: parsed.id, text: parsed.text, done: parsed.done, files: [], links: [] };
			group.tasks.push(task);
			if (parsed.done) issues.push(error(`task ${parsed.id} is ticked; a planned task starts as \`- [ ]\``));
			return;
		}
		if (task !== undefined && /^\s/.test(line)) {
			task.text = `${task.text}\n${line.trim()}`;
			return;
		}
		issues.push(error(`tasks.md line ${i + 1} is neither a \`- [ ] <n>.<m> <text>\` task nor its continuation`));
	});
	const list = { groups };
	issues.push(...explain(TaskList, list).map((reason) => error(`tasks.md is not a task list: ${reason}`)));
	return { groups, tasks: groups.flatMap((group) => group.tasks), issues };
}

/** Every scenario of an ADDED or MODIFIED delta, in delta order. */
export function scenarioNames(deltas: readonly Delta[]): ScenarioRef[] {
	return deltas
		.filter((delta) => delta.operation === "ADDED" || delta.operation === "MODIFIED")
		.flatMap((delta) =>
			delta.requirement.scenarios.flatMap((scenario): ScenarioRef[] => {
				const name = (scenario as { name?: unknown } | null)?.name;
				return typeof name === "string" && name !== ""
					? [{ capability: delta.spec.split("/"), requirement: delta.requirement.name, scenario: name }]
					: [];
			}),
		);
}

/** True when the task's text holds the scenario's exact name in double quotes. */
const quotes = (task: Task, scenario: ScenarioRef): boolean => task.text.includes(`"${scenario.scenario}"`);

/** The task with a `scenario-named` link to each scenario it quotes, so `taskIssues` counts its claims. */
export function withClaims(task: Task, scenarios: readonly ScenarioRef[]): Task {
	const links = scenarios
		.filter((scenario) => quotes(task, scenario))
		.map((target) => ({ target, basis: "scenario-named" as const, confidence: 1 as const }));
	return { ...task, links: [...task.links, ...links] };
}

/** An `ERROR` per scenario no task quotes, naming the scenario and its capability. */
export function unclaimed(scenarios: readonly ScenarioRef[], tasks: readonly Task[]): StageIssue[] {
	return scenarios
		.filter((scenario) => !tasks.some((task) => quotes(task, scenario)))
		.map((scenario) => error(`no task names "${scenario.scenario}" (${formatRef(scenario.capability)})`));
}

/**
 * The task list as the ontology's `Change`, enough for `sizeIssues` to count
 * groups and tasks: no proposal capabilities, no deltas. Only for counting.
 */
export function asChange(list: Pick<ReadTaskList, "groups">): Change {
	return {
		id: "draft",
		schema: "spec-driven",
		state: "drafting",
		proposal: { why: "", whatChanges: [], capabilities: { new: [], modified: [] }, outOfScope: [], impact: [] },
		deltas: [],
		tasks: { groups: list.groups },
	};
}

/** True for a groups or tasks issue: the other limits are the specs stage's to check. */
export const onlyTasks = (issue: StageIssue): boolean => issue.path === TASKS;

/** The size `WARNING`s for groups and tasks. */
export function taskBudgetIssues(list: Pick<ReadTaskList, "groups">): StageIssue[] {
	return sizeIssues(asChange(list)).filter(onlyTasks);
}
