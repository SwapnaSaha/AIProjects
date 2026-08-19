// Resolves which active buyer-override rule (if any) applies to a given drug+store+type —
// the shared lookup that closes the gap documented in rule.md §5: overrides used to be
// stored/audited but never consulted by priority.js/orderQty.js/substitution.js. Added
// 2026-08-19.
import { state } from '../data/state.js';

/**
 * A store-specific rule always wins over an all-stores rule for the same NDC+type — the
 * more specific instruction should take precedence. Returns null if no active rule of
 * that type applies to this NDC at this store.
 */
export function findActiveOverride(ndc, storeId, type) {
  const matches = state.overridesActive.filter(o =>
    o.active && o.ndc === ndc && o.type === type && (o.storeId === storeId || o.storeId === null)
  );
  if (matches.length === 0) return null;
  return matches.find(o => o.storeId === storeId) || matches[0];
}
