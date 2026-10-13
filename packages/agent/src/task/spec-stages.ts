/**
 * The spec stages of a change, in run order. `spec <change>` with no stage runs
 * the first one without a current approval; once the last is approved, the
 * change is ready to execute. Each stage change appends its stage here.
 */

import type { SpecStage } from "./spec-stage.js";
import { designStage } from "./stages/design.js";
import { proposalStage } from "./stages/proposal.js";

export const SPEC_STAGES: readonly SpecStage[] = Object.freeze([proposalStage, designStage]);
