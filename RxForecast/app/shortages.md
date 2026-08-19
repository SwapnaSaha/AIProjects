# Shortage Alerts — Computation Reference

**Scope:** this documents exactly how every field, badge, and interaction on the Shortages page is computed **in the current prototype**, grounded directly in the code — not the production spec. Where the prototype's approach differs from what `lld.md`/`engg.md` actually call for production, that's flagged explicitly in §7, same convention as `GAPS.md`, `reorder.md`, and `dashboard.md`.

Source files referenced throughout:
- [`backend/src/routes/shortages.js`](./backend/src/routes/shortages.js) — the shortage list, bulletin excerpt, and substitution-decision endpoints
- [`backend/src/lib/substitution.js`](./backend/src/lib/substitution.js) — the Substitution Reasoner: alternatives, rationale, confidence
- [`backend/src/lib/shortageFeed.js`](./backend/src/lib/shortageFeed.js) — the real openFDA live-feed integration
- [`backend/src/data/loader.js`](./backend/src/data/loader.js) — the synthetic-data fallback and its relabeling logic
- [`backend/src/context.js`](./backend/src/context.js) — wires the two data sources together, drives the live poller
- [`frontend/src/pages/Shortages.tsx`](./frontend/src/pages/Shortages.tsx) — rendering + interactions

---

## 1. How this page works, overall

Two independent queries drive the page:
- `GET /api/shortages?status=current` — the shortage list itself
- `GET /api/shortages/feed-status`, polled every **60 seconds**, returning `{ liveFeedActive, shortageCount }` — purely so the page's caption can honestly say whether it's showing live openFDA data or the synthetic demo fallback

Expanding a shortage card triggers a third query, `GET /api/shortages/:id/substitutions`, fetched lazily (`enabled: expanded`) — substitution data for a card you never open is never requested.

**There are two entirely different sources for the shortage list itself**, switched by one flag:

| Source | When active | Where |
|---|---|---|
| Synthetic CSV (relabeled) | `SHORTAGE_FEED_ENABLED` unset/false (the default) | `loader.js`, computed once at boot |
| Live openFDA feed | `SHORTAGE_FEED_ENABLED=true` | `shortageFeed.js`, computed at boot **and** re-polled on an interval (`SHORTAGE_FEED_POLL_MINUTES`, default 15) |

