// Azure AI Foundry model client — REAL integration point for the Claude deployment
// described in lld.md §4.5 (Model client / Auth / Networking / Tracing).
//
// Configured via FOUNDRY_ENDPOINT / FOUNDRY_API_KEY / FOUNDRY_DEPLOYMENT_NAME. When any
// of those are unset (the default in this local prototype — see GAPS.md "AI reasoning"),
// isFoundryConfigured() is false and callers fall back to the existing template logic in
// substitution.js / shortages.js, exactly as they do today. Nothing about the app's
// current behavior changes until real values are set.
//
// Request shape targets Azure AI Foundry's Model Inference API (the unified
// chat-completions endpoint Foundry exposes for model-catalog deployments, including
// partner-catalog models like Claude): POST {endpoint}/chat/completions?api-version=...
// Verify this exact contract against your deployed model's own API reference in the
// Foundry portal before relying on it — Foundry's endpoint shape can differ by
// deployment type (serverless model-as-a-service vs. managed compute), and this hasn't
// been exercised against a live endpoint yet.

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_ENDPOINT;
const FOUNDRY_API_KEY = process.env.FOUNDRY_API_KEY;
const FOUNDRY_DEPLOYMENT_NAME = process.env.FOUNDRY_DEPLOYMENT_NAME;
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || '2024-05-01-preview';

export function isFoundryConfigured() {
  return Boolean(FOUNDRY_ENDPOINT && FOUNDRY_API_KEY && FOUNDRY_DEPLOYMENT_NAME);
}

export function newTraceId() {
  return `FTRC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Calls the Foundry-hosted Claude deployment. Returns null (never throws) when not
 * configured or when the call fails — callers must treat null as "fall back to template
 * logic", not as a hard error, matching this prototype's existing simulated/real split.
 */
export async function callFoundryModel({ systemPrompt, userPrompt, maxTokens = 1024, traceId }) {
  if (!isFoundryConfigured()) return null;

  const url = `${FOUNDRY_ENDPOINT.replace(/\/$/, '')}/chat/completions?api-version=${FOUNDRY_API_VERSION}`;
  const body = {
    model: FOUNDRY_DEPLOYMENT_NAME,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': FOUNDRY_API_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[foundryClient] ${res.status} ${res.statusText} (trace ${traceId || 'n/a'})`);
      return null;
    }
    const data = await res.json();
    const completion = data?.choices?.[0]?.message?.content;
    if (!completion) return null;
    return {
      completion,
      usage: data.usage || null,
      traceId: traceId || newTraceId(),
    };
  } catch (err) {
    console.error(`[foundryClient] call failed (trace ${traceId || 'n/a'}):`, err.message);
    return null;
  }
}
