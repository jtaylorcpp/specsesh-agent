/**
 * A durable run's `RunEvent`s, read from a harness that runs it.
 *
 * `watchScript` follows the run's checkpoint through the harness's task graph
 * watch: the graph carries each live task's phase and status, so every
 * transition that matters (a step dispatched or applied, an action entered or
 * folded in, the end) changes the run's node there. On each change the watcher
 * re-reads the task and diffs it against what it has already reported, so frames
 * pi-durable coalesces lose nothing. While a step is awaited, its own
 * conversation's agent events give the deltas and tool calls.
 *
 * Watching only reads. Each watcher has its own unbounded queue.
 */

import {
	start,
	type ActionReport,
	type RunEvent,
	type RunResult,
	type RunState,
	type RunStream,
	type StepReport,
} from "../interpreter/index.js";
import type { Context } from "@earendil-works/chord";
import {
	watchEvents,
	type AgentEvent,
	type AgentEventStream,
	type ConversationId,
	type EntryRecord,
	type Harness,
	type TaskGraphWatch,
	type TaskId,
} from "@earendil-works/pi-durable";
import { AgentScriptRun, AgentScriptStepActions, RESULT_TOOL, type RunCheckpoint, type RunInput } from "./extension.js";
import { waitForScript } from "./host.js";

/** A durable run's events, for `for await`, and its result. Iterable once. */
export interface ScriptWatch extends RunStream {
	/** Detach this watcher and end its iterator. The run is untouched. */
	stop(): Promise<void>;
}

type Block = { readonly type: string; readonly text?: string; readonly thinking?: string };

/** What a task record says about the run: its settled steps and actions, and the checkpoint while live. */
interface Seen {
	readonly steps: readonly StepReport[];
	readonly actions: readonly ActionReport[];
	readonly checkpoint?: RunCheckpoint;
	readonly terminal: boolean;
}

/**
 * Follow run `id` on `harness`. A watcher attached late first gets the run's
 * history: `step_start` and `step_end` per applied step and `action_start` and
 * `action_end` per settled action, without deltas, then the in-flight step's
 * text so far as one `text_delta`, then live events. `result` settles as
 * `waitForScript(harness, id, context)` would.
 */
