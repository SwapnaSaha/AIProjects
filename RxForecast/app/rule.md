# Rules (Buyer Overrides) — Computation Reference

**Scope:** this documents exactly how every field and interaction on the Rules page (`Overrides.tsx`, FEATURE_2 in `engg.md`) is computed **in the current prototype**, grounded directly in the code — not the production spec. Same convention as `GAPS.md`, `reorder.md`, `dashboard.md`, and `shortages.md`.

Source files referenced throughout:
- [`backend/src/routes/overrides.js`](./backend/src/routes/overrides.js) — list, create, toggle
- [`backend/src/routes/audit.js`](./backend/src/routes/audit.js) — the history feed each rule's detail drawer reads
- [`backend/src/routes/shortages.js`](./backend/src/routes/shortages.js) — the one place a rule is auto-created from elsewhere
- [`frontend/src/pages/Overrides.tsx`](./frontend/src/pages/Overrides.tsx) — list, create form, detail drawer

**Read §5 before anything else if you're relying on this page to mean what its own copy says.**

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

Three inputs, all required except none are optional besides store scope (defaults to all stores — there's no store picker in the create form at all, so every rule created through this UI is chain-wide by construction, never store-specific, despite the data model supporting a `storeId`):

- **Drug** — a plain `<select>` populated from `GET /api/formulary`, the same formulary list used everywhere else
- **Type** — one of 5 fixed values: `never_substitute`, `preferred_distributor`, `custom_par_level`, `never_generic`, `always_secondary_source`
- **Rationale** — free text, required — the route rejects creation with a 400 if empty (`overrides.js`), since this text *is* the rule's explainability source

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

---

## 5. The most important thing to know about this page

**The rule list is not actually consulted by anything else in the system.** Checked directly in the code: `state.overridesActive` is read by exactly one route (`overrides.js`, to list/create/toggle rules) and written to by exactly two places (`overrides.js`'s create endpoint, and `shortages.js`'s auto-create-on-accept path). It is **never read** by:

- `priority.js` (urgency/priority scoring — see `reorder.md` §4.1)
- `orderQty.js` (recommended-quantity calculation — see `reorder.md` §4.2)
- `substitution.js` (which alternatives get offered, or their rationale — see `shortages.md` §5)

So a `never_substitute` rule does not currently stop the Substitution Reasoner from offering a substitute; a `preferred_distributor` rule does not currently change which distributor a PO is sourced from; a `custom_par_level` rule does not currently change the recommended order quantity. **The page's own subtitle — "Persistent buyer preferences the agent applies to future recommendations automatically" — describes the intended production behavior (`engg.md` FEATURE_2), not what this prototype build actually does yet.**

What *is* real: the rule is genuinely created, stored, displayed, toggleable, and fully audited — the data model and CRUD surface are solid. What's missing is the other half of FEATURE_2: wiring `priority.js`/`orderQty.js`/`substitution.js` to actually *read* `state.overridesActive` and let it change their output. Not previously called out explicitly in `GAPS.md` — worth adding there if this prototype continues to be extended, since it's a real gap between the UI's stated purpose and its actual effect, not just a scale/data-source simplification like the others documented in this file series.

---

## 6. Known simplifications vs. the production spec

| This prototype | Production spec |
|---|---|
| Rules never actually consulted by scoring/sourcing/reasoning logic (§5) | `engg.md` FEATURE_2 — rules are meant to actively shape every future recommendation for that NDC |
| No store picker in the create form — every manually-created rule is all-stores | Full store-scoping support exists in the data model and is exercised only by the shortage-auto-create path |
| Conflicting active rules can coexist silently (warning only, not blocked) | Undefined in the current spec — worth resolving before this reaches a real chain |
| Rule ID is a timestamp, not a sequence counter | Cosmetic only, no functional impact |

Full severity-tiered gap list: `GAPS.md`.
