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
// chat-completions endpoint Foundry exposes for model-catalog deployments):
// POST {resourceRoot}/models/chat/completions?api-version=... — verified live 2026-08-21
// against a gpt-5 "Global Standard" deployment.
//
// Two gotchas found running it for real, worth knowing if this stops working against a
// different deployment: (1) the Foundry portal's "Project endpoint" field (what you'd
// naturally copy-paste) is the *project-scoped* URL, e.g.
// https://<resource>.services.ai.azure.com/api/projects/<project> — that's for the
// Agents/Assistants APIs, not this one, and calling /chat/completions on it 400s with a
// misleading "API version not supported". The Model Inference API needs the bare
// *resource root* instead, so FOUNDRY_ENDPOINT is normalized below to strip any
// /api/projects/... suffix, letting you paste the portal's value as-is. (2) some models
// (e.g. gpt-5) reject `max_tokens` and require `max_completion_tokens` instead — if a
// different backing model rejects *that* param name, this may need to branch by model.

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

  const resourceRoot = FOUNDRY_ENDPOINT.replace(/\/$/, '').replace(/\/api\/projects\/[^/]+$/, '');
  const url = `${resourceRoot}/models/chat/completions?api-version=${FOUNDRY_API_VERSION}`;
  const body = {
    model: FOUNDRY_DEPLOYMENT_NAME,
    max_completion_tokens: maxTokens,
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
