// REAL live shortage feed — openFDA's public Drug Shortages API
// (https://api.fda.gov/drug/shortages.json), added 2026-08-14 in response to the user
// wanting an actual live FDA check rather than the static synthetic CSV loader.js reads
// by default. This is a genuine, verified-working integration (tested live against the
// real endpoint while building this — not guessed from documentation): confirmed query
// syntax, confirmed response shape, confirmed the dataset updates daily.
//
// Feature-flagged off by default (SHORTAGE_FEED_ENABLED unset) — when off, nothing about
// the app's existing synthetic-data behavior changes. loader.js's demoStatusOverride
// relabeling (see its own comment) is the fallback either way.
//
// Honest scoping note, worth repeating wherever this is discussed — and stronger than it
// first looks: this prototype's synthetic formulary (loader.js / GAPS.md "Data scope")
// uses FICTIONAL NDCs, not real FDA-registered ones. Verified 2026-08-14 by querying
// openFDA's real NDC Directory (api.fda.gov/drug/ndc.json) against a sample of the
// synthetic formulary's NDCs — all came back NOT_FOUND. So with the real 60-NDC (or even
// the full 8,000-SKU, PRD.md Appendix B) synthetic formulary, this will ALWAYS return
// zero live matches — that's not a scope-size problem, it's that these specific NDCs
// don't exist in the real world. Zero here is the correct, honest outcome for THIS
// dataset. The mapping/matching logic itself is separately verified working (tested
// against a real, currently-active openFDA shortage entry, 0409-1312-30) — it's the
// synthetic data, not the integration, that's the reason for zero. A real pilot chain's
// actual formulary (real NDCs) is what would make this feed return real results.
//
// No API key is required for light use; set FDA_OPENFDA_API_KEY (free, from
// open.fda.gov) to raise the rate limit before polling frequently or against a larger
// formulary.

const OPENFDA_BASE = 'https://api.fda.gov/drug/shortages.json';

export function isShortageFeedEnabled() {
  return process.env.SHORTAGE_FEED_ENABLED === 'true';
}

export function shortageFeedPollMinutes() {
  return Number(process.env.SHORTAGE_FEED_POLL_MINUTES ?? 15);
}

function productNdcPrefix(fullNdc) {
  // "77533-128-14" -> "77533-128" (openFDA's openfda.product_ndc has no package segment)
  const parts = fullNdc.split('-');
  return parts.slice(0, 2).join('-');
}

function mdyToIso(mdy) {
  if (!mdy) return null;
  const [m, d, y] = mdy.split('/');
  if (!y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function inferSeverity(availability) {
  // openFDA has no severity field like the synthetic dataset's `severity` column — this
  // is a stated heuristic derived from `availability`, not an FDA-published rating.
  if (availability === 'Unavailable') return 'Full shortage - no supply (inferred from FDA availability=Unavailable)';
  if (availability === 'Available') return 'Limited supply (listed as shortage, inferred from FDA availability=Available)';
  return 'Severity not stated by FDA';
}

/**
 * Queries openFDA for shortages matching the given formulary NDCs. Returns shortage
 * objects in the same shape loader.js produces from the synthetic CSV, so callers
 * (buildLiveSubstitutions, the shortages route) don't need to know which source it
 * came from. Never throws — a failed/empty fetch returns [] so the app degrades to
 * "no live shortages found" rather than crashing.
 */
export async function fetchLiveShortages(formularyNdcs) {
  if (!formularyNdcs?.length) return [];

  const prefixes = [...new Set(formularyNdcs.map(productNdcPrefix))];
  const searchClause = prefixes.map(p => `"${p}"`).join('+');
  const searchParam = `openfda.product_ndc:(${searchClause})`;

  // Deliberately NOT built with URLSearchParams: openFDA's Lucene-style query syntax
  // needs a literal `+` between OR'd terms, but URLSearchParams percent-encodes `+` to
  // `%2B` (correct per the URL spec, since a raw `+` in a query string conventionally
  // means "space" — but openFDA's parser doesn't accept %2B the same way). That mismatch
  // silently produced a 404 "no matches" — indistinguishable from a genuine empty
  // result — verified live during this build; encodeURIComponent + restoring literal
  // `+` afterward is what actually works, confirmed against the real endpoint.
  const encodedSearch = encodeURIComponent(searchParam).replace(/%2B/g, '+');
  const apiKeyPart = process.env.FDA_OPENFDA_API_KEY ? `&api_key=${encodeURIComponent(process.env.FDA_OPENFDA_API_KEY)}` : '';
  const url = `${OPENFDA_BASE}?search=${encodedSearch}&limit=100${apiKeyPart}`;

  let data;
  try {
    const res = await fetch(url);
    if (res.status === 404) return []; // openFDA's "No matches found!" shape
    if (!res.ok) {
      console.error(`[shortageFeed] ${res.status} ${res.statusText}`);
      return [];
    }
    data = await res.json();
  } catch (err) {
    console.error('[shortageFeed] fetch failed:', err.message);
    return [];
  }

  const results = data?.results || [];
  const out = [];
  let seq = 1;
  for (const r of results) {
    const productNdcs = r.openfda?.product_ndc || [];
    // One live result can cover several package sizes — surface it once per formulary
    // NDC that actually matches, so it slots into the rest of the app (which keys
    // everything off the formulary's own NDC) without a lookup table.
    const matchingFormularyNdcs = formularyNdcs.filter(ndc => productNdcs.includes(productNdcPrefix(ndc)));
    for (const ndc of matchingFormularyNdcs) {
      out.push({
        id: `FDALIVE${String(seq++).padStart(4, '0')}`,
        ndc,
        genericName: (r.openfda?.generic_name?.[0] || r.generic_name || '').toLowerCase(),
        source: 'FDA Drug Shortages Database (live)',
        status: r.status || 'Unknown',
        dateReported: mdyToIso(r.initial_posting_date) || mdyToIso(r.change_date),
        dateResolved: r.status === 'Resolved' ? mdyToIso(r.change_date) : null,
        reason: r.shortage_reason || 'Not stated by FDA',
        severity: inferSeverity(r.availability),
        bulletinId: null,
        // No synthetic bulletin text exists for a live result — this is what
        // shortages.js's route falls back to instead (see its bulletinExcerpt()).
        liveDetailText: [
          r.presentation,
          r.company_name ? `Manufacturer: ${r.company_name}` : null,
          r.related_info,
          r.contact_info ? `Contact: ${r.contact_info}` : null,
        ].filter(Boolean).join(' — '),
      });
    }
  }
  return out;
}
