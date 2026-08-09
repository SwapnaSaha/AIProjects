# RxForecast — Engineering Design (Implementation Specification Blueprint)

One section per MVP feature (from `PRD.md` §4, MVP Features), each broken into the standard three panes:

- **01. Product & UX** — Description · User Flow · Placement · Design
- **02. Data & Backend** — Database Schema · Database Tasks · Helper Functions · API Routes
- **03. Frontend & QA** — State Management · Components · Edge Cases · Testing Checklist

> **Assumptions flagged where the PRD doesn't specify.** The PRD names the tech stack at the platform level (LangGraph/LangChain for the agent, React + TypeScript + Tailwind for UI, Postgres + S3 for storage, Pinecone for RAG, AWS for hosting) but not an API framework, a state-management library, or an identity/auth provider. This doc assumes **FastAPI** (Python, pairs naturally with the LightGBM/Pandas/Pydantic/edi-x12 stack already chosen), **TanStack Query + Zustand/React Hook Form** on the frontend, and **WorkOS** for enterprise SSO (§0.1, rationale there). Swap freely — these are engineering conventions, not PRD requirements.

Scope: **FEATURE_0** (Authentication & Session Management, cross-cutting infrastructure every other feature depends on) plus the 8 features listed as "Required features (V1 MVP)" in the PRD, plus **FEATURE_9** (Admin Metrics Dashboard — added 2026-07-31, internal-only, see its own section for why it's architecturally separate from Features 0–8 rather than "just another role"). Backend work belonging to the 9-component agent pipeline (Demand Forecaster, Shortage Watcher, Substitution Reasoner, Sourcing Optimizer, Exception Handler) is referenced from each feature where it's the data producer, not re-specified — that pipeline is a separate service, not part of the buyer-facing app.

*This document has no cost figures by design — it's an implementation spec, not a budget. Infrastructure/operational costs (including the 2026-07-31 Azure re-pricing) live in `PRD.md` Appendix B; the full AWS→Azure service mapping behind those numbers is in `lld.md` §7.6.*

---

## Design System

UI work in this doc follows **[`design-system.md`](./design-system.md)** — the RxForecast Design System, adapted from the Anthropic/Claude Design System (source: `C:\Swapna\GitHub\Projects\week-5-claudeapp\.claude\knowledge\design-system.md`) specifically for this app. Token prefix `an-`, Tailwind-mapped, dark mode as the primary product experience.

The adaptation is already done in that file — it's no longer a chat-app system requiring translation. Highlights relevant to the features below:

- **`an-critical`** (new token) — reserved exclusively for compliance hard-blocks (Schedule II auto-sub, DSCSA/340B violations). Used in Features 2 and 4 below. Never use plain `an-error` for these — the design system treats them as categorically different severities.
- **Data Table** (new component) — the Reorder Queue (Feature 1), Rules list (Feature 6), Audit Trail (Feature 7), and Store Breakout table (Feature 8) all use this one spec.
- **Detail Drawer** (new component, replaces the source's fixed chat panel) — used by Features 1, 3, and 4; overlays from the right at 480px, doesn't compress the main column.
- **KPI Stat Tile** and **Status Stepper** (new components) — used by Feature 8 and Feature 5 respectively.
- **Semantic Color Usage table** in the design system is the canonical state→token mapping; feature Design notes below cite it rather than repeating the mapping.

---

## 0. Shared Data Model

Every feature below reads or writes a subset of this schema. Defined once here so features 1–8 don't repeat column lists — each feature's "Database Schema" section names only the tables it touches plus anything feature-specific.

```sql
-- Reference / master data
stores               (store_id PK, store_name, city, state, dc_assignment, store_format, open_date, sqft_tier, pharmacist_in_charge)
distributors         (distributor_id PK, name, role, avg_lead_time_days)
formulary            (ndc PK, generic_name, brand_name, therapeutic_category, dosage_form, strength, pack_size,
                       dea_schedule, orange_book_te_code, manufacturer, velocity_tier, is_glp1, is_insulin,
                       is_controlled_substance, is_340b_eligible, wac_price_per_pack, unit_cost_per_pack, deleted_at)
distributor_contracts(contract_id PK, ndc FK, distributor_id FK, contract_type, contract_price_per_pack,
                       effective_date, expiration_date, gpo_name)

-- Identity & access (owned by FEATURE_0)
chains               (chain_id PK, name, sso_domain, idp_type ENUM[saml, oidc, none], concurrent_session_limit)
users                (user_id PK, chain_id FK, name, email, role ENUM[buyer, director, pic, compliance, pharmacist],
                       store_id FK NULL, auth_provider ENUM[sso, password], external_idp_subject NULL,
                       mfa_enabled, last_login_at, deactivated_at)
auth_sessions        (session_id PK, user_id FK, issued_at, expires_at, revoked_at NULL, ip_address, user_agent)
idp_role_mappings    (id PK, chain_id FK, idp_group_name, mapped_role, mapped_store_id FK NULL)  -- SSO group → RxForecast role/store

-- Demand & inventory (high-volume, partitioned by date)
dispense_events      (id PK, date, store_id FK, ndc FK, quantity_dispensed, days_supply, payer_type, rx_fill_count)
inventory_snapshots  (id PK, date, store_id FK, ndc FK, on_hand_qty, in_transit_qty, days_of_supply,
                       reorder_point_days, target_days_of_supply)
forecast_results     (id PK, run_date, store_id FK, ndc FK, forecast_qty_7d, confidence_low, confidence_high,
                       mape_rolling_14d, model_version)
stockout_events      (id PK, date, store_id FK, ndc FK, units_short, hours_out_of_stock, lost_rx_estimate, shortage_linked)

-- Shortages & substitution
shortage_events      (shortage_id PK, ndc FK, source, status, date_reported, date_resolved, reason, severity,
                       bulletin_id, bulletin_text)
substitution_events  (substitution_id PK, shortage_id FK, store_id FK, original_ndc FK, proposed_alt_ndc FK,
                       orange_book_te_match, buyer_decision, pharmacist_rated_appropriate, rationale_text, created_at)

-- Ordering (EDI lifecycle)
purchase_orders      (po_id PK, store_id FK, distributor_id FK,
                       status ENUM[draft, pending_approval, approved, transmitted, acked, shipped, backordered, rejected, cancelled],
                       created_by_agent_run_id, approved_by_user_id, approved_at, edi_raw_s3_key, version)
purchase_order_lines (id PK, po_id FK, ndc FK, quantity_ordered_agent, quantity_ordered_final, unit_price, contract_id FK NULL)
po_acknowledgements  (ack_id PK, po_id FK, ack_date, line_status, quantity_confirmed, promised_ship_date, edi_raw_s3_key)
asn_shipments        (asn_id PK, po_id FK, shipment_date, delivery_date, carrier, ndc FK, quantity_shipped, edi_raw_s3_key)

-- Buyer behavior & governance
buyer_overrides      (override_id PK, buyer_id FK, store_id FK NULL, ndc FK, override_type, rationale, created_date, active)
audit_log            (id PK, entity_type, entity_id, action, actor_user_id NULL, actor_agent_component NULL,
                       payload_json, sources_json, created_at)  -- append-only, 7-yr retention, no UPDATE/DELETE grants

-- Internal admin identity (owned by FEATURE_9 — deliberately NOT part of the chains/users model above; see FEATURE_9 §0)
admin_users              (admin_user_id PK, name, email, mfa_enabled BOOLEAN NOT NULL DEFAULT true, last_login_at, deactivated_at)
metric_snapshots         (id PK, chain_id FK NULL, snapshot_date, metric_category, metric_name, metric_value, metadata_json)
admin_dashboard_access_log (id PK, admin_user_id FK, action, chain_id FK NULL, created_at)  -- reads are logged here, not audit_log
```

**Conventions used throughout:** soft-delete only (`deleted_at`, never hard-delete — audit trail must stay resolvable); every write to `purchase_orders`, `substitution_events`, or `buyer_overrides` writes a paired `audit_log` row in the same transaction; role-based access enforced at both API and DB-role level, not UI-only — the concrete mechanism for that last point is FEATURE_0, below. `admin_users`/`admin_dashboard_access_log` are intentionally **not** joined to `chains`/`users` by foreign key on the identity side — an admin account must never be reachable through the same identity path a chain's SSO federation provisions (rationale in FEATURE_9).

---

## FEATURE_0 / Authentication & Session Management

*Foundational — every other feature assumes this exists. Placed first because nothing in Features 1–8 renders, and no API route responds, without it.*

**§0.1 — Provider choice (assumption, not PRD-specified):** RxForecast sells to ~250 independent pharmacy chains, each with its own existing corporate identity provider (Okta, Azure AD, Google Workspace, etc.) — the realistic enterprise expectation is that a chain's IT team federates their own IdP, not that RxForecast becomes a second password to manage. Standing up raw SAML config per customer against AWS Cognito is high-maintenance at that scale, so this doc assumes **WorkOS** (SSO-as-a-service, one integration handles arbitrary customer IdPs) sitting in front of a thin RxForecast-issued JWT session — not Cognito directly, and not a home-grown SAML stack. A simple email+password+MFA fallback exists for design-partner pilots signed before a chain's SSO integration is live (matches the PRD's phased pilot → beta → launch rollout, where the first pilot chain may not have IT bandwidth to stand up SSO on day one).

**01. Product & UX**

- **Description:** Establishes who's using RxForecast and what they're allowed to see before any of Features 1–8 render. Enterprise SSO is the primary path; email+password+MFA is a pilot-only fallback.
- **User Flow:** SSO path — user visits the app → redirected to a chain-specific login → redirected to the chain's IdP → IdP authenticates and returns a SAML/OIDC assertion → RxForecast provisions/updates the user's `role` and `store_id` from the chain's `idp_role_mappings` → session established → redirected to the role-appropriate landing page (Queue for buyer, Dashboard for director). Fallback path — email+password → TOTP MFA challenge → session established. On session expiry, the next action redirects to a "session expired, sign in again" screen that preserves the original deep link.
- **Placement:** `/login/{chain_slug}` for SSO routing; any unauthenticated request to another route redirects here with a `?redirect=` param.
- **Design:** Light-mode auth surface per the design system's Brand Aesthetic (light mode is reserved for auth); `text-hero` (Lora) headline; chain logo shown once the SSO org resolves; standard Input Fields for the fallback path.

**02. Data & Backend**

- **Database Schema:** Owns `chains`, `users` (auth columns), `auth_sessions`, `idp_role_mappings` — see §0 Shared Data Model above.
- **Database Tasks:** On every successful login (SSO or password), upsert the user's `role`/`store_id` from IdP claims via `idp_role_mappings`; write an `audit_log` entry for every login, logout, and failed-login attempt (this is the piece that was missing from Feature 7's Audit Trail — that feature assumed these events exist, this feature is what actually writes them); a nightly job expires `auth_sessions` past their timeout and marks them `revoked_at`.
- **Helper Functions:** `mapIdpGroupsToRole(claims, chain_id)`; `issueSessionTokens(user)` (short-lived access JWT + longer-lived refresh token); `verifyAccessToken(token)`; `enforceStoreScope(user, requested_store_id)` — the concrete implementation behind every "RBAC" and "role-gated" note in Features 1–8. **(updated 2026-08-01 — `enforceStoreScope` and a `requireStoreScope` request guard are now built in the demo prototype: a PIC session's `store_id` query param is force-overridden server-side on every Feature 1 route, and Feature 3's PO-creation routes return 403 on any cross-store attempt, verified by directly calling the API with a foreign `store_id`, not just hiding the store picker in the UI — see `app/backend/src/middleware/auth.js`.)**
- **API Routes:** `GET /api/auth/sso/{chain_slug}/start` · `GET /api/auth/sso/callback` · `POST /api/auth/login` (fallback) · `POST /api/auth/mfa/verify` · `POST /api/auth/refresh` · `POST /api/auth/logout` · `POST /api/auth/sessions/{id}/revoke` (compliance/director only — force-logout another user, e.g. on employee departure).

**03. Frontend & QA**

- **State Management:** Access token held in memory only (not localStorage — reduces XSS token-theft exposure); refresh token in an httpOnly Secure cookie; a fetch/query interceptor auto-refreshes once on a 401, then redirects to `/login` on repeat failure; current user/role/store_id in a small Zustand store read by every route guard.
- **Components:** `<LoginPage>` · `<SsoOrgPicker>` · `<MfaChallenge>` · `<SessionExpiredBanner>` · `<RouteGuard>` (wraps every Feature 1–8 route — checks role *before* render, not just hides a button).
- **Edge Cases:** an IdP group that maps to no known RxForecast role leaves the user deactivated pending admin mapping — never defaults to `buyer`; a PIC user with a null `store_id` is an invalid record and blocks login with an admin-facing error rather than silently granting broad access; concurrent-session-limit exceeded (per `chains.concurrent_session_limit`) force-revokes the oldest session with a notification; lost MFA device requires an admin-driven reset — no self-service bypass, since a bypass path is itself a compliance hole; the backend agent pipeline and the EDI/VAN transmission job authenticate to the API via a separate scoped service API key/JWT, never a human session.
- **Testing Checklist:** SSO round-trip against a test IdP (assertion → correct role/store_id mapping via fixtures); session timeout actually rejects the next API call server-side, not just hides UI; `RouteGuard` blocks a buyer from `/audit` at the component level *and* the API independently returns 403 (defense in depth — same pattern Feature 7 already tests); revoking a session immediately invalidates its tokens (revoke, then replay a request with the old access token, expect 401); login/logout/failed-login events land in `audit_log`; concurrent-session-limit enforcement; MFA required and enforced for compliance/director/pharmacist roles at minimum.

**Session & compliance policy** (referenced, not repeated, by the rest of this doc):

| Policy | Value | Why |
|---|---|---|
| Inactivity timeout | 15 minutes | Standard HIPAA-adjacent guidance for PHI-proximate tooling |
| Absolute session max | 12 hours | Forces re-auth even during continuous activity |
| MFA required | Compliance, Director, Pharmacist roles | Highest-consequence roles (audit access, substitution sign-off) |
| MFA recommended, not enforced | Buyer, PIC | Balances friction against a 250-chain rollout where IT maturity varies |
| Auth event logging | Every login/logout/failed-login/session-revoke → `audit_log` | 7-yr retention, same table Feature 7 reads |

---

## FEATURE_1 / Daily Prioritized Reorder Queue

**01. Product & UX**

- **Description:** The buyer's home screen — a daily ranked list of SKU-store pairs needing a reorder decision, computed nightly by stockout risk × velocity × margin.
- **User Flow:** Buyer logs in → lands on Queue → sees ranked list grouped by urgency → each row's qty field is pre-filled with the agent's recommended order quantity → clicks a row → detail drawer opens (forecast, inventory, why) → approves / modifies / defers → row clears from queue. **Bulk path (added 2026-08-01, revised same day to decouple editing from selection):** buyer edits the pre-filled qty field on any number of rows independent of selection, clicks **Save** on each edited row to commit it (unsaved edits are not sent anywhere), then checks the rows to include and clicks the floating "Approve N selected" bar → each selected row runs through the same single-item approval logic (Schedule II block, store scope, 2-sigma sanity check), using its saved override if one exists or the agent's live recommendation otherwise → a per-row result summary shows which approved and which need attention, without blocking the rows that succeeded.
- **Placement:** Primary landing page after login (`/queue`); persistent left-nav "Reorder Queue" item with unread-count badge.
- **Design:** Design system's **Data Table** component — priority stripe per Semantic Color Usage (`an-error`/`an-warning`/`an-success`), sticky header on `an-bg-subtle`, filterable by store/category/distributor. Row click opens the **Detail Drawer** component (480px overlay) — not full-page nav, keeps the buyer in flow. The qty field renders muted/greyed (`an-fg-subtle`) whenever it still shows the agent's untouched recommendation, and switches to normal text once a value is typed or saved — so "this is a suggestion" vs. "this has been decided" is visually distinct at a glance, same principle as the design system's editable-vs-decided state pattern. A saved override shows a small ✓. Bulk mode adds a checkbox column (disabled with a tooltip on Schedule II rows — those can never be bulk-approved) and a floating bottom action bar. A PIC session shows a read-only "Store-locked: {store_id}" indicator in place of the store filter dropdown, matching FEATURE_0's server-side scoping — the UI never offers a control the API would reject anyway.

**02. Data & Backend**

- **Database Schema:** Reads `forecast_results` + `inventory_snapshots` + `formulary`; a materialized view `v_reorder_queue` joins these plus a computed `priority_score`, refreshed nightly.
- **Database Tasks:** Nightly refresh of `v_reorder_queue` runs after the Demand Forecaster + Inventory Reconciler agent jobs complete; a row clears when its PO is approved, or is snoozed and resurfaces next cycle if deferred. **(updated 2026-08-01)** "Resurfaces next cycle" is now concretely defined for the demo build as the affected user's *next login*, not a time-based cycle (there's no nightly job in the prototype) — see the Defer note below. A Reject, by contrast, is a permanent decision and never resurfaces on its own.
- **Helper Functions:** `computePriorityScore(forecast, inventory, margin)`; `groupByUrgencyBand(rows)`; `formatDaysOfSupply(qty, avgDemand)`; `recommendedQtyFromForecast(forecast, inventory)` (added 2026-08-01 — the same formula FEATURE_3/FEATURE_4's PO creation uses to compute the default order quantity, shared via one function so the queue's pre-fill and the actual PO default can never drift apart).
- **API Routes:** `GET /api/queue?store_id&category&distributor` (paginated/sorted, each row now includes `recommendedQty`) · `POST /api/queue/{id}/defer` · `GET /api/queue/{id}/detail` · `POST /api/pos/bulk` (added 2026-08-01 — accepts `{items: [{storeId, ndc, distributorId, quantity?}]}`, capped at 200 items/request, returns HTTP 207 with a per-item `{ok, po}` or `{ok:false, status, detail}` result so partial success is representable, not all-or-nothing).
- **Defer semantics (updated 2026-08-01):** defers are scoped per user and cleared the next time that user logs in — implemented as a `userId → Set(key)` map cleared on `login()`, not a flat/global set. This replaces the prototype's earlier "resurfaces on server restart" stand-in with something a reviewer can actually exercise without touching the process. Reject is intentionally on a separate, permanent, non-user-scoped set (`rejectedQueueItems`) since it's a recorded decision, not a "come back later."

**03. Frontend & QA**

- **State Management:** Server state via TanStack Query (`useQueue`, key `['queue', filters]`, 5-min staleTime, invalidated on approve/defer); local UI state (selected row, drawer open, filters) via Zustand. Three local maps drive the bulk flow (added/revised 2026-08-01): `selected` (which row keys are checked), `qtyDraft` (in-progress, unsaved input text per row), `qtySaved` (committed overrides per row, only these are sent on bulk approve) — selection and quantity-editing are independent, matching the "edit many, then approve some" flow.
- **Components:** `<QueueTable>` · `<QueueRow>` · `<UrgencyBadge>` · `<QueueFilters>` · `<ReorderDetailDrawer>` · `<BulkActionBar>` (added 2026-08-01).
- **Edge Cases:** empty queue ("all caught up") state; SKU with <6mo history shows an "insufficient data" label and falls back to par level (per PRD Fairness mitigation) instead of a false-confidence rank; duplicate suppression when a PO is already pending for that NDC-store; stale-queue banner if the nightly job failed; bulk-selecting a row that later fails its 2-sigma sanity check surfaces in the result summary rather than silently dropping it; Schedule II rows are excluded from "select all" and cannot be individually checked; a row edited but never saved contributes nothing to a bulk-approve payload — it silently falls back to the agent's live recommendation at approval time, which may differ slightly from what was on screen if inventory moved in between (an intentional freshness choice, not a bug).
- **Testing Checklist:** unit-test the priority-score formula against fixtures; empty-state render; pagination at 200+ rows; defer removes row for the deferring user and resurfaces specifically on that user's next login, verified with two logins for the same demo persona in sequence; a second user/role's view is unaffected by another user's defer; reject removes a row permanently across logins; RBAC — non-buyer role cannot see the approve action (enforced by FEATURE_0's `<RouteGuard>` + server-side check); keyboard navigation / a11y on rows; qty field is pre-filled with `recommendedQty` and styled as muted until edited or saved; Save is disabled until the field's value differs from the last-saved (or default) value; bulk approve — Schedule II rows excluded from selection and from the bulk payload even if forced client-side; PIC bulk-approving cannot include another store's key (server rejects per-item with 403, doesn't fail the whole batch); mixed-outcome batch (some approved, some 422) renders both outcomes correctly; a saved override quantity, not the agent default, is what ends up on the generated X12 850's PO1 segment.

---

## FEATURE_2 / Shortage Alert Feed with Proposed Substitutes

**01. Product & UX**

- **Description:** Surfaces active FDA/ASHP shortages mapped to the chain's formulary, each with LLM-proposed substitute NDCs and accept/reject controls.
- **User Flow:** Buyer opens Shortages tab → sees active shortages affecting the formulary → expands one → sees proposed substitute(s) with Orange Book TE rationale → accepts (creates a `buyer_override`, flows into Queue) or rejects (logged).
- **Placement:** Secondary nav "Shortages" (`/shortages`) with a new/unacknowledged badge; cross-linked from Queue rows tagged `shortage_linked`.
- **Design:** Card list per the Cards/Panels spec, one card per `shortage_event`, expandable to its `substitution_events`; severity chip (Full/Partial) per Semantic Color Usage; source link-out to the FDA/ASHP bulletin styled as `an-accent` text; a Schedule II shortage's substitution option renders with the **`an-critical`** token, not `an-error` — it's a hard block, not a validation warning.

**02. Data & Backend**

- **Database Schema:** Reads `shortage_events`, `substitution_events`, `formulary`; writes `substitution_events.buyer_decision` on accept/reject.
- **Database Tasks:** Shortage Watcher agent inserts/updates `shortage_events` every 4hrs (FDA) / daily (ASHP); Substitution Reasoner inserts `substitution_events` rows per affected store when a shortage opens.
- **Helper Functions:** `mapShortageToFormulary(ndc)`; `formatBulletinExcerpt(text, maxLen)`; `teCodeMatchBadge(original, alt)`.
- **API Routes:** `GET /api/shortages?status=current` · `GET /api/shortages/{id}/substitutions` · `POST /api/substitutions/{id}/decision {accept|reject}`.

**03. Frontend & QA**

- **State Management:** TanStack Query `useShortages`, refetch interval matched to the 4h ingest cadence; decision mutation optimistically updates the card.
- **Components:** `<ShortageList>` · `<ShortageCard>` · `<SubstitutionOption>` · `<TeCodeBadge>` · `<SourceLink>`.
- **Edge Cases:** shortage with zero same-TE-code substitute — shows "no substitute available, escalate to pharmacist" using the **Critical** button variant for the escalation action; shortage resolves while buyer is viewing it — toast + refresh, don't leave a stale card actionable; Schedule II drug in shortage — substitution UI disabled with an `an-critical` explanation banner (hard safety rule, not a suggestion).
- **Testing Checklist:** card renders for both severities; TE-match badge correctness against fixture pairs; accept writes an override and the row appears in Feature 1's queue; Schedule II hard-block is enforced server-side, not just hidden client-side; expand/collapse accessibility.

---

## FEATURE_3 / Per-SKU Forecast View with Explainability Panel

**01. Product & UX**

- **Description:** Detail view for one SKU-store: the 7-day demand forecast with confidence band, plus a "Why" panel citing the forecast's inputs.
- **User Flow:** Opened from a Queue row ("View Forecast") or search → chart with actual vs. forecast vs. confidence band → expand Why panel → see trailing-demand window, seasonality flags, confidence score, data recency.
- **Placement:** Modal/drawer from Feature 1; also a standalone deep-link route `/forecast/{store_id}/{ndc}` so citations elsewhere can link directly to it.
- **Design:** Line chart on `an-bg-base` (actual/forecast/confidence band), compact stat tiles built as small Cards/Panels (MAPE, confidence %, data window), collapsible Why panel below the chart using `text-caption`/`text-mono` for cited values so raw data reads distinctly from prose.

**02. Data & Backend**

- **Database Schema:** Reads `forecast_results`, `dispense_events` (trailing 90 days for the chart), `formulary`. Read-only feature — no writes.
- **Database Tasks:** None beyond the nightly `forecast_results` refresh (owned by the Demand Forecaster agent job, shared with Feature 1).
- **Helper Functions:** `buildChartSeries(dispenseEvents, forecastResults)`; `confidenceBandToPercent()`; `explainabilityCitations(forecastResult)`.
- **API Routes:** `GET /api/forecast/{store_id}/{ndc}` (trailing actuals + forecast + confidence + citation metadata).

**03. Frontend & QA**

- **State Management:** TanStack Query keyed by `[store_id, ndc]`; pure read, no local mutation.
- **Components:** `<ForecastChart>` · `<ConfidenceBand>` · `<WhyPanel>` · `<CitationList>` · `<StatTile>`.
- **Edge Cases:** new SKU with <6mo history shows an explicit "insufficient data" state instead of a misleadingly confident line; gaps in dispense history (store closed) render as gaps, never interpolated to zero; forecast model version changed mid-week — Why panel surfaces `model_version` so the buyer can tell the logic shifted.
- **Testing Checklist:** chart renders correctly against fixtures with gaps; confidence-band numbers match backend values exactly (no client-side recompute drift); Why panel citation links resolve; cold-start SKU shows the correct fallback state; visual-regression snapshot on the chart.

---

## FEATURE_4 / One-Click Approve / Modify / Reject for PO Recommendations

**01. Product & UX**

- **Description:** The core action surface — approve a recommended PO as-is, edit line quantities/distributor then approve, or reject with a reason.
- **User Flow:** From the Queue detail drawer → buyer sees recommended PO lines → **Approve** (as-is) / **Modify** (inline qty/distributor edit, then approve) / **Reject** (reason required) → on approve, PO status moves to `approved` and queues for EDI 850 generation (Feature 5).
- **Placement:** Action row inside the Queue detail drawer (Feature 1) and Forecast view (Feature 3) — not a separate page.
- **Design:** 3-button action row per the Buttons spec — Approve is Primary, Modify is Ghost, Reject is Danger; Modify expands an inline editable line-item table using the standard Input Fields spec; Reject opens a reason-select + free-text field in a Cards/Panels modal. A Schedule II PO shows no Approve/Modify buttons at all — replaced by a single **Critical**-variant "Manual order required" notice, per the design system's Schedule II rule. **(updated 2026-08-01)** The quantity field is pre-filled with the agent-recommended quantity and rendered muted until edited, same visual convention as FEATURE_1's queue-row qty field — a buyer approving from this drawer sees the same number they'd see on the queue row it came from, not a blank field with a placeholder.

**02. Data & Backend**

- **Database Schema:** Writes `purchase_orders.status`, `purchase_order_lines` (agent-recommended vs. buyer-final quantity, kept as separate columns), and an `audit_log` entry per action.
- **Database Tasks:** On approve, trigger the EDI 850 generation job (Feature 5); on modify, log the diff between `quantity_ordered_agent` and `quantity_ordered_final` — this feeds the PO-accuracy metric and the >15%-modification-rate model-review trigger from the PRD.
- **Helper Functions:** `diffPOLines(original, edited)`; `validateQuantityBand(qty, historicalAvg)` (2-sigma sanity check per PRD); `requireRejectReason()`.
- **API Routes:** `POST /api/pos/{id}/approve` · `PATCH /api/pos/{id}/lines` · `POST /api/pos/{id}/reject {reason}`.

**03. Frontend & QA**

- **State Management:** Local form state (React Hook Form) for the edit table; TanStack Query mutation with optimistic update and rollback on server validation failure.
- **Components:** `<POActionBar>` · `<POLineEditor>` · `<RejectReasonModal>` · `<QuantitySanityWarning>`.
- **Edge Cases:** edited quantity falls outside the 2-sigma band — server returns 422 with the threshold explained; buyer must explicitly confirm the override (extra click, logged) rather than silently proceeding; Schedule II line item — modify/approve blocked entirely, redirects to manual-order guidance (no auto-PO for Sched II in MVP); concurrent edit by two buyers — optimistic-locking version check, second submitter gets a conflict toast, not a silent overwrite.
- **Testing Checklist:** approve-as-is happy path; modify persists the agent-vs-final diff correctly; reject requires a reason (client *and* server validation); 2-sigma override requires the explicit confirm step; Schedule II hard-block enforced server-side; concurrency-conflict test with two simulated sessions.

---

## FEATURE_5 / EDI 850 Generation & Transmission

**01. Product & UX**

- **Description:** Converts an approved PO into a valid X12 850 message and transmits it via the chain's existing VAN/clearinghouse.
- **User Flow:** Mostly invisible — triggered automatically on PO approval (Feature 4). Buyer sees a status chip progress (Approved → Transmitted → Acked → Shipped) on the PO detail; can view the raw EDI on demand for audit.
- **Placement:** Status chip inside the Feature 4 drawer + a dedicated `/pos/{id}` page for full transaction history; "Download EDI" link for compliance.
- **Design:** Design system's **Status Stepper** component (Approved → Transmitted → Acked → Shipped/Backordered), colors per Semantic Color Usage; raw-EDI viewer in `text-mono` on `an-bg-elevated` behind a "view raw" toggle.

**02. Data & Backend**

- **Database Schema:** Writes `purchase_orders.status = 'transmitted'` and stores the rendered X12 document in S3 (`edi_raw_s3_key`, not inline in Postgres — these documents are audit artifacts, not query targets); later reads `po_acknowledgements` / `asn_shipments` as the distributor responds (those tables are populated by the Exception Handler agent, covered under backend pipeline work, not this feature).
- **Database Tasks:** `generate850(po)` job renders X12 via the `edi-x12` library from `purchase_order_lines` + contract lookup; transmits via the VAN client; writes an `audit_log` entry with the full payload (7-yr retention, immutable).
- **Helper Functions:** `renderX12_850(po, lines, store, distributor)`; `validateX12Segments(document)` (schema check before send); `vanTransmit(document)`.
- **API Routes:** `POST /api/pos/{id}/transmit` (internal — invoked by the approve trigger, not directly user-facing) · `GET /api/pos/{id}/edi-raw` (download).

**03. Frontend & QA**

- **State Management:** Status chip subscribes to the PO-detail query; invalidated on webhook/poll when the backend status changes.
- **Components:** `<POStatusStepper>` · `<RawEdiViewer>` · `<TransmitFailureBanner>`.
- **Edge Cases:** VAN transmission failure (network/credential issue) — PO stays `approved`, retried with backoff; buyer sees "transmission pending," never a silent stuck state; malformed X12 fails `validateX12Segments` pre-send — blocks transmission and alerts engineering, must never reach the distributor half-formed; idempotency key per PO so a retry can't double-order.
- **Testing Checklist:** generated X12 850 round-trips through a schema validator/parser; simulated VAN outage exercises the retry/backoff path; replaying the transmit call doesn't create a second order (idempotency test); raw-EDI download byte-matches what was actually sent (audit fidelity).

---

## FEATURE_6 / Buyer Override Capture with Persistent Learning

**01. Product & UX**

- **Description:** Lets a buyer set a standing rule ("never substitute Synthroid at Store 047") that persists and is applied automatically by future agent runs.
- **User Flow:** From a substitution card (Feature 2) or SKU detail (Feature 3), buyer clicks "Add Rule" → picks `override_type` → scopes to a store or all stores → enters rationale → saves; rule appears in a manageable "My Rules" list and can be deactivated.
- **Placement:** Contextual entry points on Features 2/3, plus a dedicated `/rules` management page.
- **Design:** Form built from standard Input Fields (type dropdown, store-scope selector, rationale textarea); rules list uses the **Data Table** component with an active/inactive toggle per Semantic Color Usage. **(added 2026-08-01)** Clicking a rule row (anywhere but the toggle button) opens an `<OverrideDetailDrawer>` — full field grid (drug, scope, created-by, created date, rule ID), the rule's rationale, a plain-language explanation of what that `override_type` actually does, and its audit history (every create/reactivate/deactivate event with citations), reusing the same **Detail Drawer** component and citation-list styling FEATURE_7's Audit entry drawer established.

**02. Data & Backend**

- **Database Schema:** Reads/writes `buyer_overrides` (override_type, store_id nullable, ndc, rationale, active).
- **Database Tasks:** The Substitution Reasoner and Sourcing Optimizer agent jobs query active `buyer_overrides` at inference time as few-shot context (per PRD Grounding Strategy) — this feature owns the CRUD; the read-side integration into the agent's prompt context is backend agent work, not new schema here.
- **Helper Functions:** `validateOverrideScope(store_id, ndc)`; `formatOverrideSummary(override)` (human-readable rule text for the list view).
- **API Routes:** `GET /api/overrides?buyer_id` · `POST /api/overrides` · `PATCH /api/overrides/{id}` (toggle active) · `DELETE /api/overrides/{id}`. **(added 2026-08-01)** The detail drawer reuses FEATURE_7's `GET /api/audit?entity_type&entity_id&actor` — `entity_id` is a new filter param added to that route specifically to support fetching one rule's own history rather than the whole log, filtered client-side.

**03. Frontend & QA**

- **State Management:** TanStack Query list + mutations with cache invalidation; form state via React Hook Form. **(added 2026-08-01)** The detail drawer's audit-history query is keyed `['auditForOverride', override.id]` and must be explicitly invalidated (not just the `['overrides']` list) whenever the drawer's own Deactivate/Reactivate mutation succeeds — caught in this build as a real bug (badge updated, history list didn't) before being fixed, worth calling out since it's an easy invalidation gap to reintroduce on the real implementation too.
- **Components:** `<OverrideForm>` · `<OverrideRulesList>` · `<OverrideRow>` · `<ScopeSelector>` · `<OverrideDetailDrawer>` (added 2026-08-01).
- **Edge Cases:** conflicting overrides (two active rules on the same NDC+store with opposite intent) — UI warns before save; deactivating a rule already baked into an in-flight agent recommendation doesn't retroactively change that recommendation — next nightly run picks it up (documented behavior, not a bug); empty rationale blocks save (it's the explainability source, not optional metadata); a rule with no audit history (e.g. seeded at load time rather than created live) shows an explicit "no audit history recorded" state in the drawer rather than an empty section.
- **Testing Checklist:** CRUD round-trip; conflict-detection warning fires correctly; a deactivated rule is excluded from the next agent run's context (integration test against the agent's context-builder); store-scoped vs. all-stores precedence resolves correctly when both exist; detail drawer opens on row click but not on the toggle button click (event propagation is stopped there deliberately); toggling active/inactive from inside the drawer updates both the badge and the history list in the same view without requiring a re-open.

