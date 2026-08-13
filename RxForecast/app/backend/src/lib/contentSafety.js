// Azure AI Content Safety groundedness gate — REAL integration point for lld.md §4.5's
// "Content Safety groundedness gate" and PRD.md §7's groundedness detection control.
//
// Configured via CONTENT_SAFETY_ENDPOINT / CONTENT_SAFETY_KEY. When unset (the default
// in this local prototype), checkGroundedness() is a permissive no-op (`pass: true,
// skipped: true`) so nothing currently blocked becomes blocked by adding this file.
//
// Request shape targets Content Safety's "Detect Groundedness" API
// (POST {endpoint}/contentsafety/text:detectGroundedness?api-version=...). Verify the
// exact request/response contract against the current Azure AI Content Safety API
// reference before relying on it — this hasn't been exercised against a live endpoint.

const CONTENT_SAFETY_ENDPOINT = process.env.CONTENT_SAFETY_ENDPOINT;
const CONTENT_SAFETY_KEY = process.env.CONTENT_SAFETY_KEY;
const CONTENT_SAFETY_API_VERSION = process.env.CONTENT_SAFETY_API_VERSION || '2024-09-15-preview';

// lld.md §12.8 — open decision, needs tuning against real output once the resource is live.
const DEFAULT_UNGROUNDED_THRESHOLD = Number(process.env.CONTENT_SAFETY_UNGROUNDED_THRESHOLD ?? 0.5);

export function isContentSafetyConfigured() {
  return Boolean(CONTENT_SAFETY_ENDPOINT && CONTENT_SAFETY_KEY);
}

/**
 * Checks a generated rationale against the grounding documents it was supposedly built
 * from (TE code lookup, contract record, DEA schedule — whatever text fed the prompt).
 * Returns { pass, skipped, ungroundedPercentage, raw } — never throws. A failed call is
 * treated as "skipped", not as a block, since a Content Safety outage shouldn't itself
 * stop the substitution pipeline (the deterministic Schedule II hard-block is what must
 * never have exceptions — this gate is defense-in-depth on top of it, not instead of it).
 */
export async function checkGroundedness({ text, groundingSources }) {
  if (!isContentSafetyConfigured()) {
    return { pass: true, skipped: true, reason: 'not configured' };
  }
  if (!text || !groundingSources?.length) {
    return { pass: true, skipped: true, reason: 'no grounding sources supplied' };
  }

  const url = `${CONTENT_SAFETY_ENDPOINT.replace(/\/$/, '')}/contentsafety/text:detectGroundedness?api-version=${CONTENT_SAFETY_API_VERSION}`;
  const body = {
    text,
    groundingSources,
    reasoning: false,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': CONTENT_SAFETY_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[contentSafety] ${res.status} ${res.statusText}`);
      return { pass: true, skipped: true, reason: `API error ${res.status}` };
    }
    const data = await res.json();
    const ungroundedPercentage = data.ungroundedPercentage ?? 0;
    const ungroundedDetected = Boolean(data.ungroundedDetected);
    return {
      pass: !ungroundedDetected && ungroundedPercentage < DEFAULT_UNGROUNDED_THRESHOLD,
      skipped: false,
      ungroundedPercentage,
      raw: data,
    };
  } catch (err) {
    console.error('[contentSafety] call failed:', err.message);
    return { pass: true, skipped: true, reason: err.message };
  }
}
