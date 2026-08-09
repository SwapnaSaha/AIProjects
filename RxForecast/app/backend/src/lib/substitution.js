// SIMULATED reasoning layer. Production spec (PRD.md §6-7, lld.md §4.3) calls for Claude
// (via Azure AI Foundry) doing live chain-of-thought reasoning: Orange Book TE class ->
// payer coverage -> contract availability -> DEA schedule -> store history, grounded by
// RAG over Azure AI Search. This module builds a realistic-shaped recommendation from
// the same structured facts a real prompt would be given (formulary, contracts, DEA
// schedule) using template logic instead of an LLM call — see GAPS.md item
// "AI Quality — Substitution Reasoner / Shortage Watcher".

function findAlternatives(formulary, originalNdc) {
  const original = formulary.find(f => f.ndc === originalNdc);
  if (!original) return [];
  return formulary
    .filter(f => f.ndc !== originalNdc && f.genericName === original.genericName)
    .map(alt => ({
      alt,
      teMatch: alt.teCode !== 'NA' && alt.teCode === original.teCode,
    }))
    .sort((a, b) => (b.teMatch ? 1 : 0) - (a.teMatch ? 1 : 0));
}

function buildRationale(original, alt, teMatch, contracts) {
  const contract = contracts.find(c => c.ndc === alt.ndc);
  const parts = [];
  parts.push(teMatch
    ? `Same generic (${alt.genericName}), Orange Book TE code ${alt.teCode} matches the shortage NDC — therapeutically equivalent.`
    : `Same generic (${alt.genericName}), but TE code differs (${original.teCode || 'N/A'} vs ${alt.teCode || 'N/A'}) — flagged, not a confirmed equivalent.`);
  parts.push(contract
    ? `Contract available via ${contract.distributorId} (${contract.type}) at $${contract.price.toFixed(2)}/pack.`
    : `No active contract found for this alternative — would source at WAC.`);
  if (alt.isControlled) parts.push(`DEA Schedule ${alt.deaSchedule} — substitution requires manual pharmacist sign-off, no auto-approval path.`);
  return parts.join(' ');
}

/** Builds live, pending substitution recommendations for currently-active shortages. */
export function buildLiveSubstitutions(shortages, formulary, contracts, stores) {
  const out = [];
  let seq = 1000;
  const activeShortages = shortages.filter(s => s.status === 'Current' || s.status === 'current');
  for (const shortage of activeShortages) {
    const original = formulary.find(f => f.ndc === shortage.ndc);
    if (!original) continue;
    const alternatives = findAlternatives(formulary, shortage.ndc).slice(0, 2);
    const sampleStores = stores.slice(0, 3);
    for (const store of sampleStores) {
      const options = alternatives.map(({ alt, teMatch }) => ({
        altNdc: alt.ndc,
        altGenericName: alt.genericName,
        altBrandName: alt.brandName,
        teMatch,
        rationale: buildRationale(original, alt, teMatch, contracts),
        blocked: alt.isControlled && alt.deaSchedule === 2,
      }));
      out.push({
        id: `SUBLIVE${seq++}`,
        shortageId: shortage.id,
        storeId: store.storeId,
        originalNdc: shortage.ndc,
        originalGenericName: original.genericName,
        severity: shortage.severity,
        reason: shortage.reason,
        options,
        decision: 'pending',
        confidence: options.some(o => o.teMatch) ? 0.86 : 0.52,
      });
    }
  }
  return out;
}
