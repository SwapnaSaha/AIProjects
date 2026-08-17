// Shared, computed-once application context — the demo's stand-in for the real system's
// Postgres + materialized views (v_reorder_queue, weekly_chain_metrics, etc. — lld.md §3.2).
import { loadDemoData } from './data/loader.js';
import { buildForecastIndex } from './lib/forecasting.js';
import { buildLiveSubstitutions } from './lib/substitution.js';
import { isShortageFeedEnabled, shortageFeedPollMinutes, fetchLiveShortages } from './lib/shortageFeed.js';
import { state } from './data/state.js';

export const ctx = {};

// Re-fetches openFDA and rebuilds ctx.shortages + state.substitutions from it — pulled
// out of initContext() so both the initial load and the recurring poller (below) share
// the exact same logic, not two slightly-different copies of it.
async function refreshLiveShortages(data) {
  const liveShortages = await fetchLiveShortages(data.formulary.map(f => f.ndc));
  ctx.shortages = liveShortages;
  ctx.usingLiveShortageFeed = true;
  state.substitutions = await buildLiveSubstitutions(liveShortages, data.formulary, data.contracts, data.stores);
  console.log(`[shortageFeed] openFDA poll: ${liveShortages.length} live shortage(s) matched against the ` +
    `${data.formulary.length}-NDC loaded formulary — see shortageFeed.js's header comment: this synthetic formulary's NDCs are fictional (verified against the real NDC Directory), so 0 is the expected, correct result here regardless of formulary size.`);
}

export async function initContext() {
  console.log('[boot] loading synthetic dataset (trimmed demo subset)...');
  const data = loadDemoData();
  Object.assign(ctx, data);

  ctx.forecastIndex = buildForecastIndex(data.dispense);
  ctx.formularyByNdc = new Map(data.formulary.map(f => [f.ndc, f]));
  ctx.storesById = new Map(data.stores.map(s => [s.storeId, s]));
  ctx.distributorsById = new Map(data.distributors.map(d => [d.id, d]));
  ctx.contractsByNdc = new Map();
  for (const c of data.contracts) {
    if (!ctx.contractsByNdc.has(c.ndc)) ctx.contractsByNdc.set(c.ndc, []);
    ctx.contractsByNdc.get(c.ndc).push(c);
  }
  ctx.inventoryByKey = new Map(data.inventory.map(i => [`${i.storeId}|${i.ndc}`, i]));

  // Async since 2026-08-12 — buildLiveSubstitutions may call the Foundry-hosted Claude
  // deployment per option when FOUNDRY_ENDPOINT is configured (substitution.js).
  state.substitutions = await buildLiveSubstitutions(data.shortages, data.formulary, data.contracts, data.stores);
  state.overridesActive = [...data.overrides];
  ctx.usingLiveShortageFeed = false;

  console.log(`[boot] loaded ${data.stores.length} stores, ${data.formulary.length} NDCs (demo subset), ` +
    `${data.dispense.length} dispense rows, ${data.shortages.length} active shortages, ` +
    `${state.substitutions.length} live substitution recommendations.`);

  // Live shortage polling (added 2026-08-14) — off by default, see shortageFeed.js.
  // Replaces the synthetic ctx.shortages entirely when on, and re-polls on an interval,
  // same "flag it, don't fake it" pattern as everything else in this prototype.
  if (isShortageFeedEnabled()) {
    console.log(`[shortageFeed] SHORTAGE_FEED_ENABLED=true — polling openFDA every ${shortageFeedPollMinutes()} min. ` +
      'This REPLACES the synthetic shortage list with real live data (GAPS.md "Data scope" still applies).');
    await refreshLiveShortages(data);
    setInterval(() => {
      refreshLiveShortages(data).catch(err => console.error('[shortageFeed] poll failed:', err.message));
    }, shortageFeedPollMinutes() * 60 * 1000);
  }
}
