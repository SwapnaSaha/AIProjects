// In-memory application state. Resets on server restart — see GAPS.md item "Persistence".
// Production spec: Postgres (lld.md §3.2), partitioned, append-only audit_log enforced by
// DB role grants. Here it's a JS array a determined process could mutate directly — the
// APPEND-ONLY BEHAVIOR of the audit log below is enforced only by "nothing calls
// auditLog.splice()", not by any real access control. That's the gap, explicitly.

export const state = {
  purchaseOrders: [],      // { id, storeId, distributorId, status, lines[], createdAt, approvedBy, transmittedAt }
  auditLog: [],            // { id, entityType, entityId, action, actorUserId, actorRole, payload, createdAt }
  substitutions: [],       // live pending/decided substitution recommendations (mutable copy of buildLiveSubstitutions output)
  overridesActive: [],     // mutable copy of loaded overrides + any created live
  deferredQueueItems: new Map(), // userId -> Set(`${storeId}|${ndc}`) — cleared for a user the next time THEY log in (see login())
  rejectedQueueItems: new Set(), // `${storeId}|${ndc}`, permanent — an explicit decision, never resurfaces on its own
  poSeq: 1,
};

let auditSeq = 1;
export function writeAudit({ entityType, entityId, action, actorUserId, actorRole, payload, sources }) {
  const entry = {
    id: `AUD${String(auditSeq++).padStart(6, '0')}`,
    entityType, entityId, action, actorUserId, actorRole,
    payload: payload || {}, sources: sources || [],
    createdAt: new Date().toISOString(),
  };
  state.auditLog.push(entry); // append-only BY CONVENTION ONLY in this prototype
  return entry;
}

export function nextPoId() {
  return `PO${String(state.poSeq++).padStart(6, '0')}`;
}

// Mock session store — FEATURE_0's real spec is SSO (Entra External ID/WorkOS) + JWT +
// MFA + 15-min timeout. This is a bearer token that never expires, mapped to a fixed
// demo user per role. See GAPS.md item "Authentication".
const DEMO_USERS = {
  buyer: { userId: 'demo-buyer', name: 'Jordan (Buyer)', role: 'buyer', storeId: null },
  director: { userId: 'demo-director', name: 'Casey (Director)', role: 'director', storeId: null },
  pic: { userId: 'demo-pic', name: 'Riley (PIC)', role: 'pic', storeId: 'ST001' },
  compliance: { userId: 'demo-compliance', name: 'Morgan (Compliance)', role: 'compliance', storeId: null },
  pharmacist: { userId: 'demo-pharmacist', name: 'Dr. Patel (Pharmacist)', role: 'pharmacist', storeId: null },
};
const sessions = new Map(); // token -> user

export function login(role) {
  const user = DEMO_USERS[role];
  if (!user) return null;
  // A fresh login is the resurfacing event for this user's deferred queue items (see
  // queue.js) — production resurfaces on the next nightly cycle instead (engg.md
  // FEATURE_1); "next login" is this prototype's stand-in since there's no nightly job.
  state.deferredQueueItems.delete(user.userId);
  const token = `demo-token-${role}-${Math.random().toString(36).slice(2)}`;
  sessions.set(token, user);
  return { token, user };
}

export function getUserForToken(token) {
  return sessions.get(token) || null;
}
