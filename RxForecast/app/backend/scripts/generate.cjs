// RxForecast synthetic data generator (demo scale)
// Deterministic PRNG for reproducibility
//
// This is the upstream generator for the full ~101MB external dataset at
// RxForecast_SyntheticData/ (deliberately never committed, see export-seed-data.mjs's
// header) — committed here so the whole pipeline is reproducible from a fresh clone,
// even though its ~101MB *output* stays outside the repo. Extension is .cjs (not .js)
// because this file is plain CommonJS (require/module-style) and app/backend/package.json
// sets "type": "module" — Node would otherwise try to parse a .js file here as ESM.
//
// Run with: node scripts/generate.cjs (from app/backend/) — regenerates the full
// external dataset in place, then re-run scripts/export-seed-data.mjs to refresh the
// trimmed seed-data/ copy the app actually loads.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../../../../RxForecast_SyntheticData');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(OUT, 'raw_edi_samples'))) fs.mkdirSync(path.join(OUT, 'raw_edi_samples'), { recursive: true });

// ---- seeded RNG (mulberry32) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260730);
function ri(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function rf(min, max, dp = 2) { const v = rand() * (max - min) + min; return Math.round(v * 10 ** dp) / 10 ** dp; }
function choice(arr) { return arr[Math.floor(rand() * arr.length)]; }
function weightedChoice(items) { // items: [[value, weight], ...]
  const total = items.reduce((s, i) => s + i[1], 0);
  let r = rand() * total;
  for (const [v, w] of items) { if (r < w) return v; r -= w; }
  return items[items.length - 1][0];
}
function poisson(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}
function pad(n, w) { return String(n).padStart(w, '0'); }
function dateAdd(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dowSunday0(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function writeCSV(filename, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(','));
  fs.writeFileSync(path.join(OUT, filename), lines.join('\n') + '\n');
  console.log(`wrote ${filename}: ${rows.length} rows`);
}

// =========================================================
// 1. STORES
// =========================================================
const REGIONS = [
  ['Austin', 'TX'], ['San Antonio', 'TX'], ['Dallas', 'TX'], ['Houston', 'TX'],
  ['Corpus Christi', 'TX'], ['Waco', 'TX'], ['Tyler', 'TX'], ['Lubbock', 'TX'],
  ['El Paso', 'TX'], ['Amarillo', 'TX'], ['Baton Rouge', 'LA'], ['Shreveport', 'LA'],
];
const stores = REGIONS.map((r, i) => {
  const id = `ST${pad(i + 1, 3)}`;
  return {
    store_id: id,
    store_name: `${r[0]} #${i + 1}`,
    city: r[0],
    state: r[1],
    dc_assignment: i % 2 === 0 ? 'DC-NORTH' : 'DC-SOUTH',
    store_format: weightedChoice([['standard_retail', 8], ['club_warehouse', 4]]),
    open_date: '2015-01-01',
    sqft_tier: choice(['small', 'medium', 'large']),
    pharmacist_in_charge: `PIC-${id}`,
  };
});
writeCSV('stores.csv',
  ['store_id', 'store_name', 'city', 'state', 'dc_assignment', 'store_format', 'open_date', 'sqft_tier', 'pharmacist_in_charge'],
  stores);

// =========================================================
// 2. DISTRIBUTORS
// =========================================================
const distributors = [
  { distributor_id: 'MCK', name: 'McKesson', role: 'primary', avg_lead_time_days: 2, allocation_prone: 'medium' },
  { distributor_id: 'CAH', name: 'Cardinal Health', role: 'secondary', avg_lead_time_days: 3, allocation_prone: 'medium' },
  { distributor_id: 'ABC', name: 'AmerisourceBergen', role: 'tertiary', avg_lead_time_days: 4, allocation_prone: 'low' },
];
writeCSV('distributors.csv', ['distributor_id', 'name', 'role', 'avg_lead_time_days', 'allocation_prone'], distributors);

// =========================================================
// 3. FORMULARY (base drugs -> expanded NDC variants)
// =========================================================
// [generic_name, brand_name, category, dea_schedule(0=Rx none,2,3,4,5), tier(A/B/C), dosage_form, te_code_class, is_glp1, is_insulin, base_wac]
const BASE_DRUGS = [
  ['atorvastatin', 'Lipitor', 'Statins/Cardiovascular', 0, 'A', 'tablet', 'AB', false, false, 0.35],
  ['rosuvastatin', 'Crestor', 'Statins/Cardiovascular', 0, 'A', 'tablet', 'AB', false, false, 0.55],
  ['lisinopril', 'Prinivil', 'Antihypertensive', 0, 'A', 'tablet', 'AB', false, false, 0.12],
  ['amlodipine', 'Norvasc', 'Antihypertensive', 0, 'A', 'tablet', 'AB', false, false, 0.14],
  ['metoprolol succinate ER', 'Toprol-XL', 'Antihypertensive', 0, 'B', 'tablet', 'AB', false, false, 0.28],
  ['losartan', 'Cozaar', 'Antihypertensive', 0, 'A', 'tablet', 'AB', false, false, 0.20],
  ['metformin', 'Glucophage', 'Diabetes', 0, 'A', 'tablet', 'AB', false, false, 0.10],
  ['semaglutide', 'Ozempic', 'GLP-1/Diabetes', 0, 'A', 'injectable pen', 'NA', true, false, 950.00],
  ['semaglutide', 'Wegovy', 'GLP-1/Weight-Loss', 0, 'A', 'injectable pen', 'NA', true, false, 1350.00],
  ['tirzepatide', 'Mounjaro', 'GLP-1/Diabetes', 0, 'A', 'injectable pen', 'NA', true, false, 1050.00],
  ['insulin glargine', 'Lantus', 'Insulin', 0, 'B', 'injectable vial', 'NA', false, true, 280.00],
  ['insulin lispro', 'Humalog', 'Insulin', 0, 'B', 'injectable vial', 'NA', false, true, 260.00],
  ['levothyroxine', 'Synthroid', 'Thyroid', 0, 'A', 'tablet', 'BX', false, false, 0.18],
  ['omeprazole', 'Prilosec', 'GI/PPI', 0, 'A', 'capsule', 'AB', false, false, 0.15],
  ['pantoprazole', 'Protonix', 'GI/PPI', 0, 'B', 'tablet', 'AB', false, false, 0.22],
  ['sertraline', 'Zoloft', 'Antidepressant', 0, 'A', 'tablet', 'AB', false, false, 0.16],
  ['escitalopram', 'Lexapro', 'Antidepressant', 0, 'B', 'tablet', 'AB', false, false, 0.24],
  ['bupropion XL', 'Wellbutrin XL', 'Antidepressant', 0, 'B', 'tablet', 'AB', false, false, 0.30],
  ['alprazolam', 'Xanax', 'Anxiolytic', 4, 'B', 'tablet', 'AB', false, false, 0.19],
  ['clonazepam', 'Klonopin', 'Anxiolytic', 4, 'C', 'tablet', 'AB', false, false, 0.21],
  ['zolpidem', 'Ambien', 'Sleep Aid', 4, 'C', 'tablet', 'AB', false, false, 0.25],
  ['lorazepam', 'Ativan', 'Anxiolytic', 4, 'C', 'tablet', 'AB', false, false, 0.23],
  ['oxycodone', 'OxyContin', 'Opioid Analgesic', 2, 'C', 'tablet', 'NA', false, false, 1.20],
  ['hydrocodone/acetaminophen', 'Norco', 'Opioid Analgesic', 2, 'B', 'tablet', 'NA', false, false, 0.45],
  ['amphetamine/dextroamphetamine', 'Adderall', 'ADHD/Stimulant', 2, 'B', 'tablet', 'AB', false, false, 0.50],
  ['methylphenidate ER', 'Concerta', 'ADHD/Stimulant', 2, 'B', 'tablet', 'AB', false, false, 0.65],
  ['lisdexamfetamine', 'Vyvanse', 'ADHD/Stimulant', 2, 'B', 'capsule', 'NA', false, false, 0.75],
  ['amoxicillin', 'Amoxil', 'Antibiotic', 0, 'A', 'capsule', 'AB', false, false, 0.08],
  ['azithromycin', 'Zithromax', 'Antibiotic', 0, 'A', 'tablet', 'AB', false, false, 0.30],
  ['ciprofloxacin', 'Cipro', 'Antibiotic', 0, 'B', 'tablet', 'AB', false, false, 0.18],
  ['oseltamivir', 'Tamiflu', 'Antiviral', 0, 'B', 'capsule', 'AB', false, false, 4.20],
  ['cetirizine', 'Zyrtec', 'Antihistamine/OTC', 0, 'A', 'tablet', 'AB', false, false, 0.09],
  ['fluticasone nasal spray', 'Flonase', 'Antihistamine/OTC', 0, 'B', 'nasal spray', 'AT', false, false, 5.50],
  ['albuterol HFA', 'ProAir', 'Respiratory/Inhaler', 0, 'A', 'inhaler', 'NA', false, false, 28.00],
  ['fluticasone/salmeterol', 'Advair Diskus', 'Respiratory/Inhaler', 0, 'B', 'inhaler', 'NA', false, false, 210.00],
  ['montelukast', 'Singulair', 'Respiratory', 0, 'B', 'tablet', 'AB', false, false, 0.14],
  ['warfarin', 'Coumadin', 'Anticoagulant', 0, 'B', 'tablet', 'AB', false, false, 0.20],
  ['apixaban', 'Eliquis', 'Anticoagulant', 0, 'A', 'tablet', 'NA', false, false, 5.80],
  ['rivaroxaban', 'Xarelto', 'Anticoagulant', 0, 'B', 'tablet', 'NA', false, false, 5.60],
  ['gabapentin', 'Neurontin', 'Neuro/Pain', 0, 'A', 'capsule', 'AB', false, false, 0.11],
  ['duloxetine', 'Cymbalta', 'Antidepressant/Pain', 0, 'B', 'capsule', 'AB', false, false, 0.32],
  ['hydrochlorothiazide', 'Microzide', 'Antihypertensive', 0, 'A', 'tablet', 'AB', false, false, 0.07],
  ['simvastatin', 'Zocor', 'Statins/Cardiovascular', 0, 'B', 'tablet', 'AB', false, false, 0.13],
  ['clopidogrel', 'Plavix', 'Antiplatelet', 0, 'B', 'tablet', 'AB', false, false, 0.35],
  ['furosemide', 'Lasix', 'Diuretic', 0, 'B', 'tablet', 'AB', false, false, 0.06],
  ['prednisone', 'Deltasone', 'Corticosteroid', 0, 'B', 'tablet', 'AB', false, false, 0.09],
  ['tamsulosin', 'Flomax', 'Urology', 0, 'B', 'capsule', 'AB', false, false, 0.19],
  ['ondansetron', 'Zofran', 'Antiemetic', 0, 'C', 'tablet', 'AB', false, false, 0.55],
  ['methotrexate', 'Trexall', 'Oncology/Rheum (specialty)', 0, 'C', 'tablet', 'NA', false, false, 1.80],
  ['adalimumab', 'Humira', 'Biologic/Specialty', 0, 'C', 'injectable pen', 'NA', false, false, 2900.00],
];

const STRENGTHS_BY_FORM = {
  tablet: ['5mg', '10mg', '20mg', '25mg', '40mg', '50mg'],
  capsule: ['10mg', '20mg', '30mg', '40mg'],
  'injectable pen': ['0.25mg', '0.5mg', '1mg', '2mg', '2.4mg'],
  'injectable vial': ['100units/mL', '10mL vial'],
  'nasal spray': ['50mcg/spray'],
  inhaler: ['90mcg/inh', '108mcg/inh'],
};
const PACKS = [30, 60, 90];

let ndcSeq = 1;
const formulary = [];
const shortageCandidatePool = [];
for (const [generic, brand, category, schedule, tier, form, te, isGlp1, isInsulin, baseWac] of BASE_DRUGS) {
  const strengths = STRENGTHS_BY_FORM[form] || ['10mg'];
  const nVariants = isGlp1 || isInsulin || form.includes('injectable') ? 3 : ri(3, 6);
  for (let v = 0; v < nVariants && ndcSeq <= 260; v++) {
    const strength = choice(strengths);
    const pack = choice(PACKS);
    const labeler = pad(ri(10000, 99999), 5);
    const product = pad(ri(100, 999), 3);
    const pkgcode = pad(ri(10, 99), 2);
    const ndc = `${labeler}-${product}-${pkgcode}`;
    const isBrand = rand() < 0.35;
    const wac = Math.round(baseWac * pack * (isBrand ? 1 : rf(0.15, 0.4)) * 100) / 100;
    const row = {
      ndc,
      generic_name: generic,
      brand_name: isBrand ? brand : '',
      is_brand: isBrand,
      therapeutic_category: category,
      dosage_form: form,
      strength,
      pack_size: pack,
      dea_schedule: schedule,
      orange_book_te_code: te,
      manufacturer: isBrand ? `${brand.split(' ')[0]} Pharma Inc.` : choice(['Teva', 'Sandoz', 'Mylan/Viatris', 'Amneal', 'Lupin', 'Aurobindo']),
      velocity_tier: tier,
      is_glp1: isGlp1,
      is_insulin: isInsulin,
      is_controlled_substance: schedule > 0,
      is_340b_eligible: rand() < 0.4,
      wac_price_per_pack: wac,
      unit_cost_per_pack: Math.round(wac * rf(0.55, 0.85) * 100) / 100,
      ndc_directory_active: true,
    };
    formulary.push(row);
    shortageCandidatePool.push(row);
    ndcSeq++;
  }
}
writeCSV('formulary.csv',
  ['ndc', 'generic_name', 'brand_name', 'is_brand', 'therapeutic_category', 'dosage_form', 'strength', 'pack_size',
    'dea_schedule', 'orange_book_te_code', 'manufacturer', 'velocity_tier', 'is_glp1', 'is_insulin',
    'is_controlled_substance', 'is_340b_eligible', 'wac_price_per_pack', 'unit_cost_per_pack', 'ndc_directory_active'],
  formulary);

console.log(`Total NDCs generated: ${formulary.length}`);

// =========================================================
// 4. DISTRIBUTOR CONTRACTS
// =========================================================
const contracts = [];
let contractSeq = 1;
for (const drug of formulary) {
  const nContracts = ri(1, 2);
  const usedDist = new Set();
  for (let c = 0; c < nContracts; c++) {
    const dist = choice(distributors);
    if (usedDist.has(dist.distributor_id)) continue;
    usedDist.add(dist.distributor_id);
    const contractType = drug.is_340b_eligible && rand() < 0.5 ? '340B' : weightedChoice([['GPO', 6], ['Direct', 2], ['Prime Vendor', 2]]);
    const discount = contractType === '340B' ? rf(0.55, 0.75) : contractType === 'GPO' ? rf(0.08, 0.22) : rf(0.02, 0.10);
    contracts.push({
      contract_id: `CTR${pad(contractSeq++, 5)}`,
      ndc: drug.ndc,
      distributor_id: dist.distributor_id,
      contract_type: contractType,
      contract_price_per_pack: Math.round(drug.wac_price_per_pack * (1 - discount) * 100) / 100,
      effective_date: '2024-01-01',
      expiration_date: '2025-12-31',
      gpo_name: contractType === 'GPO' ? choice(['Premier', 'Vizient', 'HealthTrust']) : '',
    });
  }
}
writeCSV('distributor_contracts.csv',
  ['contract_id', 'ndc', 'distributor_id', 'contract_type', 'contract_price_per_pack', 'effective_date', 'expiration_date', 'gpo_name'],
  contracts);

// =========================================================
// 5. FDA / ASHP SHORTAGE EVENTS  (pick a handful of NDCs to go short)
// =========================================================
const shortageNdcs = [];
// 20 drugs (up from 10) spanning a wider mix of DEA schedules (0/2/4), TE-code classes, and
// therapeutic categories — deliberately broader coverage than a minimal demo needs, so the
// substitution_events this produces (see §8 below) form a more useful eval-harness dataset:
// more cases, and more variety in the scenarios an eval would need to score (e.g. Schedule
// II shortages with no substitute path at all, narrow-therapeutic-index drugs, everyday
// high-volume generics vs. specialty/biologic).
const shortageDrugsWanted = [
  'semaglutide', 'tirzepatide', 'amphetamine/dextroamphetamine', 'amoxicillin',
  'albuterol HFA', 'lisdexamfetamine', 'insulin glargine', 'methylphenidate ER',
  'oseltamivir', 'adalimumab',
  'insulin lispro', 'azithromycin', 'fluticasone/salmeterol', 'apixaban',
  'hydrocodone/acetaminophen', 'oxycodone', 'clonazepam', 'levothyroxine',
  'metformin', 'warfarin',
];
for (const g of shortageDrugsWanted) {
  const candidates = formulary.filter(f => f.generic_name === g);
  if (candidates.length) shortageNdcs.push(choice(candidates));
}
const SHORTAGE_REASONS = ['Manufacturing delay', 'Demand increase for the drug', 'Raw material shortage', 'Regulatory/quality issue at manufacturing site'];
const shortageEvents = [];
let shortageSeq = 1;
const SIM_START = '2024-01-01';
const SIM_DAYS = 964; // ~32 months, through 2026-08-21 — kept close to "today" so the demo's
// trailing window doesn't go stale; exceeds the PRD's 24-month training-data spec, giving
// headroom for backtesting once a real model replaces the trailing-average prototype forecaster
for (const drug of shortageNdcs) {
  const startOffset = ri(30, SIM_DAYS - 60);
  const durationDays = ri(25, 120);
  const startDate = dateAdd(SIM_START, startOffset);
  const resolved = (startOffset + durationDays) < SIM_DAYS;
  const endDate = resolved ? dateAdd(startDate, durationDays) : '';
  shortageEvents.push({
    shortage_id: `SHRT${pad(shortageSeq++, 4)}`,
    ndc: drug.ndc,
    generic_name: drug.generic_name,
    source: choice(['FDA Drug Shortage Database', 'ASHP Drug Shortages']),
    status: resolved ? 'Resolved' : 'Current',
    date_reported: startDate,
    date_resolved: endDate,
    reason: choice(SHORTAGE_REASONS),
    severity: choice(['Partial - allocation in place', 'Full shortage - no supply', 'Partial - limited manufacturers']),
    bulletin_id: `${choice(['FDA', 'ASHP'])}-${startDate.slice(0, 4)}-${pad(shortageSeq, 4)}`,
  });
}
writeCSV('fda_ashp_shortage_events.csv',
  ['shortage_id', 'ndc', 'generic_name', 'source', 'status', 'date_reported', 'date_resolved', 'reason', 'severity', 'bulletin_id'],
  shortageEvents);

// unstructured ASHP-style bulletin text samples
let bulletinText = '';
for (const s of shortageEvents) {
  bulletinText += `================================================================\n`;
  bulletinText += `Bulletin ID: ${s.bulletin_id}\nSource: ${s.source}\nDate Reported: ${s.date_reported}\n\n`;
  bulletinText += `${s.generic_name.toUpperCase()} (NDC ${s.ndc}) — Drug Shortage Update\n\n`;
  bulletinText += `Reason for Shortage: ${s.reason}.\n`;
  bulletinText += `Current Status: ${s.status === 'Current' ? 'This drug is currently in shortage.' : `This shortage was resolved on ${s.date_resolved}.`}\n`;
  bulletinText += `Estimated Resupply: ${s.status === 'Current' ? choice(['Manufacturer estimates resupply in 4-6 weeks.', 'No confirmed resupply date at this time.', 'Limited quantities expected within 30 days.']) : 'N/A - resolved.'}\n`;
  bulletinText += `Severity: ${s.severity}\n`;
  bulletinText += `Alternative agents/therapeutic equivalents should be evaluated per Orange Book TE coding and formulary status. Contact your wholesaler for allocation details.\n\n`;
}
fs.writeFileSync(path.join(OUT, 'ashp_shortage_bulletins_raw.txt'), bulletinText);
console.log('wrote ashp_shortage_bulletins_raw.txt');

// =========================================================
// 6. CORE SIMULATION: dispense, inventory, PO -> 855 -> 856, stockouts, expirations
// =========================================================
const dispenseRows = [];
const poRows = [];
const ackRows = [];
const asnRows = [];
const stockoutRows = [];
const invSnapshotRows = [];
const expirationRows = [];

const TIER_LAMBDA = { A: 4.5, B: 1.1, C: 0.18 }; // avg units/store/day baseline
const REORDER_DAYS_OF_SUPPLY = { A: 7, B: 10, C: 21 };
const TARGET_DAYS_OF_SUPPLY = { A: 14, B: 21, C: 45 };

function seasonalMultiplier(dateStr, dayOffset, category, isGlp1) {
  const month = Number(dateStr.slice(5, 7)); // recalculated from the calendar date so flu/allergy bumps repeat correctly in year 2
  let m = 1.0;
  if ((category === 'Antibiotic' || category === 'Antiviral' || category === 'Respiratory/Inhaler') && (month === 1 || month === 2)) m *= 1.6;
  if (category.includes('Antihistamine') && (month === 4 || month === 5)) m *= 1.8;
  if (isGlp1) m *= 1 + 0.0007 * dayOffset; // cumulative growth trend across the full 24-month window (~1.5x by month 24), not reset each January
  return m;
}

let poSeq = 1, ackSeq = 1, asnSeq = 1;
const shortageByNdc = {};
for (const s of shortageEvents) shortageByNdc[s.ndc] = s;

for (const store of stores) {
  for (const drug of formulary) {
    const lambdaBase = TIER_LAMBDA[drug.velocity_tier] * rf(0.6, 1.6);
    let onHand = Math.round(lambdaBase * TARGET_DAYS_OF_SUPPLY[drug.velocity_tier]);
    let pendingPO = null; // {po_id, expected_qty, arrival_date}
    const reorderDOS = REORDER_DAYS_OF_SUPPLY[drug.velocity_tier];
    const targetDOS = TARGET_DAYS_OF_SUPPLY[drug.velocity_tier];

    for (let dayOffset = 0; dayOffset < SIM_DAYS; dayOffset++) {
      const date = dateAdd(SIM_START, dayOffset);
      const dow = dowSunday0(date);
      let mult = seasonalMultiplier(date, dayOffset, drug.therapeutic_category, drug.is_glp1);
      if (dow === 0) mult *= 0.35; // Sunday closed/low
      if (dow === 6) mult *= 0.75; // Saturday lighter

      // shortage impact: demand may spike (panic-buying/backfill) then supply constrained
      const shortage = shortageByNdc[drug.ndc];
      let shortageActive = false;
      if (shortage) {
        const reportOffset = (new Date(shortage.date_reported) - new Date(SIM_START)) / 86400000;
        const resolveOffset = shortage.date_resolved ? (new Date(shortage.date_resolved) - new Date(SIM_START)) / 86400000 : SIM_DAYS + 999;
        if (dayOffset >= reportOffset && dayOffset < resolveOffset) shortageActive = true;
      }

      const lambda = lambdaBase * mult;
      const demand = poisson(lambda);

      // Receive inbound PO if arrived
      if (pendingPO && pendingPO.arrival_date === date) {
        onHand += pendingPO.qty;
        asnRows.push({
          asn_id: `ASN${pad(asnSeq++, 6)}`,
          po_id: pendingPO.po_id,
          shipment_date: dateAdd(date, -1),
          delivery_date: date,
          carrier: choice(['FedEx Freight', 'UPS Freight', 'Distributor Truck Route']),
          store_id: store.store_id,
          ndc: drug.ndc,
          quantity_shipped: pendingPO.qty,
        });
        pendingPO = null;
      }

      // Fulfill demand
      let dispensedQty = Math.min(demand, Math.max(onHand, 0));
      if (dispensedQty > 0) {
        dispenseRows.push({
          date, store_id: store.store_id, ndc: drug.ndc,
          quantity_dispensed: dispensedQty,
          days_supply: choice([30, 60, 90]),
          payer_type: weightedChoice([['commercial', 5], ['medicare_part_d', 3], ['medicaid', 2], ['cash', 1], ['340b', drug.is_340b_eligible ? 2 : 0]]),
          rx_fill_count: ri(1, Math.max(1, Math.round(dispensedQty / 3))),
        });
      }
      onHand -= dispensedQty;

      // Stockout detection
      if (demand > dispensedQty) {
        const unitsShort = demand - dispensedQty;
        stockoutRows.push({
          date, store_id: store.store_id, ndc: drug.ndc,
          units_short: unitsShort,
          hours_out_of_stock: ri(4, 20),
          lost_rx_estimate: Math.max(1, Math.round(unitsShort / 2)),
          shortage_linked: shortageActive,
        });
      }

      // Reorder logic
      const avgDailyDemand = Math.max(lambdaBase, 0.05);
      const daysOfSupply = onHand / avgDailyDemand;
      if (!pendingPO && daysOfSupply < reorderDOS) {
        const targetQty = Math.max(1, Math.round(avgDailyDemand * targetDOS) - onHand);
        const distributor = shortageActive && rand() < 0.6 ? choice(['CAH', 'ABC']) : 'MCK';
        const distObj = distributors.find(d => d.distributor_id === distributor);
        const poId = `PO${pad(poSeq++, 6)}`;
        poRows.push({
          po_id: poId, po_date: date, store_id: store.store_id, distributor_id: distributor,
          ndc: drug.ndc, quantity_ordered: targetQty,
          unit_price: (contracts.find(c => c.ndc === drug.ndc && c.distributor_id === distributor) || {}).contract_price_per_pack || drug.wac_price_per_pack,
          edi_transaction_set: '850', status: 'Transmitted',
        });

        // 855 ack, 1-2 days later; backorder/partial if shortage active
        const ackDate = dateAdd(date, ri(0, 1));
        let ackStatus = 'Accepted';
        let qtyConfirmed = targetQty;
        if (shortageActive) {
          ackStatus = weightedChoice([['Backordered', 5], ['Partial Allocation', 4], ['Accepted', 1]]);
          qtyConfirmed = ackStatus === 'Accepted' ? targetQty : Math.round(targetQty * rf(0.2, 0.6));
        }
        ackRows.push({
          ack_id: `ACK${pad(ackSeq++, 6)}`, po_id: poId, ack_date: ackDate,
          line_status: ackStatus, quantity_confirmed: qtyConfirmed,
          promised_ship_date: dateAdd(ackDate, distObj.avg_lead_time_days + (shortageActive ? ri(5, 20) : 0)),
          edi_transaction_set: '855',
        });

        const arrivalDate = dateAdd(ackDate, distObj.avg_lead_time_days + (shortageActive ? ri(5, 20) : ri(0, 1)));
        pendingPO = { po_id: poId, qty: qtyConfirmed, arrival_date: arrivalDate };
      }

      // periodic inventory snapshot (weekly)
      if (dayOffset % 7 === 0) {
        invSnapshotRows.push({
          date, store_id: store.store_id, ndc: drug.ndc,
          on_hand_qty: Math.max(0, onHand),
          in_transit_qty: pendingPO ? pendingPO.qty : 0,
          days_of_supply: Math.round(daysOfSupply * 10) / 10,
          reorder_point_days: reorderDOS,
          target_days_of_supply: targetDOS,
        });
      }
    }

    // expiration write-off chance for slow movers (tier C) with excess stock at end of sim
    if (drug.velocity_tier === 'C' && rand() < 0.12) {
      expirationRows.push({
        writeoff_id: `EXP${pad(expirationRows.length + 1, 5)}`,
        store_id: store.store_id, ndc: drug.ndc,
        lot_number: `LOT${ri(100000, 999999)}`,
        expiration_date: dateAdd(SIM_START, SIM_DAYS + ri(5, 60)),
        writeoff_date: dateAdd(SIM_START, SIM_DAYS - ri(0, 10)),
        quantity_written_off: ri(2, 20),
        unit_cost: drug.unit_cost_per_pack,
        writeoff_value: 0, // filled below
      });
      const last = expirationRows[expirationRows.length - 1];
      last.writeoff_value = Math.round(last.quantity_written_off * last.unit_cost * 100) / 100;
    }
  }
}

writeCSV('dispense_history.csv',
  ['date', 'store_id', 'ndc', 'quantity_dispensed', 'days_supply', 'payer_type', 'rx_fill_count'], dispenseRows);
writeCSV('edi_850_purchase_orders.csv',
  ['po_id', 'po_date', 'store_id', 'distributor_id', 'ndc', 'quantity_ordered', 'unit_price', 'edi_transaction_set', 'status'], poRows);
writeCSV('edi_855_po_acknowledgements.csv',
  ['ack_id', 'po_id', 'ack_date', 'line_status', 'quantity_confirmed', 'promised_ship_date', 'edi_transaction_set'], ackRows);
writeCSV('edi_856_asn_shipments.csv',
  ['asn_id', 'po_id', 'shipment_date', 'delivery_date', 'carrier', 'store_id', 'ndc', 'quantity_shipped'], asnRows);
writeCSV('stockout_events.csv',
  ['date', 'store_id', 'ndc', 'units_short', 'hours_out_of_stock', 'lost_rx_estimate', 'shortage_linked'], stockoutRows);
writeCSV('inventory_snapshot_weekly.csv',
  ['date', 'store_id', 'ndc', 'on_hand_qty', 'in_transit_qty', 'days_of_supply', 'reorder_point_days', 'target_days_of_supply'], invSnapshotRows);
writeCSV('expiration_writeoffs.csv',
  ['writeoff_id', 'store_id', 'ndc', 'lot_number', 'expiration_date', 'writeoff_date', 'quantity_written_off', 'unit_cost', 'writeoff_value'], expirationRows);

// =========================================================
// 7. BUYER OVERRIDES
// =========================================================
const overrideRows = [];
const overrideTypes = ['never_substitute', 'preferred_distributor', 'custom_par_level', 'never_generic', 'always_secondary_source'];
for (let i = 0; i < 70; i++) {
  const drug = choice(formulary);
  const store = rand() < 0.5 ? choice(stores) : null;
  const type = choice(overrideTypes);
  overrideRows.push({
    override_id: `OVR${pad(i + 1, 4)}`,
    buyer_id: `BUYER${ri(1, 4)}`,
    store_id: store ? store.store_id : 'ALL_STORES',
    ndc: drug.ndc,
    generic_name: drug.generic_name,
    override_type: type,
    rationale: choice([
      'Patient continuity of care preference from PIC', 'Historical adverse substitution feedback',
      'Preferred generic manufacturer per contract', 'Store-level insurance mix favors this NDC',
      'Pharmacist-in-charge clinical preference', 'Avoids prior stockout pattern with alternate distributor',
    ]),
    created_date: dateAdd(SIM_START, ri(0, SIM_DAYS - 1)),
    active: rand() < 0.85,
  });
}
writeCSV('buyer_overrides.csv',
  ['override_id', 'buyer_id', 'store_id', 'ndc', 'generic_name', 'override_type', 'rationale', 'created_date', 'active'],
  overrideRows);

// =========================================================
// 8. SUBSTITUTION EVENTS (tied to shortages)
// =========================================================
const subRows = [];
let subSeq = 1;
for (const s of shortageEvents) {
  const shortDrug = formulary.find(f => f.ndc === s.ndc);
  const alternatives = formulary.filter(f => f.generic_name === shortDrug.generic_name && f.ndc !== shortDrug.ndc);
  const nEvents = ri(10, 25); // widened from ri(6,15) for a larger eval-label pool per shortage
  for (let i = 0; i < nEvents; i++) {
    const store = choice(stores);
    const alt = alternatives.length ? choice(alternatives) : shortDrug;
    const accepted = rand() < 0.74;
    const teMatch = shortDrug.orange_book_te_code !== 'NA' && shortDrug.orange_book_te_code === alt.orange_book_te_code;
    // Was a flat rand() < 0.95 regardless of TE match — meaningless as an eval label,
    // since a real pharmacist's appropriateness call is driven substantially by TE
    // equivalence. Now conditional: a TE-matched substitute is clinically standard
    // (pharmacists agree almost every time); a non-TE-matched one is genuinely
    // contestable (roughly a coin flip, leaning unfavorable) — same single rand() draw
    // per row either way, just a different threshold, so this doesn't shift any other
    // file's RNG sequence (this is also the last block in the script).
    const appropriateThreshold = teMatch ? 0.96 : 0.45;
    subRows.push({
      substitution_id: `SUB${pad(subSeq++, 5)}`,
      shortage_id: s.shortage_id,
      date: dateAdd(s.date_reported, ri(0, 20)),
      store_id: store.store_id,
      original_ndc: shortDrug.ndc,
      proposed_alt_ndc: alt.ndc,
      orange_book_te_match: teMatch,
      buyer_decision: accepted ? 'Accepted' : choice(['Rejected', 'Deferred']),
      pharmacist_rated_appropriate: rand() < appropriateThreshold,
    });
  }
}
writeCSV('substitution_events.csv',
  ['substitution_id', 'shortage_id', 'date', 'store_id', 'original_ndc', 'proposed_alt_ndc', 'orange_book_te_match', 'buyer_decision', 'pharmacist_rated_appropriate'],
  subRows);

console.log('\nAll files generated in', OUT);
