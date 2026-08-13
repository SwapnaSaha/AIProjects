# RxForecast — Execution Plan

**Purpose:** `PRD.md` (what/why), `engg.md` (feature-level spec), `lld.md` (how it runs in production) are specifications. This document is the **build plan** — every discrete piece of work needed to go from zero to a production-ready, launched system, sequenced against the PRD's phased roadmap, with an owner-workstream and a source-of-truth pointer for each item. Nothing here invents new scope; every line traces back to one of the other four docs (`plan.md`, `PRD.md`, `engg.md`, `design-system.md`, `lld.md`).

**How to use this:** Section 1 is the one-page view. Sections 2–5 are the phase-by-phase work breakdown (checkbox lists, gate criteria at the end of each). Section 6 is a flat master checklist across every category, for auditing "did we actually cover everything" independent of phase. Section 7 is the final production go-live gate. Section 8 is open items that block or risk the plan.

---

## 1. Execution Overview

| Phase | Duration | Scope (PRD.md §4) | Gate to next phase |
|---|---|---|---|
| **Phase 0 — Foundations** | 2–3 wks, pre-Sprint-1 | Azure landing zone, IaC, vendor contracts, open decisions resolved | Infra exists, team onboarded |
| **Phase 1 — MVP** | 12 wks | Data ingestion, Demand Forecaster, Shortage Watcher, Buyer UI (Queue + Forecast), FEATURE_0/1/3 | Measurement Launch criteria (§2.10) |
| **Phase 2 — MVP 1** | 12 wks | Substitution Reasoner, Sourcing Optimizer, 2nd distributor, FEATURE_2/6/8 | Beta Launch criteria (§3.9) |
| **Phase 3 — Launch** | 12 wks | PO Drafter + EDI 850 transmit, Exception Handler, FEATURE_4/5/7, SOC 2 | Go-live criteria (§7) |
| **Phase 4 — Iteration** | 6-mo cadence, ongoing | Controlled substances, multi-chain, GPO, autonomous PO, external signals | N/A — continuous |

**Team** (per `PRD.md` Appendix B): 1 DevOps/Platform, 2 Backend, 1 Frontend, 1 ML Engineer, 1 PharmD SME, 1 PM, 1 Designer, 1 Compliance Lead. Same roster carries across Phases 1–3; Phase 4 adds headcount per chain-count growth (not sized here).

**Workstream legend used throughout:** `INFRA` (platform/cloud) · `DATA` (schema/migrations) · `AGENT` (LangGraph pipeline) · `EDI` (X12 integration) · `FE` (buyer-facing features) · `SEC` (security/compliance) · `OBS` (observability) · `QA` (testing/eval) · `DOC` (documentation/rollout)

---

## 2. Phase 0 — Foundations (pre-Sprint-1)

Nothing in Phase 1 can start until this phase is done — it's infrastructure and decisions, not features.

### 2.1 Resolve blocking open decisions (source: `lld.md` §12)

- [ ] **`INFRA`** AS2 library/vendor for the VAN connector — build vs. buy a managed AS2 gateway
- [ ] **`SEC`** Per-chain Key Vault keys — confirm single application CMK is acceptable for pilot, or if the first chain requires per-tenant keys
- [ ] **`AGENT`** Embedding model for Azure AI Search — confirm `text-embedding-3-large` availability/compatibility at build time
- [ ] **`SEC`** Entra External ID vs. WorkOS — pilot federation against 2–3 real chain IdPs (Okta, Azure AD, Google Workspace) before committing; WorkOS is the fallback if Entra's CIAM setup proves too heavy
- [ ] **`INFRA`** Terraform vs. Bicep for IaC
- [ ] **`SEC`** De-identification connector deployment model — per-chain technical discovery call needed; can't be answered generically
- [ ] **`DOC`** Confirm `PRD.md` Appendix B's Azure directional cost estimates against the actual Azure Pricing Calculator

### 2.2 Azure landing zone (`INFRA`, source: `lld.md` §1, §7.1, §7.3)

- [ ] Three Azure subscriptions provisioned: `dev`, `staging`, `prod` (subscription-level isolation, not just resource groups)
- [ ] VNet + subnets per environment (edge, Container Apps Environment, data subnet with private endpoints only)
- [ ] NSGs restricting data-subnet access to the Container Apps Environment's subnet only
- [ ] Terraform repo scaffolded: `modules/networking`, `modules/postgres`, `modules/container-apps`, `modules/cosmos`, `modules/storage`, `modules/keyvault`, `modules/ai-foundry`
- [ ] Core resources stood up in `dev` first: Container Apps Environment, Azure Container Registry, Key Vault, Azure Database for PostgreSQL Flexible Server (zone-redundant), Cosmos DB (NoSQL API), Blob Storage (3 containers: `edi-raw`, `model-artifacts`, `exports`), Azure AI Search, Azure AI Foundry project with Sonnet + Opus deployments
- [ ] Azure AI Content Safety resource provisioned (added 2026-08-12) — separate resource from the Foundry project, feeds the groundedness gate in `lld.md` §4.5
- [ ] Azure Front Door + Static Web Apps configured for the (not-yet-built) React SPA
- [ ] Managed Identities created for each Container App, RBAC-scoped to only the resources that app needs (least privilege, not a shared identity)

