# Rules (Buyer Overrides) — Computation Reference

**Scope:** this documents exactly how every field and interaction on the Rules page (`Overrides.tsx`, FEATURE_2 in `engg.md`) is computed **in the current prototype**, grounded directly in the code — not the production spec. Same convention as `GAPS.md`, `reorder.md`, `dashboard.md`, and `shortages.md`.

Source files referenced throughout:
- [`backend/src/routes/overrides.js`](./backend/src/routes/overrides.js) — list, create, toggle, and (since 2026-08-19) triggering a live substitution-recompute when a rule affects it
- [`backend/src/lib/overrideRules.js`](./backend/src/lib/overrideRules.js) — the shared lookup `priority.js`/`orderQty.js`/`substitution.js` all use to find an applicable rule
- [`backend/src/lib/orderQty.js`](./backend/src/lib/orderQty.js) — where `custom_par_level` is actually consulted
- [`backend/src/lib/substitution.js`](./backend/src/lib/substitution.js) — where `never_substitute`/`never_generic` are actually consulted
- [`backend/src/routes/audit.js`](./backend/src/routes/audit.js) — the history feed each rule's detail drawer reads
- [`backend/src/routes/shortages.js`](./backend/src/routes/shortages.js) — the one place a rule is auto-created from elsewhere
- [`frontend/src/pages/Overrides.tsx`](./frontend/src/pages/Overrides.tsx) — list, create form, detail drawer

**§5 is the section to read if you want to know which of the 5 rule types actually change agent behavior — 3 do, 2 don't yet.**

---

## 1. The rule list

`GET /api/overrides` returns `state.overridesActive`, sorted by `createdDate` descending (newest first) — no filtering, no pagination, no per-store or per-role scoping on the list itself (a PIC or any other role sees every rule chain-wide, same as a buyer).

| List row field | Computation |
|---|---|
| `genericName (ndc)` / rule type | Direct fields, formatted (`type.replace(/_/g, ' ')` turns `never_substitute` into "never substitute") |
| Scope line | `o.storeId ? "Store {storeId}" : "All stores"` + the rationale text, concatenated for the row's subtitle |
| `active`/`inactive` badge | Direct boolean field |
| Deactivate/Reactivate button | Toggles `active` via `PATCH /api/overrides/:id` — no confirmation step, immediate |

---

## 2. Creating a rule — the form

Four inputs (a numeric field is conditional):

- **Drug** — a plain `<select>` populated from `GET /api/formulary`, the same formulary list used everywhere else
- **Type** — one of 5 fixed values: `never_substitute`, `preferred_distributor`, `custom_par_level`, `never_generic`, `always_secondary_source`. Selecting a type shows a one-line note (`WIRING_NOTE` in `Overrides.tsx`) saying whether this type actually changes agent behavior yet — see §5
- **Target days of supply** — only shown when type is `custom_par_level`, required and must be a positive number for that type (`overrides.js` returns a 400 otherwise). This is the value `orderQty.js` reads — a rule created without it (or seeded synthetic `custom_par_level` rows from before this field existed) has no numeric value to apply and simply has no effect
- **Rationale** — free text, required — the route rejects creation with a 400 if empty, since this text *is* the rule's explainability source

Store scope defaults to all stores — there's no store picker in the create form at all, so every rule created through this UI is chain-wide by construction, never store-specific, despite the data model supporting a `storeId` (the shortage-auto-create path does use store-specific scope, see §4).

### Conflict detection

On create, the backend checks for an existing **active** rule on the same NDC with overlapping scope (`o.storeId === storeId || o.storeId === null`) — i.e., a store-specific rule conflicts with an all-stores rule on the same drug, and vice versa. If found, the new rule is still created (not blocked), but the response carries a `conflictWarning` string that the form surfaces as a non-blocking warning banner. Nothing prevents two contradictory active rules coexisting.

### Rule ID

Generated as `OVRLIVE${Date.now()}` — a timestamp-based ID, not a sequence counter (unlike `PO######`/`AUD######` elsewhere in the app) — a minor inconsistency, not a bug, since IDs only need to be unique here.

---

## 3. The detail drawer

Opening a rule fetches `GET /api/audit?entity_type=buyer_override&entity_id={id}` — the exact same audit log every other page reads, just pre-filtered to this one rule's entries.

| Field | Source |
|---|---|
| "What this rule does" explainer | A **hardcoded, client-side-only** lookup table (`TYPE_EXPLAINER` in `Overrides.tsx`) keyed by rule type — not server data, and not shown anywhere in the API response itself |
| Drug / Scope / Created by / Created / Rule ID | Direct fields from the override record |
| Target days of supply *(custom_par_level only)* | The rule's `parLevelDays` value, or a warning that it's unset and has no effect if absent |
| Rationale | The free-text rationale entered at creation — displayed verbatim |
| History | Every audit entry for this rule's `entityId`, newest-first (server already reverses the log), each showing action, timestamp, actor role/ID, and numbered citations from that entry's `sources[]` |