---

## FEATURE_7 / Audit Trail

**01. Product & UX**

- **Description:** Immutable, append-only log of every recommendation, override, substitution, and PO action with rationale + source — the compliance officer's primary surface.
- **User Flow:** Compliance officer opens Audit view → filters by date range / entity type / actor → drills into an entry → sees full payload (agent inputs, sources cited, decision, actor). **(implemented 2026-08-01)** Click any row → `<AuditEntryDetail>` drawer opens with: a plain-language one-line description of what happened, generated per entity-type/action pair (not a raw payload dump); actor/timestamp/audit-ID header; a labeled key-value grid of the structured payload; a numbered "Explainability & citations" list rendering every `sources[]` string recorded at write time; and, for `purchase_order` entries, a live-fetched link to the underlying PO with its raw X12 850/855 viewable inline — so a compliance reviewer can go from "why was this approved" straight to the actual EDI document without leaving the drawer.
- **Placement:** Restricted nav item "Audit Trail" (`/audit`), role-gated to compliance/director via FEATURE_0's `<RouteGuard>`.
- **Design:** Design system's **Data Table** component at 36px dense row height, with CSV export; entry detail as a read-only `text-mono` payload viewer on `an-bg-elevated` — visually distinct from every editable surface in the app, since nothing here is ever editable. The detail drawer reuses the shared **Detail Drawer** component (480px overlay), consistent with FEATURE_1's queue-row drawer.