### 2.3 CI/CD skeleton (`INFRA`, source: `lld.md` §7.2)

- [ ] GitHub Actions: build → unit test → push to ACR → auto-deploy `staging` → manual-approval deploy `prod`
- [ ] Alembic migration runner wired as a pre-deploy Container Apps Job step (never auto-applied on app boot)
- [ ] Container Apps revision-based traffic splitting configured for `api-service` blue/green

### 2.4 Vendor/legal setup (`SEC`, `DOC`)

- [ ] Microsoft Azure BAA executed (HIPAA)
- [ ] Anthropic terms confirmed for Claude access via Azure AI Foundry's model catalog
- [ ] Azure AI Content Safety and Foundry Evaluation SDK usage terms confirmed under the same Azure BAA (added 2026-08-12) — not assumed automatically covered by the Foundry model-catalog agreement alone
- [ ] Prefect Cloud, Datadog accounts provisioned
- [ ] Pilot chain's distributor VAN credentials obtained (McKesson AS2 endpoint per `PRD.md`'s pilot scope)
- [ ] Pilot chain data-sharing agreement covering the 24 months of historical dispense/PO/EDI data required by `PRD.md` §8 Ground Truth Setup

### 2.5 Team onboarding (`DOC`)

- [ ] All 8 roles from `PRD.md` Appendix B staffed and onboarded
- [ ] `PRD.md`, `engg.md`, `lld.md`, `design-system.md` read by every engineer before Sprint 1 (this document assumes that context)

---

## 3. Phase 1 — MVP (12 weeks)

Scope per `PRD.md` roadmap: "Pilot chain integration (EDI 846 ingest from McKesson, dispense data from PMS). Demand Forecaster live on top 200 SKUs. Shortage Watcher with FDA + ASHP feeds. Buyer UI v1 with daily queue + explainability panel. Advisory PO recommendations. HIPAA-grade infrastructure baseline."

### 3.1 Identity & Access — FEATURE_0 (`SEC`, `DATA`, `FE`; full spec: `engg.md` FEATURE_0)

- [ ] `chains`, `users`, `auth_sessions`, `idp_role_mappings` tables migrated (DDL: `lld.md` §3.2)
- [ ] Entra External ID (or WorkOS, per §2.1 decision) integration: SSO start/callback routes, IdP-group → role/store mapping
- [ ] Email+password+MFA fallback path (pilot-only, per `engg.md` §0.1 rationale)
- [ ] JWT issuance (`issueSessionTokens`), verification, refresh-on-401 flow
- [ ] `enforceStoreScope()` / `enforceChainScope()` helper — the actual mechanism behind every RBAC note in Features 1–8 (behavior prototype-validated 2026-08-01: PIC's requested `store_id` is server-overridden on every FEATURE_1 read, and FEATURE_3's PO-creation routes 403 a cross-store write — still needs the real JWT/Postgres-role version for production, this only proves the enforcement *shape* is right)
- [ ] `<RouteGuard>` frontend component wrapping every route
- [ ] Session policy enforced: 15-min inactivity timeout, 12-hr absolute max, MFA required for compliance/director/pharmacist roles
- [ ] Login/logout/failed-login/session-revoke events write to `audit_log`
- [ ] Service-account auth path for `agent-orchestrator` and EDI services (Managed Identity, not a human session)

### 3.2 Core data model (`DATA`, source: `lld.md` §3.2–3.3)

- [ ] Full DDL applied: `stores`, `formulary`, `distributor_contracts`, `dispense_events` (partitioned), `inventory_snapshots`, `forecast_results`, `stockout_events`, `shortage_events`, `substitution_events`, `purchase_orders` + lines, `po_acknowledgements`, `asn_shipments`, `buyer_overrides`, `audit_log` (partitioned), `edi_control_numbers`
- [ ] Postgres role/permission model applied: `rxforecast_app` role, `REVOKE UPDATE, DELETE ON audit_log` — verified with an actual failed-permission test, not just the migration running
- [ ] Partition-management job: creates `dispense_events`/`audit_log` partitions 3 months ahead on a schedule
- [ ] `chain_id` multi-tenancy scoping verified on every table per `lld.md` §3.1

