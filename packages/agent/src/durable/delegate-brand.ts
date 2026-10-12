/**
 * The mark `delegationActions` puts on the actions it makes, so
 * `createActionRegistry` can refuse a hand-made `delegate/<name>`. The symbol
 * never leaves this module, and `./index.ts` does not re-export it: only a grant
 * puts a delegate in a registry.
 */

import type { HostAction } from "./actions.js";

const BRAND = Symbol("delegationActions");

/** The same object, marked as made by `delegationActions`. */
export function brandDelegate<A extends HostAction>(action: A): A {
	Object.defineProperty(action, BRAND, { value: true });
	return action;
}

/** Whether `delegationActions` made this very object. A copy loses the mark. */
export function isGrantedDelegate(action: HostAction): boolean {
	return Object.hasOwn(action, BRAND);
}