**02. Data & Backend**

- **Database Schema:** `audit_log`, append-only — no `UPDATE`/`DELETE` grants at the Postgres role level, enforced by DB permissions, not just application logic. 7-year retention per PRD.
- **Database Tasks:** Every write path in Features 1–6 (and the backend agent pipeline) emits an `audit_log` row in the same transaction as its primary write, so an action and its audit record can never diverge. **(updated 2026-08-01)** Every write path now populates a non-empty `sources[]` citation array — the prototype build closed a gap where the `edi_855_received`/`edi_856_received` system events and the auto-created-override-from-substitution event were writing audit rows with no citation content, which would have left the new detail drawer with nothing to show for those entry types.
- **Helper Functions:** `formatAuditEntry(entry)`; `exportAuditCsv(filters)`; `redactPHI(payload)` — defense-in-depth assertion; PHI should never reach this payload by design, but the formatter checks anyway.
- **API Routes:** `GET /api/audit?entity_type&date_from&date_to&actor` (paginated) · `GET /api/audit/export.csv`.

**03. Frontend & QA**

- **State Management:** Server-driven pagination via TanStack Query's `useInfiniteQuery` / cursor pattern — this table can be large, never fully loaded client-side.
- **Components:** `<AuditTable>` · `<AuditFilters>` · `<AuditEntryDetail>` · `<ExportButton>`.
- **Edge Cases:** entry referencing a since-removed formulary NDC — formulary rows are soft-deleted (`deleted_at`), never hard-deleted, specifically so audit history stays resolvable; export of a very large date range runs as a background job with an email link rather than blocking synchronously; role-check failure returns 403, not a redirect that leaks whether the route exists; an entry with zero recorded citations renders an explicit "none recorded for this entry" label in the drawer rather than an empty section, so a missing citation is visibly a gap, not indistinguishable from "loading."
- **Testing Checklist:** DB-level immutability test (attempt `UPDATE`/`DELETE` as the app role, expect a permission error, not just an app-layer rejection); every Feature 1–6 write path produces exactly one matching `audit_log` row (integration test); RBAC — non-compliance/director role gets 403; CSV export matches on-screen filtered results; PHI-redaction assertion on the payload formatter; every write path's `sources[]` is non-empty (added 2026-08-01, to prevent the citation-gap regression above); detail drawer renders correctly for every distinct `entityType:action` pair, not just the common ones.