Toggling active/inactive from inside the drawer calls the same `PATCH` endpoint as the list-row button, then invalidates both the rule-list query and this drawer's own audit-history query — which is why the history list visibly grows with a new "activated"/"deactivated" entry immediately after toggling, in the same interaction, without closing the drawer.

---

## 4. How a rule gets audited

Every mutation writes a `buyer_override`-typed audit entry:

| Action | `sources[]` citation content |
|---|---|
| `created` (manual, via the form) | The manually-entered rationale, quoted verbatim, plus the scope (store-specific or all-stores) and rule type |
| `created` (**auto**, from an accepted shortage substitution — see `shortages.md` §6) | A cross-reference to the substitution decision it came from, not a manually-typed rationale |
| `deactivated` / `reactivated` | Which direction the toggle went, plus the rule's original rationale re-quoted for context |

The two `created` paths are otherwise identical in shape — same table, same fields, same audit pattern — the only difference is who/what supplied the rationale text.

A `never_substitute` or `never_generic` rule being applied to an actual accept/reject decision is *also* cited in that decision's own audit entry (`shortages.js`) — `"Options restricted by active buyer override rule {id} ({type}): "{rationale}""` — so the audit trail shows not just that a rule exists, but that it actually changed what a buyer saw.

---

## 5. Which rule types actually change agent behavior (wired 2026-08-19)

This used to be the section explaining that **none** of the 5 rule types were consulted by anything — verified by grep across the backend, `state.overridesActive` had exactly one reader (its own route). That's now true for only 2 of the 5 types.

### Wired and verified live

| Type | Where it's consulted | Effect |
|---|---|---|
| `never_substitute` | `substitution.js`, via `findActiveOverride(ndc, storeId, 'never_substitute')` | The Substitution Reasoner offers **zero** alternatives for that drug at that store — the shortage still shows, but with nothing to accept. Cited in the substitution record as `ruleApplied` |
| `never_generic` | `substitution.js`, filters `findAlternatives()` to `isBrand` products only | Only brand-name alternatives are offered; the rationale text says so explicitly, and `ruleApplied` is set on the record |
| `custom_par_level` | `orderQty.js`'s `resolveTargetDays()`, used by both the Reorder Queue and PO creation | The rule's `parLevelDays` replaces the inventory record's default target days-of-supply when computing recommended order quantity — a lower par level genuinely produces a lower recommended quantity, verified: dropping a drug's target from the 21-day default to 10 dropped its recommended qty from 50 to 22 units in the same session |

**Store-specific beats all-stores** when both exist for the same NDC+type (`overrideRules.js`'s `findActiveOverride` — the more specific rule wins, not "last created" or "first found").

**Takes effect immediately, not just after a restart.** This mattered more than it might sound: `state.substitutions` (unlike the Reorder Queue, which computes fresh on every request) is only built once at boot or on a live-feed poll — a rule created mid-session would otherwise have nothing to act on until the next restart. `overrides.js` now calls `refreshPendingSubstitutionsForNdc()` after any create/toggle of a `never_substitute`/`never_generic` rule, which recomputes just the still-*pending* substitution records for that NDC in place — already-decided (accepted/rejected) records are left untouched, since a new rule shouldn't retroactively rewrite what already happened. `custom_par_level` didn't need this treatment — `orderQty.js` was already being called fresh per request.

### Not yet wired

| Type | Why not (yet) |
|---|---|
| `preferred_distributor` | Would need to change which distributor `pos.js` sources a PO from — a different subsystem (PO sourcing, not scoring/substitution) |
| `always_secondary_source` | Same subsystem, plus the synthetic data's `contract_type` values (340B/Direct/GPO/Prime Vendor) don't map cleanly onto a "primary vs. secondary" concept yet — needs a small data-model decision before it can be wired meaningfully |

The create form's per-type wiring note (§2) surfaces this distinction to whoever's creating a rule, rather than leaving it a silent gap.

---

## 6. Known simplifications vs. the production spec

| This prototype | Production spec |
|---|---|
| `preferred_distributor`/`always_secondary_source` still don't affect PO sourcing (§5) | `engg.md` FEATURE_2 — all 5 rule types actively shape every future recommendation/PO for their NDC |
| No store picker in the create form — every manually-created rule is all-stores | Full store-scoping support exists in the data model and is exercised by both the shortage-auto-create path and the wired rule types |
| Conflicting active rules can coexist silently (warning only, not blocked) | Undefined in the current spec — worth resolving before this reaches a real chain |
| `custom_par_level` rules created before `parLevelDays` existed (the seeded synthetic set) have no effect | Would need a migration/edit path in a real system — this prototype has no rule-edit UI at all, only create/toggle |
| Rule ID is a timestamp, not a sequence counter | Cosmetic only, no functional impact |

Full severity-tiered gap list: `GAPS.md`.
