// One-time (re-runnable) script: reads the full external synthetic dataset
// (RxForecast_SyntheticData/, ~101MB, deliberately never committed to git) and writes a
// trimmed, deploy-friendly copy into app/backend/seed-data/ — the exact NDC/store/date
// slice loadDemoData() would compute anyway, just pre-filtered so a deployed environment
// never needs the full dataset at all. loader.js's own transform logic is untouched;
// only SYNTH_DIR changes, since these files keep the identical raw column headers.
//
// The full external dataset this script reads from is itself produced by
// scripts/generate.cjs (also committed) — run that first if you need to regenerate the
// ~101MB source before re-running this trimming step.
//
// Run with: node scripts/export-seed-data.mjs (from app/backend/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../src/lib/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../../../../RxForecast_SyntheticData');
const OUT_DIR = path.resolve(__dirname, '../seed-data');

function readRawText(name) {
  return fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
}

// Proper CSV field quoting — mirrors parseCSV's own escaping convention (double-quote
// doubling) so a round trip through this script never corrupts a field with a comma,
// quote, or newline in it (buyer_overrides.csv's free-text rationale, for instance).
function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsvFromRows(name, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map(h => csvField(r[h])).join(','));
  fs.writeFileSync(path.join(OUT_DIR, name), lines.join('\n') + '\n');
  return rows.length;
}

// Robust path (parseCSV, handles quoted fields) for the smaller files.
function writeFilteredCsvRobust(name, predicate) {
  const text = readRawText(name);
  const header = text.split('\n')[0].replace(/\r$/, '').split(',');
  const rows = parseCSV(text).filter(predicate);
  return writeCsvFromRows(name, header, rows);
}

// Fast line-based path for the two large files — safe only because loader.js's own
// readFilteredSimple() already assumes these are comma-safe (no quoted/comma fields).
function writeFilteredCsvFast(name, predicate) {
  const text = readRawText(name);
  const lines = text.split('\n').filter(l => l.length > 0);
  const header = lines[0].replace(/\r$/, '').split(',');
  const kept = [header.join(',')];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].replace(/\r$/, '').split(',');
    if (cols.length !== header.length) continue;
    const obj = {};
    header.forEach((h, idx) => { obj[h] = cols[idx]; });
    if (predicate(obj)) kept.push(lines[i].replace(/\r$/, ''));
  }
  fs.writeFileSync(path.join(OUT_DIR, name), kept.join('\n') + '\n');
  return kept.length - 1;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Replicate loadDemoData()'s exact NDC-selection logic (loader.js lines ~51-56) so the
// deployed app shows exactly the same demo scope as local dev — not a re-derivation,
// a literal copy of that selection rule.
const formularyRaw = parseCSV(readRawText('formulary.csv'));
const shortagesRaw = parseCSV(readRawText('fda_ashp_shortage_events.csv'));
const overridesRaw = parseCSV(readRawText('buyer_overrides.csv'));
const storesRaw = parseCSV(readRawText('stores.csv'));

const shortageNdcs = new Set(shortagesRaw.map(s => s.ndc));
const overrideNdcs = new Set(overridesRaw.map(o => o.ndc));
const tierA = formularyRaw.filter(f => f.velocity_tier === 'A').map(f => f.ndc);
const mustInclude = new Set([...shortageNdcs, ...overrideNdcs]);
const demoNdcList = [...new Set([...mustInclude, ...tierA])].slice(0, 60);
const demoNdcSet = new Set(demoNdcList);
const storeSet = new Set(storesRaw.map(s => s.store_id));

// Small files, copied through unfiltered — already tiny, and stores/distributors have
// no NDC dimension to trim by anyway.
fs.copyFileSync(path.join(SRC_DIR, 'stores.csv'), path.join(OUT_DIR, 'stores.csv'));
fs.copyFileSync(path.join(SRC_DIR, 'distributors.csv'), path.join(OUT_DIR, 'distributors.csv'));
fs.copyFileSync(path.join(SRC_DIR, 'ashp_shortage_bulletins_raw.txt'), path.join(OUT_DIR, 'ashp_shortage_bulletins_raw.txt'));

const counts = {
  formulary: writeFilteredCsvRobust('formulary.csv', r => demoNdcSet.has(r.ndc)),
  distributor_contracts: writeFilteredCsvRobust('distributor_contracts.csv', r => demoNdcSet.has(r.ndc)),
  fda_ashp_shortage_events: writeFilteredCsvRobust('fda_ashp_shortage_events.csv', r => demoNdcSet.has(r.ndc)),
  substitution_events: writeFilteredCsvRobust('substitution_events.csv', r => demoNdcSet.has(r.original_ndc)),
  buyer_overrides: writeFilteredCsvRobust('buyer_overrides.csv', r => demoNdcSet.has(r.ndc)),
  // Same 150-day window loader.js itself uses (minDate: '2026-03-24') — kept in sync
  // manually since this script pre-computes what loader.js would otherwise filter live.
  dispense_history: writeFilteredCsvFast('dispense_history.csv', r => storeSet.has(r.store_id) && demoNdcSet.has(r.ndc) && r.date >= '2026-03-24'),
  inventory_snapshot_weekly: writeFilteredCsvFast('inventory_snapshot_weekly.csv', r => storeSet.has(r.store_id) && demoNdcSet.has(r.ndc)),
};

console.log(`Exported trimmed seed data to ${OUT_DIR}`);
console.log(`demoNdcList: ${demoNdcList.length} NDCs, ${storesRaw.length} stores`);
console.log(counts);
