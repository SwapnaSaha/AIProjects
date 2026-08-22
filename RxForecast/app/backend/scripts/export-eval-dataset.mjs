// Builds the offline substitution-appropriateness eval set (PRD.md §8 "Substitution —
// pharmacist-rated appropriateness on N sampled cases"; lld.md §4.5's Foundry Evaluation
// SDK layer). Reads the ground-truth labels already sitting in substitution_events.csv
// and reshapes them into the facts+ground-truth pairs app/evals/run_eval.py consumes.
//
// Dedupes by (original_ndc, alt_ndc): the facts a real call would reason from (TE match,
// contract, DEA schedule — see substitution.js's factsForPrompt()) don't vary by store or
// date, only by which two drugs are being compared, so scoring the same pair repeatedly
// would just burn Foundry calls without adding signal. Each pair's ground truth is the
// pharmacist-appropriate rate across every historical event recorded for that exact pair.
//
// Reads formulary/contracts from the full external dataset, not the demo-trimmed
// seed-data/ copy: the eval doesn't call through the running app, so it isn't bound to
// the 60-NDC demo cap, and using the full ~208-NDC formulary means most alt_ndc values
// actually resolve (seed-data/'s trim only guarantees the *original* NDC of a shortage is
// present, not every alternative — using it here would silently drop most pairs, 70 -> 18
// in testing). substitution_events.csv itself is read from seed-data/ since it's already
// committed and identical either way (every row's original_ndc is demo-in-scope already).
//
// Run with: node scripts/export-eval-dataset.mjs (from app/backend/) — requires the full
// external RxForecast_SyntheticData/ dataset (see generate.cjs) to exist locally.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, toBool, toNum } from '../src/lib/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../seed-data');
const SRC_DIR = path.resolve(__dirname, '../../../../RxForecast_SyntheticData');
const OUT_DIR = path.resolve(__dirname, '../../evals/data');
const OUT_FILE = path.join(OUT_DIR, 'substitution_pairs.jsonl');

function readCsv(name, dir = SRC_DIR) {
  return parseCSV(fs.readFileSync(path.join(dir, name), 'utf8'));
}

const substitutions = readCsv('substitution_events.csv', SEED_DIR);
const formulary = readCsv('formulary.csv');
const contracts = readCsv('distributor_contracts.csv');
const formularyByNdc = new Map(formulary.map(f => [f.ndc, f]));

// Same lookup priority substitution.js's factsForPrompt() uses: first contract found
// for that NDC (the demo dataset doesn't disambiguate "best" contract any further).
function contractFor(ndc) {
  const c = contracts.find(c => c.ndc === ndc);
  return c ? { distributorId: c.distributor_id, type: c.contract_type, priceUsd: toNum(c.contract_price_per_pack) } : null;
}

const pairs = new Map(); // "original|alt" -> { ...facts, appropriateVotes: [], n }
for (const row of substitutions) {
  const key = `${row.original_ndc}|${row.proposed_alt_ndc}`;
  if (!pairs.has(key)) {
    const original = formularyByNdc.get(row.original_ndc);
    const alt = formularyByNdc.get(row.proposed_alt_ndc);
    if (!original || !alt) continue; // pair falls outside the trimmed demo formulary
    pairs.set(key, {
      originalNdc: row.original_ndc,
      altNdc: row.proposed_alt_ndc,
      originalGenericName: original.generic_name,
      altGenericName: alt.generic_name,
      teMatch: toBool(row.orange_book_te_match),
      originalTeCode: original.orange_book_te_code || 'NA',
      altTeCode: alt.orange_book_te_code || 'NA',
      contract: contractFor(row.proposed_alt_ndc),
      controlled: toBool(alt.is_controlled_substance),
      deaSchedule: toBool(alt.is_controlled_substance) ? toNum(alt.dea_schedule) : null,
      appropriateVotes: [],
    });
  }
  pairs.get(key).appropriateVotes.push(toBool(row.pharmacist_rated_appropriate));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const lines = [];
let seq = 1;
for (const p of pairs.values()) {
  const n = p.appropriateVotes.length;
  const appropriateRate = p.appropriateVotes.filter(Boolean).length / n;
  const { appropriateVotes, ...facts } = p;
  lines.push(JSON.stringify({
    pairId: `PAIR${String(seq++).padStart(4, '0')}`,
    ...facts,
    nHistoricalEvents: n,
    pharmacistAppropriateRate: Math.round(appropriateRate * 1000) / 1000,
    // >=0.5 threshold mirrors substitution.js's own confidence split (0.86 vs 0.52) —
    // "more often than not judged appropriate" as the bucket boundary.
    groundTruthLabel: appropriateRate >= 0.5 ? 'appropriate' : 'flagged',
  }));
}
fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');
console.log(`Wrote ${lines.length} unique substitution pairs (from ${substitutions.length} historical events) to ${OUT_FILE}`);