export function watchScript(harness: Harness, id: TaskId<RunResult>, context: Context): ScriptWatch {
	const queue: RunEvent[] = [];
	let done = false;
	let failure: { readonly error: unknown } | undefined;
	let wake: (() => void) | undefined;
	const rouse = (): void => {
		const resolve = wake;
		wake = undefined;
		resolve?.();
	};
	const emit = (event: RunEvent): void => {
		if (done || failure !== undefined) return;
		queue.push(event);
		rouse();
	};

	let resolveResult!: (value: Promise<RunResult>) => void;
	const result = new Promise<RunResult>((resolve) => {
		resolveResult = resolve;
	});
	let resultSettled = false;
	const settleResult = (value: Promise<RunResult>): void => {
		value.catch(() => undefined);
		if (resultSettled) return;
		resultSettled = true;
		resolveResult(value);
	};
	// Never an unhandled rejection: the caller may only iterate.
	result.catch(() => undefined);

	let graph: TaskGraphWatch | undefined;
	let conversation: AgentEventStream | undefined;
	/** Bumped whenever the step conversation changes, so a stale stream's events are dropped. */
	let token = 0;

	const detach = async (): Promise<void> => {
		token += 1;
		const watches = [graph?.stop(), conversation?.stop()];
		graph = undefined;
		conversation = undefined;
		await Promise.all(watches);
	};
	const finish = (): void => {
		if (done || failure !== undefined) return;
		done = true;
		void detach();
		rouse();
	};
	const fail = (error: unknown): void => {
		if (done || failure !== undefined) return;
		failure = { error };
		void detach();
		rouse();
	};

	// Every reaction runs in arrival order, one at a time.
	let chain: Promise<void> = Promise.resolve();
	const serial = (work: () => Promise<void> | void): Promise<void> => {
		chain = chain.then(async () => {
			if (done || failure !== undefined) return;
			await work();
		}).catch(fail);
		return chain;
	};

	// What this watcher has reported.
	let entries: readonly string[] = [];
	let sentSteps = 0;
	let sentActions = 0;
	let openStep: number | undefined;
	let openSubagent = "";
	let openConversation: ConversationId | undefined;
	let openAction: number | undefined;
	let stepText = "";
	// The in-flight assistant message as the conversation's events rebuild it, and what of it was sent.
	let blocks: Block[] | undefined;
	let messageText = "";
	let messageThinking = "";

	const tag = (): { step: number; subagent: string } => ({ step: openStep ?? sentSteps, subagent: openSubagent });

	const sendText = (delta: string): void => {
		if (delta === "" || openStep === undefined) return;
		stepText += delta;
		emit({ type: "text_delta", delta, ...tag() });
	};
	const sendThinking = (delta: string): void => {
		if (delta === "" || openStep === undefined) return;
		emit({ type: "thinking_delta", delta, ...tag() });
	};
	/** Send what the rebuilt message holds beyond what was sent. A rewrite of sent text sends nothing. */
	const syncMessage = (): void => {
		if (blocks === undefined) return;
		const text = textOf(blocks, "text");
		if (text.startsWith(messageText)) sendText(text.slice(messageText.length));
		messageText = text;
		const thinking = textOf(blocks, "thinking");
		if (thinking.startsWith(messageThinking)) sendThinking(thinking.slice(messageThinking.length));
		messageThinking = thinking;
	};

	const onConversation = async (events: readonly AgentEvent[], conversationId: ConversationId): Promise<void> => {
		for (const event of events) {
			switch (event.type) {
				case "snapshot":
					// An overflow replaced undelivered batches: catch up from the newest view.
					sendText(remainder(assistantText(event.entries) + textOf(event.generation?.message?.content ?? [], "text"), stepText));
					blocks = event.generation?.message !== undefined ? [...event.generation.message.content] : undefined;
					messageText = textOf(blocks ?? [], "text");
					messageThinking = textOf(blocks ?? [], "thinking");
					break;
				case "message_start":
					if (event.message.role !== "assistant") break;
					blocks = [...event.message.content];
					messageText = "";
					messageThinking = "";
					syncMessage();
					break;
				case "message_update":
					if (blocks === undefined) blocks = [];
					for (const change of event.changes) {
						if (change.type === "message") blocks = [...change.message.content];
						else if (change.type === "text_delta" || change.type === "thinking_delta") {
							const field = change.type === "text_delta" ? "text" : "thinking";
							const block = blocks[change.contentIndex] ?? { type: field };
							blocks[change.contentIndex] = { ...block, [field]: (block[field] ?? "") + change.delta };
						} else if ("block" in change) blocks[change.contentIndex] = change.block;
					}
					syncMessage();
					break;
				case "message_end": {
					const content = (event.entry.model ?? []).flatMap((message) => (message.role === "assistant" ? message.content : []));
					if (content.length === 0 && blocks === undefined) break;
					if ((event.entry.model ?? []).some((message) => message.role === "assistant")) {
						blocks = [...content];
						syncMessage();
					}
					blocks = undefined;
					messageText = "";
					messageThinking = "";
					break;
				}
				case "tool_execution_start": {
					if (event.toolName === RESULT_TOOL) break;
					// The model's arguments overlaid with the offer's bound inputs, as the call will run and as the pi port reports it.
					const doc = await harness.snapshot(AgentScriptStepActions, conversationId, context);
					const offer = doc?.offers?.find((o) => o["name"] === event.toolName) as { bound?: Record<string, unknown> } | undefined;
					emit({ type: "tool_call", name: event.toolName, inputs: { ...event.args, ...(offer?.bound ?? {}) }, ...tag() });
					break;
				}
				case "tool_execution_end": {
					if (event.toolName === RESULT_TOOL) break;
					// As the step's `toolCalls` will record it: outputs from the step-actions doc, `{}` when not ok.
					const doc = await harness.snapshot(AgentScriptStepActions, conversationId, context);
					const ran = doc?.calls?.[event.toolCallId] as { outputs?: Record<string, unknown> } | undefined;
					const message = event.entry?.model?.[0];
					const isError = message?.role === "toolResult" ? message.isError : event.entry === undefined;
					const ok = !isError && ran?.outputs !== undefined;
					const text =
						message?.role === "toolResult"
							? message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
							: "the tool did not finish";
					emit({
						type: "tool_result",
						name: event.toolName,
						ok,
						outputs: ok ? (ran?.outputs ?? {}) : {},
						...(ok ? {} : { message: text }),
						...tag(),
					});
					break;
				}
			}
		}
	};

	const closeConversation = (): void => {
		token += 1;
		void conversation?.stop();
		conversation = undefined;
		openConversation = undefined;
		blocks = undefined;
		messageText = "";
		messageThinking = "";
	};

	const startStep = async (step: number, subagent: string, conversationId: ConversationId): Promise<void> => {
		closeConversation();
		openStep = step;
		openSubagent = subagent;
		openConversation = conversationId;
		stepText = "";
		emit({ type: "step_start", step, subagent });
		const mine = token;
		const stream = await watchEvents(harness, conversationId, context);
		if (mine !== token || done || failure !== undefined) {
			void stream.stop();
			return;
		}
		conversation = stream;
		// The step's text so far, as one delta: earlier answers in this conversation, then the in-flight partial.
		const partial = stream.snapshot.generation?.message;
		sendText(assistantText(stream.snapshot.entries) + textOf(partial?.content ?? [], "text"));
		sendThinking(textOf(partial?.content ?? [], "thinking"));
		blocks = partial !== undefined ? [...partial.content] : undefined;
		messageText = textOf(blocks ?? [], "text");
		messageThinking = textOf(blocks ?? [], "thinking");
		stream.start((events) => serial(() => (mine === token ? onConversation(events, conversationId) : undefined)));
	};

	const endStep = (index: number, report: StepReport): void => {
		if (openStep !== index) {
			closeConversation();
			emit({ type: "step_start", step: index, subagent: report.subagent });
		} else if (report.outcome.kind === "answered") {
			// Commits the conversation watch had not delivered yet: the outcome's text is the truth.
			sendText(remainder(report.outcome.text, stepText));
		}
		closeConversation();
		openStep = undefined;
		stepText = "";
		emit({ type: "step_end", step: index, subagent: report.subagent, outcome: report.outcome });
		sentSteps = index + 1;
	};

	const endAction = (index: number, step: number, report: ActionReport): void => {
		const { subagent, action, tool, inputs } = report.call;
		if (openAction !== index) emit({ type: "action_start", step, subagent, action, tool, inputs });
		openAction = undefined;
		const ok = report.result.ok;
		const outputs = report.result.ok ? report.result.outputs : {};
		emit({ type: "action_end", step, subagent, action, tool, ok, outputs });
		sentActions = index + 1;
	};

	/** Report everything `seen` holds beyond what was reported, in the order `run` reports it. */
	const report = async (seen: Seen): Promise<void> => {
		for (const item of order(entries, seen.steps, seen.actions)) {
			if (item.kind === "step" && item.index >= sentSteps) endStep(item.index, seen.steps[item.index] as StepReport);
			if (item.kind === "action" && item.index >= sentActions) {
				endAction(item.index, item.step, seen.actions[item.index] as ActionReport);
			}
		}
		if (seen.terminal) {
			emit({ type: "run_end", result: await result });
			finish();
			return;
		}
		const checkpoint = seen.checkpoint;
		if (checkpoint?.phase === "await" && checkpoint.step === sentSteps && checkpoint.conversationId !== openConversation) {
			await startStep(checkpoint.step, checkpoint.state.awaiting?.subagent ?? "", checkpoint.conversationId);
		}
		const awaiting = checkpoint?.state.awaiting;
		if (checkpoint?.phase === "act" && openAction !== sentActions && awaiting !== undefined && "call" in awaiting) {
			const { subagent, action, tool, inputs } = awaiting.call;
			emit({ type: "action_start", step: sentSteps, subagent, action, tool, inputs });
			openAction = sentActions;
		}
	};

	const read = async (): Promise<Seen | undefined> => {
		const record = await harness.getTask(id, context);
		if (record === undefined) return undefined;
		const status = record.state.status;
		if (status === "terminal" || status === "completing") {
			const outcome = record.state.outcome;
			const settled = outcome.status === "completed" ? (outcome.result as unknown as RunResult) : undefined;
			return { steps: settled?.steps ?? [], actions: settled?.actions ?? [], terminal: status === "terminal" };
		}
		const checkpoint = record.state.checkpoint as unknown as RunCheckpoint;
		return { steps: checkpoint.state.steps, actions: checkpoint.state.actions, checkpoint, terminal: false };
	};

	const attach = async (): Promise<void> => {
		const record = await harness.getTask(id, context);
		if (record === undefined) {
			const refused = waitForScript(harness, id, context).then(() => {
				throw new Error(`agentscript run ${String(id)} does not exist`);
			});
			settleResult(refused);
			await refused;
			return;
		}
		if (record.kind !== AgentScriptRun.definition.name) {
			const error = new Error(`task ${String(id)} is a ${record.kind} task, not ${AgentScriptRun.definition.name}`);
			settleResult(Promise.reject(error));
			throw error;
		}
		entries = entriesOf(record.input as unknown as RunInput, record.state);
		// The graph watch first, so nothing committed after the read below goes unseen.
		const watch = await harness.watchTaskGraph(context);
		graph = watch;
		settleResult(waitForScript(harness, id, context));
		const key = String(id);
		let node = JSON.stringify(watch.value.tasks[key] ?? null);
		await serial(async () => {
			const seen = await read();
			if (seen !== undefined) await report(seen);
		});
		if (done || failure !== undefined) {
			void watch.stop();
			return;
		}
		watch.start((value) => {
			const next = JSON.stringify(value.tasks[key] ?? null);
			if (next === node) return Promise.resolve();
			node = next;
			return serial(async () => {
				const seen = await read();
				if (seen !== undefined) await report(seen);
			});
		});
		void watch.closed.then((end) => {
			if (end.reason === "stopped" || end.reason === "cancelled") return;
			const why = end.reason === "listener_error" ? end.error.message : end.reason;
			// After the reactions already queued, so a run that ended first still ends cleanly.
			void serial(() => {
				fail(new Error(`watchScript: the task graph watch of run ${String(id)} closed (${why})`));
			});
		});
	};

	void attach().catch((error: unknown) => {
		settleResult(Promise.reject(error));
		fail(error);
	});

	let iterated = false;
	return {
		result,
		stop: async () => {
			queue.length = 0;
			const watches = detach();
			finish();
			await watches;
		},
		[Symbol.asyncIterator](): AsyncIterator<RunEvent> {
			if (iterated) throw new Error("watchScript: a watch can be iterated only once");
			iterated = true;
			let finished = false;
			return {
				async next(): Promise<IteratorResult<RunEvent>> {
					for (;;) {
						if (finished) return { done: true, value: undefined };
						const event = queue.shift();
						if (event !== undefined) return { done: false, value: event };
						if (failure !== undefined) {
							finished = true;
							throw failure.error;
						}
						if (done) {
							finished = true;
							return { done: true, value: undefined };
						}
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					}
				},
				async return(): Promise<IteratorResult<RunEvent>> {
					finished = true;
					return { done: true, value: undefined };
				},
			};
		},
	};
}