### 3.3 Data ingestion (`EDI`, `AGENT`; source: `lld.md` §5.1)

- [ ] De-identification connector deployed into the pilot chain's environment (per §2.1's resolved deployment model) — strips to `(NDC, store_id, date, quantity)` only, per `lld.md` §7.5
- [ ] `edi-ingestion-service` built: `VanConnector` interface + `AS2Connector` for McKesson
- [ ] EDI 846 (inventory) parsing via `edi-x12`, typed line-item objects
- [ ] Dead-letter path for malformed segments + Datadog alert
- [ ] FDA Drug Shortage List polling (every 4hrs) and ASHP bulletin polling (daily)
- [ ] Azure AI Document Intelligence OCR fallback for scanned PDF bulletins (100-word-minimum heuristic trigger)
- [ ] NDC/formulary sync job (weekly, per `PRD.md`)

### 3.4 Agent pipeline v1 (`AGENT`; source: `lld.md` §4)

- [ ] LangGraph `StoreRunState` schema implemented (`lld.md` §4.2)
- [ ] **Demand Forecaster** node — LightGBM, trained on pilot chain's 24-month historical data, top-200-SKU scope for MVP
- [ ] `forecaster-worker` Container Apps Job (scheduled, not always-on) wired to nightly cadence
- [ ] **Inventory Reconciler** node — nets forecast against on-hand/in-transit
- [ ] **Shortage Watcher** node — LLM extraction from FDA/ASHP text via Azure AI Foundry (Claude Sonnet)
- [ ] `trace_id` capture wired on every Foundry call (added 2026-08-12), threaded into `StoreRunState.citations` per `lld.md` §4.5
- [ ] Explainability citation wrapper (`@with_citations`) applied to every LLM-calling node
- [ ] Prefect flow-per-chain, fan-out to per-store LangGraph sub-runs, bounded concurrency (20 concurrent stores default)
- [ ] Idempotency: node output keyed on `(run_id, node_name)` in Cosmos DB checkpoint store
- [ ] Confidence-banded fallback to par levels for SKUs with <6 months history

### 3.5 Buyer-facing features — FEATURE_1, FEATURE_3 (`FE`; full specs: `engg.md`)

- [ ] **FEATURE_1 Reorder Queue**: `v_reorder_queue` materialized view, `GET /api/queue`, `<QueueTable>`/`<QueueRow>`/`<ReorderDetailDrawer>`, priority-score formula, empty/stale-queue states
- [ ] **FEATURE_1 Bulk approve**: `POST /api/pos/bulk` with per-item results (207 Multi-Status), `<BulkActionBar>`, checkbox+inline-quantity UI with a decoupled edit/save step (pre-filled agent-recommended qty, per-row Save commits an override, unsaved edits don't carry into the batch), Schedule II exclusion (flow prototype-validated 2026-08-01 — production version needs the `Idempotency-Key` treatment described in `lld.md` §6, which the prototype's in-memory endpoint doesn't implement)
- [ ] **FEATURE_1 Defer resurfacing**: per-user defer set cleared on that user's next login, Reject kept on a separate permanent set (prototype-validated 2026-08-01 as the demo's stand-in for the real 24h/nightly-cycle resurfacing — production still needs the actual scheduled job, this only proves the "defer is temporary, reject is not" distinction end to end)
- [ ] **FEATURE_3 Forecast View**: `GET /api/forecast/{store_id}/{ndc}`, `<ForecastChart>`/`<WhyPanel>`, cold-start "insufficient data" state

### 3.6 Design system foundation (`FE`; source: `design-system.md`)

- [ ] Tailwind config with `an-*` tokens (including `an-critical`)
- [ ] Core components built once, reused everywhere: Buttons (incl. Critical variant), Input Fields, Data Table, Detail Drawer, Badges/Status Chips
- [ ] Dark-mode-primary app shell (Sidebar + Main Content Area), light-mode auth surface

### 3.7 Security & compliance baseline (`SEC`; source: `lld.md` §7.4–7.5, `PRD.md` §5)

- [ ] Encryption at rest (Azure Storage/Postgres default + Key Vault-managed keys) and in transit (TLS everywhere)
- [ ] PHI boundary verified: confirm zero PHI fields reach `dispense_events` or any LLM-bound payload (this is a testable assertion, not just a design intent — see §3.8 QA)
- [ ] No direct human DB access — API-only or audited break-glass path

### 3.8 Observability baseline (`OBS`; source: `lld.md` §8)

