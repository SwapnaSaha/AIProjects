// AI Quality monitoring layer — lld.md §4.5 "Continuous production evaluation",
// PRD.md §8 "Continuous production evaluation", engg.md FEATURE_9's ai_quality category.
//
// This is intentionally lightweight, not a wired-up Foundry Evaluation SDK call: the
// Evaluation SDK is primarily a Python-first offline/batch tool, not something this
// Node.js backend calls per-request over a simple REST endpoint the way foundryClient.js
// and contentSafety.js do. What's real here: every Foundry-backed call's groundedness
// result (from contentSafety.js, which already gives a real per-call score once
// configured) is logged into state.evalLog, separate from the compliance audit_log,
// matching the ai_quality metric category design. Wiring an actual Evaluation SDK batch
// job (nightly rollup, relevance scoring) is follow-up work once real usage volume
// exists — flagged, not hidden, same as everything else in GAPS.md.

import { writeEval } from '../data/state.js';
import { isFoundryConfigured } from './foundryClient.js';
import { isContentSafetyConfigured } from './contentSafety.js';

export function isEvalMonitoringActive() {
  return isFoundryConfigured() || isContentSafetyConfigured();
}

/** Records one LLM-backed call's quality signal. No-ops cleanly if nothing is configured. */
export function recordCallEval({ callType, traceId, foundryUsed, groundednessResult }) {
  if (!isEvalMonitoringActive()) return null;
  return writeEval({
    callType,
    traceId,
    foundryUsed,
    contentSafety: groundednessResult
      ? {
          skipped: groundednessResult.skipped,
          pass: groundednessResult.pass,
          ungroundedPercentage: groundednessResult.ungroundedPercentage ?? null,
        }
      : null,
  });
}
