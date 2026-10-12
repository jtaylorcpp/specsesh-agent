/**
 * The runners a `defineAgentHost` host uses when its config names none: `agent` only.
 * There is no process runner on Workers, so a `claude-code` grant is refused.
 *
 * No `cloudflare:workers` import, so plain Node can load it.
 */

import { agentRunner, type Runners } from "../durable/index.js";

export const defaultCloudflareRunners = (): Runners => ({ agent: agentRunner() });