type Item = { readonly kind: "step"; readonly index: number } | { readonly kind: "action"; readonly index: number; readonly step: number };

/**
 * Steps and actions in the order `run` reports them. The state keeps them apart;
 * the run's entry list puts them back together: each subagent's `run` calls come
 * before its own step, and an action's `step` is the index of the step after it.
 */
function order(entries: readonly string[], steps: readonly StepReport[], actions: readonly ActionReport[]): Item[] {
	const items: Item[] = [];
	let s = 0;
	let a = 0;
	for (const subagent of entries) {
		while (a < actions.length && actions[a]?.subagent === subagent) items.push({ kind: "action", index: a++, step: s });
		if (s < steps.length && steps[s]?.subagent === subagent) items.push({ kind: "step", index: s++ });
	}
	while (a < actions.length) items.push({ kind: "action", index: a++, step: s });
	while (s < steps.length) items.push({ kind: "step", index: s++ });
	return items;
}

/** The run's subagents in order: from the live checkpoint, else from its input, as `start` resolved them. */
function entriesOf(input: RunInput, state: { readonly status: string; readonly checkpoint?: unknown }): readonly string[] {
	const checkpoint = state.checkpoint as { state?: RunState } | undefined;
	if (checkpoint?.state?.entries !== undefined) return checkpoint.state.entries;
	try {
		return start(input.source, input.options).entries;
	} catch {
		return [];
	}
}

function textOf(blocks: readonly Block[], field: "text" | "thinking"): string {
	return blocks
		.filter((block) => block.type === field)
		.map((block) => block[field] ?? "")
		.join("");
}

function assistantText(entries: readonly EntryRecord[]): string {
	return entries
		.flatMap((entry) => entry.model ?? [])
		.flatMap((message) => (message.role === "assistant" ? message.content : []))
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

/** What `text` adds after `sent`, or nothing when it does not extend it. */
function remainder(text: string, sent: string): string {
	return text.startsWith(sent) ? text.slice(sent.length) : "";
}
