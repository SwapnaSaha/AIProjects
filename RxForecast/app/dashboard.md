# Director Dashboard — Computation Reference

**Scope:** this documents exactly how every tile and panel on the Director Dashboard is computed **in the current prototype**, grounded directly in the code — not the production spec. Where the prototype's approach differs from what `engg.md` FEATURE_8 actually calls for production, that's flagged explicitly in §5, same convention as `GAPS.md` and `reorder.md`.

Source files referenced throughout:
- [`backend/src/routes/dashboard.js`](./backend/src/routes/dashboard.js) — the single endpoint that computes everything below
- [`backend/src/lib/priority.js`](./backend/src/lib/priority.js) — urgency scoring, reused from the Reorder Queue (see `reorder.md` §4.1)
- [`backend/src/routes/pos.js`](./backend/src/routes/pos.js) — where `unitPrice` on a PO line comes from
- [`frontend/src/pages/Dashboard.tsx`](./frontend/src/pages/Dashboard.tsx) — rendering + polling

---

## 1. How this page works, overall

Everything on this page comes from **one endpoint**, `GET /api/dashboard/summary`, polled by the frontend every **4 seconds** (`refetchInterval: 4000` in `Dashboard.tsx`). There is no stored/cached metric anywhere — every number is **recomputed fresh on every request** from whatever's currently in the server's in-memory state.

**No history, by design and clearly labeled:** the response includes `isSnapshotOnly: true`, and the page itself says so ("Snapshot only — no week-over-week trend in this prototype"). There's no database in this build, so there's no pre-agent baseline to trend against — see §5.

**Access: director role only** (corrected 2026-08-17 — `App.tsx`'s nav previously also showed this to the buyer role, an inconsistency with `engg.md` FEATURE_8's own spec, which always scoped this page to the Director of Supply Chain). A buyer has no nav entry to `/dashboard` at all now, not merely a different default landing page.

---

## 2. The four KPI tiles

### High-urgency SKUs

```
for every (store, NDC) in the demo formulary:
    forecast = getForecast(store, ndc)
    if forecast.insufficientData: skip entirely (not counted either way)
    priority = computePriorityScore(forecast, inventory, velocityTier)
    totalTracked++
    if priority.band === "high": highUrgency++

highUrgencyPct = round(highUrgency / totalTracked × 100, 1 decimal)
```

This is the **exact same** `computePriorityScore()` used by the Reorder Queue (`reorder.md` §4.1) — same stockout-risk × velocity-tier formula, same band thresholds. The dashboard just runs it across every store+NDC combination and counts, rather than listing rows.

### Active shortages

A direct count of `ctx.shortages` where `status === 'Current'` — the identical shortage list the Shortages page reads. This number moves with whatever's currently active there (and reflects the live openFDA feed if `SHORTAGE_FEED_ENABLED` is on).

### Orders placed (session)

`state.purchaseOrders.length` — every PO created since the backend process last started. Resets to 0 on a backend restart, since orders live in an in-memory array, not a database.

### Illustrative savings

Explicitly labeled a **demo estimate, not the real methodology**. For every PO with status `shipped` or `acked`:

```
savings = Σ (quantityFinal × unitPrice × 0.15)
```

- `quantityFinal` is the actual approved order quantity (agent-recommended or buyer-edited)
- `unitPrice` is real — from `pos.js`: the negotiated contract price if one exists for that NDC+distributor, otherwise the formulary's WAC (wholesale acquisition cost) price
- **The `0.15` is a flat placeholder multiplier**, not a computed baseline-vs-current delta. It's not derived from anything the system actually knows about what the buyer *would have* ordered without RxForecast.

Only the qty and unit price are grounded facts; the "15% savings" framing itself is illustrative — worth saying plainly if this number is ever shown to anyone outside an internal demo.

---

## 3. The two panels

### Orders by status

Groups `state.purchaseOrders` by their `status` field and counts each bucket (`approved`, `transmitted`, `acked`, `shipped`, `rejected`, etc.) — a plain tally, no scoring or estimation involved.

### Substitution decisions

Reads `state.substitutions` — the same list the Shortages page acts on:

```
pending  = count where decision === "pending"
accepted = count where decision === "accepted"
decided  = count where decision !== "pending"   (accepted + rejected)
acceptRate = decided > 0 ? round(accepted / decided × 100, 1 decimal) : null
```

`acceptRate` renders as `—` rather than a misleading `0%` when nothing's been decided yet.

---

## 4. Sources, summarized

Nothing on this page reads a new data file — it's entirely derived from state the other pages already produce:

| Data | Same source as |
|---|---|
| `ctx.demoNdcList`, `ctx.formularyByNdc`, `ctx.inventoryByKey`, `ctx.forecastIndex` | Reorder Queue (`reorder.md`) |
| `ctx.shortages` | Shortages page |
| `state.purchaseOrders` | Every approve/bulk-approve action taken this session |
| `state.substitutions` | Every accept/reject decision on the Shortages page |

There is no dashboard-specific data source — it's a live aggregation layer over everything else in memory.

---

## 5. Known simplifications vs. the production spec

| This prototype | Production spec |
|---|---|
| Recomputed on every request (4s poll), no stored metric | A `weekly_chain_metrics` table with pre-agent baseline captured at pilot start, so trend deltas are meaningful (`engg.md` FEATURE_8) |
| Snapshot only, `isSnapshotOnly: true` | Week-over-week / trailing trend charts |
| Illustrative savings = flat 15% of shipped order value | Real baseline-vs-current methodology comparing actual buyer behavior pre/post RxForecast |
| Resets to zero on backend restart (in-memory) | Persisted history in Postgres, survives restarts and deploys |
| This "Director Dashboard" is the customer-facing single-chain view | Distinct from FEATURE_9's cross-chain internal Admin Metrics Dashboard — not built in this prototype pass, see `GAPS.md` |

Full severity-tiered gap list: `GAPS.md`.
