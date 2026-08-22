import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, toNum, toBool } from '../lib/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Points at the trimmed, committed copy (app/backend/seed-data/) — not the ~101MB
// external RxForecast_SyntheticData/ folder, which was deliberately never pushed to git
// and so isn't available in any deployed environment. seed-data/ is the exact
// NDC/store/date slice this file's own filtering logic below would produce anyway;
// see scripts/export-seed-data.mjs for how it's generated (re-run it if the source
// dataset changes). This also means the filtering logic below is now a no-op pass over
// already-trimmed data — left in place rather than removed, so this file still works
// correctly if ever pointed back at the full dataset for local re-generation work.
const SYNTH_DIR = path.resolve(__dirname, '../../seed-data');

function readFull(name) {
  return parseCSV(fs.readFileSync(path.join(SYNTH_DIR, name), 'utf8'));
}

// Fast filtered load for the two large, comma-safe files (no field ever contains a comma).
function readFilteredSimple(name, { storeSet, ndcSet, minDate }) {
  const text = fs.readFileSync(path.join(SYNTH_DIR, name), 'utf8');
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const dateIdx = header.indexOf('date');
  const storeIdx = header.indexOf('store_id');
  const ndcIdx = header.indexOf('ndc');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Cheap pre-check before splitting: skip lines that can't possibly match.
    const f = line.split(',');
    if (f.length !== header.length) continue;
    if (minDate && f[dateIdx] < minDate) continue;
    if (storeSet && !storeSet.has(f[storeIdx])) continue;
    if (ndcSet && !ndcSet.has(f[ndcIdx])) continue;
    const obj = {};
    header.forEach((h, idx) => { obj[h] = f[idx]; });
    out.push(obj);
  }
  return out;
}