- [ ] Datadog + Azure Monitor wired for all MVP services (`api-service`, `agent-orchestrator`, `edi-ingestion-service`)
- [ ] `/health` endpoints on every Container App
- [ ] Structured JSON logging with `chain_id`/`run_id`/`request_id` on every line

### 3.9 Testing (`QA`; source: `lld.md` §9)

- [ ] Unit tests for MVP helper functions (`computePriorityScore`, forecast formulas)
- [ ] Integration tests (testcontainers: Postgres, Cosmos DB Emulator) for FEATURE_0/1/3 write paths
- [ ] EDI round-trip test: 846 parsing against `raw_edi_samples/*.edi` from the synthetic dataset
- [ ] Forecast backtest: LightGBM against `RxForecast_SyntheticData/dispense_history.csv` (or real pilot data once available), 6-month holdout per `PRD.md` §8
- [ ] PHI-redaction assertion test (confirms §3.7's boundary claim, not just documents it)

### 3.10 Admin Metrics Dashboard foundation — FEATURE_9 (`SEC`, `DATA`, `FE`; full spec: `engg.md` FEATURE_9, `lld.md` §3.2.1)

Build the identity isolation and data foundation now, even though most metric categories aren't meaningful until later phases — retrofitting the isolation boundary after real chain data exists is a much bigger job than building it in from day one.

- [ ] `admin_users`, `metric_snapshots`, `admin_dashboard_access_log` tables migrated (DDL: `lld.md` §3.2)
- [ ] RxForecast internal Entra ID tenant provisioned, separate from the customer-facing Entra External ID (`lld.md` §3.2.1) — confirm no trust relationship between the two
- [ ] `/api/admin/*` route namespace scaffolded with its own auth middleware (checks token issuer, not just a role claim)
- [ ] Admin portal deployed as its own Static Web App (`admin.rxforecast.com`), separate from the buyer-facing SPA
- [ ] Conditional Access policy (corporate network + device compliance) applied to the admin app registration
- [ ] Nightly `metric_snapshots` job computes what's measurable at this phase: North Star + Business category metrics (`PRD.md` §3) for the single pilot chain — AI Quality and User Trust categories land in Phase 2 (§4.8) once the eval harness and enough buyer-interaction volume exist
- [ ] `<PortfolioSummary>`/`<InternalOnlyBanner>` built (portfolio view is trivial with one chain, but the component and the access-log-on-every-view behavior should exist now, not be bolted on later)
- [ ] `GET /api/admin/platform-status` + `<PlatformHealthStrip>` built against Datadog's API — **live** category, built early since it only needs the Datadog setup from §3.8, not chain-specific business data; includes the fault-injection test (Datadog unreachable → "status unavailable," never a stale "healthy")
- [ ] Cross-tenant test from the *other* direction: a chain-issued JWT attempting `/api/admin/*` is rejected (deployment.md §3.1.1)

### 3.11 Gate — Measurement Launch (source: `PRD.md` §9)

All must be true before Phase 2 starts:

- [ ] Forecast MAPE ≤20% on top-200 SKUs at pilot chain
- [ ] 100% of recommendations include source citation; zero hallucinated drug names/NDCs/dosages in a 2-week shadow run
- [ ] Zero autonomous actions — all output read-only, no PO transmission, no PHI in LLM context (verified, per §3.9)
- [ ] 1 pilot store, 2 weeks, shadow mode completed

---

## 4. Phase 2 — MVP 1 (12 weeks)

Scope per `PRD.md` roadmap: "Expand to top 2,000 SKUs. Substitution Reasoner (advisory only) with pharmacist-panel calibration. Multi-distributor integration (Cardinal added). Sourcing Optimizer v1. Explainability v2. Director-level dashboard."

### 4.1 Agent pipeline v2 (`AGENT`; source: `lld.md` §4.3)

- [ ] **Substitution Reasoner** node — Claude via Foundry, RAG over Azure AI Search `formulary-kb`, chain-of-thought (TE class → payer → contract → DEA schedule → store history)
- [ ] SAFE1 node — hardcoded Schedule II/DSCSA hard-block check, routes to `an-critical` pharmacist queue on block
- [ ] **Content Safety groundedness gate** (added 2026-08-12) — every Substitution Reasoner output scored against its retrieved grounding docs before SAFE2; below-threshold routes to pharmacist review (`lld.md` §4.5, threshold is open decision §12.8)
- [ ] **Foundry Evaluation SDK wired for continuous production scoring** (added 2026-08-12) — sampled live calls scored async, nightly rollup into `metric_snapshots.ai_quality` (`engg.md` FEATURE_9, `PRD.md` §8)
- [ ] **Sourcing Optimizer** node — multi-distributor cost/availability comparison
- [ ] Model routing (`route_model`) — Sonnet default, Opus escalation on low-confidence or conflicting-TE-code cases (~5% target)
- [ ] Forecast scope expanded from top-200 to top-2,000 SKUs

### 4.2 Knowledge base / RAG (`AGENT`; source: `lld.md` §3.6)

- [ ] Azure AI Search index `formulary-kb` populated: RxNorm, Orange Book, NDC Directory, GPO/340B contract sheets — chunked ~500 tokens, section-header metadata
- [ ] Azure AI Search index `shortage-kb` populated, re-indexed every 4-hr FDA poll
- [ ] Embedding pipeline (Azure OpenAI `text-embedding-3-large`) wired into both indexes
- [ ] Per-chain index isolation verified

### 4.3 EDI — second distributor (`EDI`)

- [ ] `AS2Connector` instance for Cardinal Health added to `edi-ingestion-service`
- [ ] Sourcing Optimizer's distributor-comparison logic tested against both live feeds

### 4.4 Buyer-facing features — FEATURE_2, FEATURE_6, FEATURE_8 (`FE`; full specs: `engg.md`)

- [ ] **FEATURE_2 Shortage Alert Feed**: `<ShortageCard>`, accept/reject flow, `an-critical` Schedule II disable state
- [ ] **FEATURE_6 Buyer Overrides**: `/rules` page, CRUD, conflict-detection warning, integration test confirming a deactivated rule is excluded from the next agent run's prompt context
- [ ] **FEATURE_6 Rule detail drawer**: `<OverrideDetailDrawer>`, `GET /api/audit?entity_type&entity_id` (flow prototype-validated 2026-08-01 — including catching and fixing a query-invalidation gap where toggling a rule from inside its own drawer updated the badge but not the history list until the audit-history query was explicitly invalidated too, not just the rules list)
- [ ] **FEATURE_8 Director Dashboard v1**: `weekly_chain_metrics` materialized view, weekly batch job, `<KpiTile>`/`<TrendChart>`

### 4.5 Human-in-the-loop — pharmacist panel (`FE`, `SEC`; source: `PRD.md` §4, §9)

- [ ] Pharmacist review queue for substitution sign-off (advisory-only gate before Beta)
- [ ] 200-case substitution evaluation set constructed and validated by the 5-PharmD panel (per `PRD.md` §8 Ground Truth Setup)

### 4.6 Evaluation harness (`QA`; source: `PRD.md` §8, `lld.md` §9)

- [ ] Offline eval CI job: forecast MAPE/MAE/sMAPE, substitution appropriateness against the 200-case set, citation-grounding rate
- [ ] Confidence-calibration monitoring wired
- [ ] Online A/B harness scaffolded (50/50 store split) ahead of Beta

### 4.7 Admin Metrics Dashboard — AI Quality & User Trust categories (`SEC`, `DATA`, `FE`; extends §3.10, full spec: `engg.md` FEATURE_9, taxonomy: `lld.md` §3.2.2)

- [ ] `metric_snapshots` job extended to write **AI Quality** metrics (from §4.6's harness output: MAPE/MAE/sMAPE, substitution appropriateness, citation-grounding rate, calibration error, Sonnet/Opus routing split) and HHH gate status (`computeHHHGateStatus()` against `PRD.md` §9's per-stage thresholds, rendered via `<AIQualityPanel>`/`<HHHGateStatusPanel>`)
- [ ] AI Quality extended with **Foundry Evaluation SDK groundedness/relevance score** (nightly rollup of §4.1's sampled continuous scoring) and **Content Safety gate trigger rate** (added 2026-08-12 — `lld.md` §4.5, `PRD.md` §8)
- [ ] `metric_snapshots` job extended to write **User Trust** metrics: buyer accept rate, substitution acceptance rate, PO modification rate, override rate by SKU, buyer NPS, explainability survey rating, and the new Why-panel engagement rate (`<UserTrustPanel>`) — this requires instrumenting the buyer-facing app to actually log Why-panel opens, a small addition to FEATURE_3
- [ ] Chain drill-down flow completed: explicit confirm step, `redactChainIdentity()`/reveal behavior, `admin_dashboard_access_log` row per drill-down verified via integration test
- [ ] `metric_snapshots` job extended to write `compliance`-category metrics (P0/P1 incident counts, DEA/340B/DSCSA event counts)

### 4.8 Gate — Beta Launch (source: `PRD.md` §9)

- [ ] Stockout rate reduced ≥10% vs. baseline on managed SKUs
- [ ] Buyer accept rate >70%
- [ ] Explainability rated ≥4/5 by buyers in survey
- [ ] <0.5% of substitution recommendations flagged clinically inappropriate by pharmacist review
- [ ] Zero DEA/340B/DSCSA compliance events
- [ ] 10–20 stores, 90 days completed

---

## 5. Phase 3 — Launch (12 weeks)

Scope per `PRD.md` roadmap: "One-click EDI 850 generation + transmission. Exception Handler with 855/856 monitor and automatic replan on backorder. 340B-aware sourcing. Expiration optimization. Buyer override learning closed loop. SOC 2 Type 2."

### 5.1 Agent pipeline v3 — PO generation & exception handling (`AGENT`, `EDI`; source: `lld.md` §4.3, §5.2)

- [ ] **PO Drafter** node — builds `purchase_orders`/`purchase_order_lines` from Sourcing Optimizer's decision
- [ ] SAFE2 node — self-consistency safety pass (second Claude call, safety-only system prompt), Azure AI Content Safety as optional additional layer
- [ ] **Exception Handler** node — polls 855/856, triggers replan on backorder, loops back to Sourcing Optimizer

### 5.2 EDI outbound — FEATURE_5 (`EDI`; full spec: `engg.md` FEATURE_5, `lld.md` §5.2)

- [ ] `edi-transmission-service` built: `renderX12_850`, `validateX12Segments`, `vanTransmit`
- [ ] `edi_control_numbers` table wired into the transmit transaction (no ISA/GS/ST collisions)
- [ ] 997 functional-acknowledgement handling — missing-997-within-4hrs flags `transmitted_unconfirmed` (closes the "silent failure" gap)
- [ ] 860 cancellation path (transmit-failure/idempotency-triggered, plus manual compliance trigger)
- [ ] Idempotency key per PO — retry-safe transmission

### 5.3 Buyer-facing features — FEATURE_4, FEATURE_7 (`FE`; full specs: `engg.md`)

- [ ] **FEATURE_4 Approve/Modify/Reject**: `<POActionBar>`, 2-sigma quantity sanity check, Schedule II hard-block (no Approve/Modify buttons rendered at all), optimistic-locking concurrency handling
- [ ] **FEATURE_5 status surface**: `<POStatusStepper>`, `<RawEdiViewer>`
- [ ] **FEATURE_7 Audit Trail**: `<AuditTable>` with cursor pagination, CSV export, DB-level immutability test passing
- [ ] **FEATURE_7 Audit entry detail drawer**: `<AuditEntryDetail>` — plain-language description per entity-type/action, payload key-value grid, numbered citations list, linked raw X12 850/855 for `purchase_order` entries (flow prototype-validated 2026-08-01; production version additionally needs `redactPHI(payload)` applied before render, per `engg.md` FEATURE_7 §02, and cursor-based fetch instead of the prototype's full-list-then-click)

### 5.4 Sourcing refinements (`AGENT`)

- [ ] 340B-aware sourcing — contract eligibility checks, hard rule against 340B/non-340B inventory commingling
- [ ] Expiration optimization — route shorter-dated stock to high-velocity stores
- [ ] Buyer override closed-loop — active overrides included as few-shot context in Substitution Reasoner/Sourcing Optimizer prompts (verified via integration test, not just implemented)

### 5.5 Security & compliance — SOC 2 readiness (`SEC`; source: `PRD.md` §9, `lld.md` §7.4)

- [ ] Penetration test completed and findings remediated
- [ ] Postgres role/permission audit — attempted `UPDATE`/`DELETE` on `audit_log` as the app role, confirmed rejected at the DB level
- [ ] Break-glass procedure documented and tested (separate credential, itself audit-logged)
- [ ] SOC 2 Type 1 in hand; Type 2 track underway
- [ ] HIPAA BAA executed with the pilot chain
- [ ] Admin Metrics Dashboard (FEATURE_9) full security checklist passed (`deployment.md` §3.1.1) — this is the single highest-blast-radius surface in the system and gets its own explicit sign-off, not a bullet buried in this list
- [ ] `metric_snapshots` job extended to write `cost`-category metrics (Azure spend per chain vs. `PRD.md` Appendix B directional estimate)

### 5.6 Observability — full incident tiering (`OBS`; source: `PRD.md` §9, `lld.md` §8)

- [ ] Alert routing configured to open the correct `PRD.md` §9 Tier 1/2/3 runbook, not a generic ticket
- [ ] Status page live (public-facing)
- [ ] On-call rotation established, 24/7 during pilot

### 5.7 Load & scale testing (`QA`; source: `lld.md` §9)

- [ ] k6 load test: 100 concurrent store-runs (nightly batch profile) against `staging`
- [ ] Confirm autoscale behavior on `api-service`, `agent-orchestrator`, `edi-ingestion-service` under load

### 5.8 Rollout execution (`DOC`; source: `lld.md` §11)

- [ ] Historical data migration ETL (24 months dispense/PO/855/856) completed for the pilot chain
- [ ] VAN cutover: shadow mode → live outbound transmission enabled
- [ ] 60+ stores onboarded, full MVP+MVP1+Launch feature set live

### 5.9 Go-live gate

See §7 (Production Readiness Checklist) — this is the consolidated final gate before calling the system "launched," not repeated here.

---

## 6. Master Checklist (flat, cross-phase — for auditing completeness)

Every category from `PRD.md`/`engg.md`/`lld.md`, flattened, independent of when it lands in the phase plan above. Use this to sanity-check nothing was missed, not as a second sequencing tool.

### Infrastructure (`lld.md` §1–3, §7)
- [ ] 3 Azure subscriptions (dev/staging/prod) · [ ] VNet/subnets/NSGs · [ ] Container Apps Environment · [ ] ACR · [ ] Key Vault · [ ] Postgres Flexible Server (zone-redundant) · [ ] Cosmos DB · [ ] Blob Storage (3 containers + immutability policy on `edi-raw`) · [ ] Azure AI Search (per-chain indexes) · [ ] Azure AI Foundry project + model deployments · [ ] Azure Front Door · [ ] Static Web Apps · [ ] Service Bus queues · [ ] Container Apps Jobs (scheduled) · [ ] Terraform modules for all of the above

### Data model (`lld.md` §3.2–3.3)
- [ ] All 20 tables from the DDL migrated (17 core + `admin_users`/`metric_snapshots`/`admin_dashboard_access_log`) · [ ] Partitioning live on `dispense_events`/`audit_log`/`admin_dashboard_access_log` · [ ] `edi_control_numbers` · [ ] Postgres append-only role grants verified · [ ] Soft-delete (`deleted_at`) enforced, no hard deletes anywhere

### Identity (`engg.md` FEATURE_0)
- [ ] SSO federation · [ ] Password+MFA fallback · [ ] JWT issue/refresh/revoke · [ ] Session timeout policy · [ ] RouteGuard · [ ] Auth event audit logging · [ ] Service-account auth for backend services

### Agent pipeline — all 9 components (`PRD.md` §4, `lld.md` §4)
- [ ] Data Ingestion · [ ] Demand Forecaster · [ ] Shortage Watcher · [ ] Inventory Reconciler · [ ] Substitution Reasoner · [ ] Sourcing Optimizer · [ ] PO Drafter · [ ] Exception Handler · [ ] Explainability Layer (citation wrapper)

### EDI (`lld.md` §5)
- [ ] 846 inbound · [ ] 855 inbound · [ ] 856 inbound · [ ] 869 inbound · [ ] 850 outbound · [ ] 997 handling · [ ] 860 cancellation · [ ] AS2 + SFTP connectors · [ ] Control-number management · [ ] Dead-letter handling

### Buyer-facing features — all 8 (`engg.md` FEATURE_1–8)
- [ ] Reorder Queue · [ ] Shortage Alert Feed · [ ] Forecast View · [ ] Approve/Modify/Reject · [ ] EDI 850 status surface · [ ] Buyer Overrides · [ ] Audit Trail · [ ] Director Dashboard

### Internal Admin Metrics Dashboard — FEATURE_9 (`engg.md` FEATURE_9, `lld.md` §3.2.1–3.2.2)
- [ ] Separate internal Entra ID tenant (no trust to Entra External ID) · [ ] `admin_users`/`metric_snapshots`/`admin_dashboard_access_log` · [ ] `/api/admin/*` isolated auth middleware · [ ] Separate Static Web App · [ ] Conditional Access (corporate network + device compliance) · [ ] No-opt-out MFA · [ ] 10-min session timeout · [ ] Portfolio anonymization + audited drill-down · [ ] `<InternalOnlyBanner>` · [ ] Reverse cross-tenant test (chain token rejected by admin routes)
- [ ] **AI Quality** (MAPE/calibration/HHH gate) · [ ] **User Trust** (accept rate/NPS/Why-panel engagement) · [ ] **Business** (North Star/stockout/savings) · [ ] **Platform** (live Datadog pull, `<PlatformHealthStrip>`, "status unavailable" fallback tested) · [ ] Compliance · [ ] Cost — all six categories wired and rendering real data

### Design system (`design-system.md`)
- [ ] Token/Tailwind setup · [ ] Buttons (incl. Critical) · [ ] Input Fields · [ ] Data Table · [ ] Detail Drawer · [ ] KPI Stat Tile · [ ] Status Stepper · [ ] Cards/Panels · [ ] Badges/Status Chips · [ ] Icon mapping · [ ] Motion/copy-voice rules applied

### Security & compliance (`PRD.md` §5, §9; `lld.md` §7.4–7.5)
- [ ] PHI de-identification connector · [ ] Encryption at rest/in transit · [ ] Network isolation (chain-scoped) · [ ] `an-critical` hard-blocks enforced server-side · [ ] HIPAA BAA · [ ] SOC 2 Type 1 → Type 2 · [ ] Penetration test · [ ] Break-glass procedure

### Observability (`lld.md` §8)
- [ ] Datadog · [ ] Azure Monitor · [ ] Structured logging · [ ] Business-metric dashboards · [ ] Incident-tier alert routing · [ ] Status page · [ ] On-call rotation

### Testing & evaluation (`lld.md` §9, `PRD.md` §8)
- [ ] Unit · [ ] Integration · [ ] Contract (Schemathesis) · [ ] EDI round-trip · [ ] Agent eval (offline harness in CI) · [ ] E2E (Playwright) · [ ] Load (k6) · [ ] HHH launch-gate evals

### Documentation & rollout (`lld.md` §11)
- [ ] System card · [ ] API docs (OpenAPI) · [ ] Runbooks per incident tier · [ ] Pilot-chain onboarding runbook executed · [ ] Data migration ETL · [ ] VAN shadow-mode → live cutover

---

## 7. Production Readiness Checklist (final go-live gate)

Consolidated from `PRD.md` §9 Go-live Decision Criteria + HHH Launch Criteria + `lld.md` §10 NFR→SLO table. **All must be true simultaneously** — this isn't a phase, it's the gate that ends Phase 3.

- [ ] Forecast MAPE ≤15% on top-200 SKUs at pilot chain
- [ ] Pharmacist panel approves substitution safety profile (>95% appropriate)
- [ ] Buyer accept rate >70% across two consecutive 30-day windows
- [ ] Zero P0 (compliance) and zero P1 (clinical safety) incidents during beta
- [ ] SOC 2 Type 1 in hand, HIPAA BAA executed, penetration test passed
- [ ] Customer sign-off: pilot chain VP of Supply Chain approves the launch ROI case
- [ ] 20% stockout reduction, 15% working-capital reduction demonstrated
- [ ] Buyer NPS >40
- [ ] <0.1% citation errors; full audit trail covers 100% of generated POs
- [ ] Real-time shortage alert p95 ≤25s (5s margin under the 30s target)
- [ ] `an-critical` hard-blocks verified server-side-enforced (not just UI-hidden) via a dedicated test
- [ ] 7-year audit/EDI retention verified functioning (immutability policy live, not just configured)
- [ ] All Phase 0 open decisions (§2.1) resolved with no "TBD" remaining
- [ ] Admin Metrics Dashboard (FEATURE_9) live and showing accurate AI Quality, User Trust, Business, Platform (live), Compliance, and Cost metrics for the pilot chain — this is what the compliance review board and RxForecast leadership actually check against every other line item in this checklist, so it has to be trustworthy before it can be used to verify the rest
- [ ] FEATURE_9's full security checklist (`deployment.md` §3.1.1) passed, including the reverse cross-tenant test (chain-issued token rejected by `/api/admin/*`)

---

## 8. Risks & Dependencies Carried Into Execution

Pulled forward from `PRD.md` (External Dependencies, Internal Risks) and `lld.md` §12 — not re-derived, just kept visible here so they don't get lost in phase-level checklists.

| Risk/Dependency | Source | Status to track |
|---|---|---|
| Pilot chain's IT bandwidth for SSO federation | `engg.md` FEATURE_0 §0.1 | May force the password+MFA fallback path to stay live longer than planned |
| Azure AI Foundry Claude pricing parity (unconfirmed) | `lld.md` §4.5 | Confirm before Phase 1 budget lock |
| AS2 build-vs-buy decision | `lld.md` §12 | Blocks §3.3 if undecided |
| Entra External ID federation complexity at 250-chain scale | `lld.md` §12 | Pilot against 2–3 real IdPs before Phase 1 SSO work starts |
| External-signals gap (flu/weather/social-trend feeds) | `plan.md` §7.9 | Explicitly deferred — not in MVP/MVP1/Launch scope, revisit in Phase 4 |
| Forecast accuracy on <6mo-history SKUs | `PRD.md` Fairness section | Mitigated by confidence-banded fallback (§3.4), not solved |
| Rare-disease/specialty-pharmacy underperformance | `PRD.md` Fairness section | Explicitly out of MVP scope, disclosed not fixed |

---

*Synthesized from `plan.md`, `PRD.md`, `engg.md`, `design-system.md`, and `lld.md` — all in this same folder. This document should be updated whenever any of those four change scope; it is the execution layer, not an independent source of truth.*