---

## FEATURE_8 / Director-Level Weekly Dashboard

**01. Product & UX**

- **Description:** Roll-up view for the Director of Supply Chain — stockout rate, working capital, expiration trend, savings to date — the ROI-proof surface for the COO.
- **User Flow:** Director opens Dashboard → sees weekly-refreshed KPI tiles + trend charts → drills into any metric by store or category → exports a summary for board reporting.
- **Placement:** `/dashboard` — default landing page for the director role (buyers land on Feature 1's Queue instead).
- **Design:** Design system's **KPI Stat Tile** component in a row at top (North Star metric uses `an-accent` for its value, per the KPI Stat Tile spec), trend charts below colored per Semantic Color Usage, store/category breakout as a **Data Table**.

**02. Data & Backend**

- **Database Schema:** Reads a pre-aggregated `weekly_chain_metrics` materialized view (derived from `stockout_events`, `inventory_snapshots`, expiration write-off records, `purchase_orders`) — never queries raw event tables live.
- **Database Tasks:** Weekly batch job (Sunday night, after the week closes) computes `weekly_chain_metrics`; savings-to-date is a running cumulative column, recomputed each cycle against the pre-agent baseline captured at pilot start.
- **Helper Functions:** `computeNorthStarMetric(stockoutEvents, dispenseEvents)`; `computeSavingsToDate(baseline, current)`; `formatTrendDelta(current, prior)`.
- **API Routes:** `GET /api/dashboard/summary?week` · `GET /api/dashboard/trend?metric&range` · `GET /api/dashboard/export`.

**03. Frontend & QA**

- **State Management:** TanStack Query with a longer `staleTime` (data refreshes weekly, no need for frequent refetch); chart zoom/range state kept local to the chart component.
- **Components:** `<KpiTile>` · `<TrendChart>` · `<SavingsCounter>` · `<StoreBreakoutTable>` · `<DashboardExportButton>`.
- **Edge Cases:** first week of a new pilot chain has no prior-week comparison — trend deltas show a "baseline week" state, never a misleading 0%/N/A; a store closed mid-week (renovation) is excluded from rate denominators for that week and footnoted; weekly job failure — dashboard shows the last-successful week's data with a clear "as of" timestamp, never a blank screen.
- **Testing Checklist:** North Star metric calculation matches a hand-computed fixture; savings-to-date is monotonically non-decreasing under normal fixtures (flags a regression if it unexpectedly drops); first-week baseline state renders correctly; store-exclusion logic for closures; export file matches on-screen numbers.

---

## FEATURE_9 / RxForecast Admin Metrics Dashboard

*Not in the PRD's MVP feature list — added 2026-07-31 in response to a gap: nothing in Features 0–8 or the Datadog dashboards in `deployment.md` gives RxForecast's own team an in-product view of the metrics `PRD.md` actually defines success by. Datadog is engineering telemetry for engineers; this is product telemetry for RxForecast leadership, ops, and the compliance review board — a different audience, a different data shape, and (see below) a deliberately different security boundary.*

**Metric taxonomy (updated 2026-07-31 per explicit requirement — must cover all four, plus platform where applicable):**

| Category | What it answers | Refresh |
|---|---|---|
| **AI Quality** | Is the model actually good? Forecast MAPE/MAE/sMAPE, substitution appropriateness (pharmacist-rated), citation-grounding rate, calibration error, model-routing split (Sonnet/Opus %), HHH gate status per launch stage | Nightly |
| **User Trust** | Do buyers actually believe the output? Buyer accept rate, substitution acceptance rate, PO modification rate, override rate by SKU, buyer NPS, explainability survey rating, Why-panel engagement rate | Nightly |
| **Business** | Is the product delivering the ROI it was sold on? North Star (Net OOS Hours/1K Rx), stockout/working-capital/expiration reduction, buyer time saved, PO accuracy, savings-to-date | Nightly |
| **Platform** *(live, where applicable)* | Is the system actually up right now? Current status, nightly batch success rate, EDI/VAN connectivity, active incident count, API uptime, real-time shortage-alert latency | **Live** — fetched at request time, not stored history |

Compliance (DEA/340B/DSCSA/incident counts) and Cost (Azure spend, Foundry token cost) remain their own categories too — full breakdown and rationale for why Platform is architecturally different from the other five: `lld.md` §3.2.2.

**Why this is a separate identity system, not a `role` value:** every other role in this document (`buyer`, `director`, `pic`, `compliance`, `pharmacist`) belongs to a pharmacy chain and is provisioned through that chain's SSO federation (`idp_role_mappings`, FEATURE_0). An RxForecast admin is a different kind of principal entirely — an RxForecast employee, not a chain employee — and this dashboard's whole value is **cross-chain** visibility, which is the single highest-blast-radius capability in the system. Reusing the `users`/`chains` model and just adding an `admin` role would mean one misconfigured `idp_role_mappings` row at any customer chain could theoretically grant cross-tenant access — an unacceptable failure mode for a HIPAA/DEA-adjacent product. So: separate table (`admin_users`), separate identity provider (RxForecast's own internal Entra ID tenant, never Entra External ID — the customer-facing federation path), separate session/auth flow, separate API route namespace, separate audit table. None of Features 0–8's chain-scoping code paths are reachable from this feature, and none of this feature's code paths are reachable from a chain-issued token — enforced at the auth-middleware level, not just by a role check on a shared token type.

**01. Product & UX**

- **Description:** Cross-chain view of every metric `PRD.md` §3 (Core Metrics), §8 (Evaluation Strategy), and §9 (HHH Launch Criteria) defines — portfolio rollup by default, chain-level drill-down as an explicit, separately-audited action.
- **User Flow:** RxForecast admin authenticates via the internal Entra ID tenant (not the customer SSO path) → lands on a **portfolio summary** with a live Platform Health strip at the top (system status, batch success, active incidents — always current, no chain selection needed) and chains shown as anonymized labels — "Chain A," "Chain B" — below it → selects a metric category (AI Quality / User Trust / Business / Compliance / Cost) → to see a specific chain's real identity and detail, explicitly confirms a "view identified data for this chain" step, which is the drill-down action that gets logged.
- **Placement:** Entirely separate subdomain/route (e.g. `admin.rxforecast.com`), not reachable via `/login/{chain_slug}` or any link inside the buyer-facing app.
- **Design:** Same design-system tokens/components as Features 0–8 for visual consistency (Data Table, KPI Stat Tile), but the shell carries a persistent, unmissable `<InternalOnlyBanner>` — a real security control, not decoration: it makes it obvious if someone is about to screen-share this to a customer by accident.

**02. Data & Backend**

- **Database Schema:** Owns `admin_users`, `metric_snapshots`, `admin_dashboard_access_log` (§0). Reads are aggregate-only against `forecast_results`, `stockout_events`, `substitution_events`, `purchase_orders`, and `audit_log` **counts** (never full `audit_log` payloads, which may contain chain-specific business detail beyond what this dashboard needs to show). **Platform-category data is never stored here at all** — see Helper Functions below.
- **Database Tasks:** Nightly job computes `metric_snapshots` per chain per day across the AI Quality / User Trust / Business / Compliance / Cost categories — every metric from `PRD.md` §3/§8/§9, plus the new Why-panel-engagement trust metric (`lld.md` §3.2.2 has the full list) — plus a portfolio-aggregate rollup, so the dashboard never runs expensive live aggregate queries across every chain's partitioned high-volume tables on page load. Every dashboard view, filter, and drill-down writes a row to `admin_dashboard_access_log` — unlike the rest of the app (where only mutations are audited), **reads are audited here**, because the sensitivity is in who looked at what, not just who changed what. Platform-status requests are logged too, but don't require the drill-down confirm step (they're not chain-identifying).
- **Helper Functions:** `computeHHHGateStatus(chain_id)` — evaluates current AI Quality metrics against `PRD.md` §9's per-stage thresholds (Measurement/Beta/Launch), returns pass/fail per Helpful/Honest/Harmless criterion; `aggregatePortfolioMetrics(snapshots)`; `redactChainIdentity()` — the portfolio view's default anonymization, lifted only by the explicit drill-down action; `fetchLivePlatformSnapshot()` — calls the Datadog/Azure Monitor API server-side with a ~60–90s cache, **never writes to `metric_snapshots`** (`lld.md` §3.2.2 explains why: this is point-in-time system health, not trend data, and belongs in a live-fetch path, not a growing history table).
- **API Routes:** `GET /api/admin/portfolio/summary` · `GET /api/admin/chains/{chain_id}/metrics?category=ai_quality|user_trust|business|compliance|cost` (writes an `admin_dashboard_access_log` row — this route is the drill-down) · `GET /api/admin/hhh-gate-status?chain_id` · `GET /api/admin/platform-status` (the live path — no chain param, portfolio-wide, cached) — all under `/api/admin/*`, gated by middleware that checks the token was issued by the **internal admin auth path**, not just that a role claim says `admin` (a chain-issued token can never satisfy this check, structurally, not just by convention).

**03. Frontend & QA**

- **State Management:** A separate API client instance with its own base URL and auth-header source from the buyer-facing app's client — reduces the chance a code-sharing bug ever sends an admin request with a customer token, or vice versa.
- **Components:** `<PortfolioSummary>` · `<ChainDrilldown>` · `<AIQualityPanel>` · `<UserTrustPanel>` · `<BusinessMetricsPanel>` · `<PlatformHealthStrip>` (polls `/api/admin/platform-status` every 60s while the dashboard is open) · `<HHHGateStatusPanel>` · `<MetricTrendChart>` · `<InternalOnlyBanner>`.
- **Edge Cases:** a chain with insufficient data for a metric (e.g., pre-Measurement-Launch) shows "not yet measurable," never a zero or blank that could be misread as an actual result; admin session timeout is **10 minutes** idle — shorter than the customer app's 15-minute window (`engg.md` FEATURE_0), because this is the highest-privilege surface in the system and deserves a tighter policy, not the same default; drill-down requires the explicit re-affirming step described above, so an accidental click never silently exposes identified cross-chain data; if the Datadog/Azure Monitor API is unreachable, `<PlatformHealthStrip>` shows "status unavailable" with a last-known-good timestamp — never a stale "healthy" reading presented as current, which would be worse than showing nothing; a high buyer-accept-rate alongside a low Why-panel-engagement-rate renders with a subtle callout (possible rubber-stamping, not a hard alert — this is a judgment signal for the admin, not an automated verdict).
- **Testing Checklist:** a chain-scoped JWT (any of `buyer`/`director`/`pic`/`compliance`/`pharmacist`) attempting any `/api/admin/*` route gets rejected — tested explicitly, not assumed from the role-check pattern used elsewhere; every drill-down produces exactly one `admin_dashboard_access_log` row (integration test, same completeness-testing pattern as FEATURE_7's audit-log test); portfolio view never renders a real chain name without a prior drill-down action in the same session (rendering test); HHH gate status calculation matches a hand-computed fixture against `PRD.md` §9's published thresholds; `<PlatformHealthStrip>` correctly falls back to "status unavailable" when the Datadog API call fails (fault-injection test, not just the happy path); all four required categories (AI Quality, User Trust, Business, Platform) render with real data end-to-end against the synthetic dataset before this is considered done.

---

*Based on `PRD.md` §4 (MVP Features) and §5 (Constraints — technical/regulatory guardrails reflected in the Edge Cases above). FEATURE_0 (Authentication & Session Management) and FEATURE_9 (Admin Metrics Dashboard) are not in the PRD's MVP feature list but are added here as required infrastructure — FEATURE_0 because every RBAC/role-gating note in Features 1–8 depends on it, FEATURE_9 because production readiness requires a way to actually see the metrics `PRD.md` defines success by. Backend agent-pipeline components (Demand Forecaster, Shortage Watcher, Substitution Reasoner, Sourcing Optimizer, Exception Handler) are the data producers referenced throughout but are specified separately as their own service, not part of this buyer-facing application.*
