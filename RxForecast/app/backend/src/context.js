// Shared, computed-once application context — the demo's stand-in for the real system's
// Postgres + materialized views (v_reorder_queue, weekly_chain_metrics, etc. — lld.md §3.2).
import { loadDemoData } from './data/loader.js';
import { buildForecastIndex } from './lib/forecasting.js';
import { buildLiveSubstitutions } from './lib/substitution.js';
import { state } from './data/state.js';

export const ctx = {};

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

  console.log(`[boot] loaded ${data.stores.length} stores, ${data.formulary.length} NDCs (demo subset), ` +
    `${data.dispense.length} dispense rows, ${data.shortages.length} active shortages, ` +
    `${state.substitutions.length} live substitution recommendations.`);
}