export function loadDemoData() {
  const storesRaw = readFull('stores.csv');
  const formularyRaw = readFull('formulary.csv');
  const distributorsRaw = readFull('distributors.csv');
  const contractsRaw = readFull('distributor_contracts.csv');
  const shortagesRaw = readFull('fda_ashp_shortage_events.csv');
  const substitutionsRaw = readFull('substitution_events.csv');
  const overridesRaw = readFull('buyer_overrides.csv');
  const bulletinText = fs.readFileSync(path.join(SYNTH_DIR, 'ashp_shortage_bulletins_raw.txt'), 'utf8');

  // Demo scope: all 12 stores, but a trimmed NDC set for a snappy in-memory demo —
  // all velocity-tier-A NDCs, plus anything involved in a shortage/substitution/override
  // (so those flows always have real data to show), capped at ~60 NDCs.
  const shortageNdcs = new Set(shortagesRaw.map(s => s.ndc));
  const overrideNdcs = new Set(overridesRaw.map(o => o.ndc));
  const tierA = formularyRaw.filter(f => f.velocity_tier === 'A').map(f => f.ndc);
  const mustInclude = new Set([...shortageNdcs, ...overrideNdcs]);
  const demoNdcList = [...new Set([...mustInclude, ...tierA])].slice(0, 60);
  const demoNdcSet = new Set(demoNdcList);
  const formulary = formularyRaw.filter(f => demoNdcSet.has(f.ndc)).map(f => ({
    ndc: f.ndc,
    genericName: f.generic_name,
    brandName: f.brand_name,
    isBrand: toBool(f.is_brand),
    category: f.therapeutic_category,
    dosageForm: f.dosage_form,
    strength: f.strength,
    packSize: toNum(f.pack_size),
    deaSchedule: toNum(f.dea_schedule),
    teCode: f.orange_book_te_code,
    manufacturer: f.manufacturer,
    velocityTier: f.velocity_tier,
    isGlp1: toBool(f.is_glp1),
    isInsulin: toBool(f.is_insulin),
    isControlled: toNum(f.dea_schedule) > 0,
    is340b: toBool(f.is_340b_eligible),
    wacPrice: toNum(f.wac_price_per_pack),
    unitCost: toNum(f.unit_cost_per_pack),
  }));

  const stores = storesRaw.map(s => ({
    storeId: s.store_id, name: s.store_name, city: s.city, state: s.state,
    dc: s.dc_assignment, format: s.store_format, picUserId: s.pharmacist_in_charge,
  }));
  const storeSet = new Set(stores.map(s => s.storeId));

  const distributors = distributorsRaw.map(d => ({
    id: d.distributor_id, name: d.name, role: d.role, leadTimeDays: toNum(d.avg_lead_time_days),
  }));

  const contracts = contractsRaw.filter(c => demoNdcSet.has(c.ndc)).map(c => ({
    id: c.contract_id, ndc: c.ndc, distributorId: c.distributor_id,
    type: c.contract_type, price: toNum(c.contract_price_per_pack), gpoName: c.gpo_name,
  }));

  // Trailing 150 days of dispense history for the demo NDC/store set — enough for a
  // real trailing-average forecast with a visible seasonal wobble, without loading
  // the full 24-month / 1.27M-row file into memory.
  const dispense = readFilteredSimple('dispense_history.csv', {
    storeSet, ndcSet: demoNdcSet, minDate: '2025-08-01',
  }).map(d => ({
    date: d.date, storeId: d.store_id, ndc: d.ndc,
    qty: toNum(d.quantity_dispensed), daysSupply: toNum(d.days_supply), payerType: d.payer_type,
  }));

  // Most recent inventory snapshot per store/ndc as the "current on-hand" baseline.
  const invRows = readFilteredSimple('inventory_snapshot_weekly.csv', {
    storeSet, ndcSet: demoNdcSet,
  });
  const latestInv = new Map(); // key: storeId|ndc -> row
  for (const r of invRows) {
    const key = `${r.store_id}|${r.ndc}`;
    const existing = latestInv.get(key);
    if (!existing || r.date > existing.date) latestInv.set(key, r);
  }
  const inventory = [...latestInv.values()].map(r => ({
    storeId: r.store_id, ndc: r.ndc, onHand: toNum(r.on_hand_qty), inTransit: toNum(r.in_transit_qty),
    reorderPointDays: toNum(r.reorder_point_days), targetDays: toNum(r.target_days_of_supply),
  }));

  // DEMO ADJUSTMENT: the synthetic dataset's internal clock ends 2025-12-30, so only 1 of
  // its 10 shortage events is genuinely "Current" as of that date — most had already
  // resolved. For a demo that needs to actually show the Shortage Alert Feed working,
  // we re-present up to 5 shortages (the real Current one + the most recent Resolved
  // ones) as active "for demo purposes" — the underlying event data (reason, severity,
  // NDC, bulletin text) is unchanged and realistic, only the displayed status is
  // overridden. Flagged in the API response via `demoStatusOverride`, not hidden.
  const allShortages = shortagesRaw.filter(s => demoNdcSet.has(s.ndc)).map(s => ({
    id: s.shortage_id, ndc: s.ndc, genericName: s.generic_name, source: s.source,
    status: s.status, dateReported: s.date_reported, dateResolved: s.date_resolved,
    reason: s.reason, severity: s.severity, bulletinId: s.bulletin_id,
  }));
  const trulyCurrent = allShortages.filter(s => s.status === 'Current');
  const fillers = allShortages
    .filter(s => s.status !== 'Current')
    .sort((a, b) => (a.dateReported < b.dateReported ? 1 : -1))
    .slice(0, Math.max(0, 5 - trulyCurrent.length));
  const demoActiveIds = new Set([...trulyCurrent, ...fillers].map(s => s.id));
  const shortages = allShortages.map(s => (
    demoActiveIds.has(s.id)
      ? { ...s, status: 'Current', demoStatusOverride: s.status !== 'Current' }
      : s
  ));

  const substitutions = substitutionsRaw.filter(s => demoNdcSet.has(s.original_ndc)).map(s => ({
    id: s.substitution_id, shortageId: s.shortage_id, storeId: s.store_id,
    originalNdc: s.original_ndc, altNdc: s.proposed_alt_ndc,
    teMatch: toBool(s.orange_book_te_match), decision: s.buyer_decision,
    pharmacistApproved: toBool(s.pharmacist_rated_appropriate),
  }));

  const overrides = overridesRaw.filter(o => demoNdcSet.has(o.ndc)).map(o => ({
    id: o.override_id, buyerId: o.buyer_id, storeId: o.store_id === 'ALL_STORES' ? null : o.store_id,
    ndc: o.ndc, genericName: o.generic_name, type: o.override_type, rationale: o.rationale,
    createdDate: o.created_date, active: toBool(o.active),
  }));

  return {
    stores, formulary, distributors, contracts, dispense, inventory,
    shortages, substitutions, overrides, bulletinText, demoNdcList,
  };
}