Whichever is active, `ctx.shortages` ends up in the exact same shape either way — the rest of the app (this page, the Substitution Reasoner, the Dashboard's active-shortage count) doesn't know or care which source produced it.

---

## 2. The shortage list — synthetic mode (default)

From `loader.js`. The synthetic dataset's internal clock ends 2025-12-30, so most of its 10 shortage events had already "resolved" by that date — only 1 was genuinely `Current`. To make the page demoable, the loader **relabels up to 5 events as `Current`**: the one real current event, plus the most recently-reported resolved ones (sorted by `dateReported` descending, filling up to 5 total). This is not hidden — each relabeled entry carries `demoStatusOverride: true` in the raw API response (not currently surfaced in the UI itself).

Fields, straight from the CSV, unmodified:

| Field | Source |
|---|---|
| `genericName`, `ndc` | The shortage event's drug identity |
| `reason` | e.g. "Manufacturing delay", "Raw material shortage" |
| `severity` | e.g. "Full shortage - no supply", "Partial - limited manufacturers" — a stated category in the synthetic data, not computed |
| `source` | "FDA Drug Shortage Database" or "ASHP Drug Shortages" — which synthetic source generated the record |
| `dateReported` | Static date, unrelated to today's real date — this is why shortages can look "backdated" even though the entry is marked `Current` (see the earlier "why do shortages look backdated" discussion — same mechanism) |
| `bulletinId` | Links to a synthetic bulletin text blob (§4) |

## 3. The shortage list — live openFDA mode

From `shortageFeed.js`, only active when `SHORTAGE_FEED_ENABLED=true`. Queries `api.fda.gov/drug/shortages.json`, scoped to the loaded formulary's NDCs via an `openfda.product_ndc:(...)` OR-query.

| Field | Computation |
|---|---|
| `genericName` | `openfda.generic_name[0]`, lowercased |
| `status` | Passed through directly from openFDA's own `status` field |
| `dateReported` | `initial_posting_date` (or `change_date` as fallback), reformatted from `MM/DD/YYYY` to ISO |
| `reason` | openFDA's `shortage_reason` field, or `"Not stated by FDA"` if absent |
| `severity` | **Not an FDA-published field** — inferred from `availability`: `Unavailable` → "Full shortage - no supply (inferred...)", `Available` → "Limited supply (inferred...)", explicitly labeled as an inference either way |
| `bulletinId` | Always `null` — no synthetic bulletin blob exists for a live result |
| `liveDetailText` | Assembled from `presentation`, `company_name`, `related_info`, and `contact_info` — this is what the bulletin-excerpt panel shows instead (§4) |

**Important, not just a caveat:** the synthetic formulary's NDCs are fictional — verified against openFDA's real NDC Directory, confirmed not-found. So live mode will show **0 shortages** against this dataset, always, regardless of formulary size. The page's caption changes specifically to say this (`feedStatus.liveFeedActive` branch in `Shortages.tsx`), rather than leaving the "FDA/ASHP feeds" language that's only accurate in synthetic mode.

---

## 4. The "expand" interaction — bulletin excerpt

Clicking a card toggles `expanded` (local component state, no server round-trip for the toggle itself). What renders as the excerpt block depends on which mode produced the shortage:

- **Synthetic mode:** `bulletinExcerpt()` in `shortages.js` does a plain string search for the shortage's `bulletinId` inside one large raw text file (`ashp_shortage_bulletins_raw.txt`) and slices out a window (60 characters before the match through 500 characters after) — a crude but real excerpt of synthetic bulletin prose.
- **Live mode:** falls back to the `liveDetailText` string built in §3 — there's no bulletin blob to search.

The route always tries `liveDetailText` first (`s.liveDetailText || bulletinExcerpt(s.bulletinId)`), so this works correctly for either source without the frontend needing to know which one is active.

---

## 5. The substitution list (on expand)

Fetched from `state.substitutions`, which was pre-computed once — at boot in synthetic mode, or on every live-feed poll cycle in live mode — by `buildLiveSubstitutions()` in `substitution.js`. This is **not** computed on demand per card click; the click just fetches the already-built recommendations for that shortage's ID.

### 5.1 Which alternatives are offered

`findAlternatives()`: every formulary drug sharing the same `genericName` as the shortage NDC (excluding itself), ranked with any TE-code match sorted first, capped at the top 2. Computed once per shortage across the first 3 stores in the store list (`stores.slice(0, 3)`) — a demo-scale limitation, not per-store-in-formulary.

### 5.2 The rationale text

Two paths, same as documented in the earlier Foundry work:

- **Template (default, no Foundry configured):** a deterministic sentence built from real structured facts — TE code match/mismatch, contract price if one exists (else "would source at WAC"), and a DEA Schedule II warning line if the alternative is controlled.
- **Foundry-generated (when `FOUNDRY_ENDPOINT`/`FOUNDRY_API_KEY` are set):** the same structured facts are sent to the Foundry-hosted Claude deployment, the response is checked against the Content Safety groundedness gate, and only used if it passes — otherwise it silently falls back to the template. `foundryUsed`/`traceId` on each option record which path actually produced it, and (per the earlier Foundry work) the accept/reject audit entry cites the trace when Foundry was actually used.

### 5.3 Confidence score

Not a per-option model self-report — a fixed constant computed once per shortage: **0.86 if any offered alternative has a TE-code match, else 0.52**. Same number shown regardless of which alternative you'd actually pick.

### 5.4 The Schedule II block

`blocked: alt.isControlled && alt.deaSchedule === 2` — computed once when the substitution list is built, not re-checked at accept-time in the UI (though it **is** re-enforced server-side at decision time, see §6). This is why a Schedule II option never shows an "Accept" button at all in `SubstitutionRow`.

---

## 6. Accept / Reject — what actually happens

`POST /api/substitutions/:id/decision` in `shortages.js`:

1. **Schedule II hard-block, re-checked server-side:** even though the UI hides the Accept button for a blocked option, the route independently re-verifies `chosen.blocked` and returns a 422 if someone tries to accept one anyway — never trusts the client.
2. **Audit entry written** for the decision itself, citing: the alternative's rationale text, whether the TE code matched, whether Foundry generated it (with trace ID) or fell back to template, and the shortage's own source/bulletin/reason.
3. **On accept only:** a new `buyer_override` is auto-created (`type: 'preferred_substitute'`) and **its own separate audit entry** is written, cross-referencing the substitution decision. This is the mechanism that makes an accepted substitution show up on the Rules page afterward.
4. **On reject:** no override is created — the substitution's `decision` becomes `'rejected'` and nothing else changes.

---

## 7. Known simplifications vs. the production spec

| This prototype | Production spec |
|---|---|
| Substitutions pre-computed for the first 3 stores only, at boot/poll time | Computed per-store at query time or via the real nightly agent run (`lld.md` §4.3) |
| Confidence is a fixed 0.86/0.52 constant | A genuine per-call model self-report or calibrated score |
| Live shortage matching limited by this demo's fictional NDCs | A real pilot chain's actual formulary, where live matches would be meaningful |
| Bulletin excerpt is a raw string search over one text file | `lld.md` §4 calls for Azure AI Search-backed retrieval over `shortage-kb`, re-indexed every 4-hour poll |
| ASHP source in synthetic data only — no real ASHP integration | ASHP has a real, documented API, but production access is licensed (contact ASHP), not wired up — see `GAPS.md` |

Full severity-tiered gap list: `GAPS.md`.
