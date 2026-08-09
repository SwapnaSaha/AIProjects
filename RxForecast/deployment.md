# RxForecast — Deployment, Security & Operations Guide

**Purpose:** `lld.md` describes the architecture. `execution.md` sequences the build. This document is the **operational runbook** — the actual steps to stand the system up, the security posture that has to be locked down before real chain data touches it, and what to watch once it's live. Written for whoever is on point for a deploy or an incident, not as a second architecture description.

**Scope note:** everything here assumes the full Azure migration and Azure AI Foundry integration from `lld.md`. Where a step is a genuinely new operational decision (not already specified in `PRD.md`/`engg.md`/`lld.md`), it's flagged the same way those docs flag assumptions.

---

## 1. Pre-Deployment Prerequisites

Nothing in §2 can start until every item here is checked. This is the "do you actually have what you need" gate — distinct from `execution.md` §2's Phase 0, which is about *building* the foundation; this is about *having the accounts/access* to build it.

- [ ] Azure tenant with 3 subscriptions provisioned (`dev`, `staging`, `prod`) and billing configured
- [ ] Azure AD/Entra global admin access to configure Entra External ID (or WorkOS account, per `lld.md` §12's open decision)
- [ ] Domain ownership for `rxforecast.com` (or the actual production domain) with DNS access for Azure Front Door cutover
- [ ] Microsoft BAA (HIPAA) executed — **must be signed before any real chain data is ingested**, not just before launch
- [ ] Anthropic/Azure AI Foundry access confirmed for Claude model deployments (Sonnet + Opus) in the target region
- [ ] GitHub organization with Actions enabled, branch protection configured on `main`
- [ ] Datadog and Prefect Cloud accounts provisioned, API keys generated
- [ ] Pilot chain's distributor VAN credentials (AS2 certificate/endpoint for McKesson) obtained through a signed data-sharing agreement
- [ ] Terraform Cloud/remote state backend configured (Azure Storage Account with state-locking, itself provisioned manually before any other Terraform runs — a bootstrap step that can't be part of the automated pipeline it enables)

---

## 2. Deployment Procedure

Ordered — each step depends on the one before it. This is written as the `dev` environment's first stand-up; `staging` and `prod` repeat the same sequence per environment (§2.9).

### 2.1 Infrastructure provisioning order

Terraform must apply in dependency order, not as one flat `terraform apply` — networking has to exist before anything can attach to it, data stores before compute references them, edge last since it points at compute that must already be running.

1. **Networking** (`modules/networking`): VNet, subnets (edge / Container Apps / data), NSGs, private DNS zones
2. **Data layer** (`modules/postgres`, `modules/cosmos`, `modules/storage`, `modules/keyvault`): Postgres Flexible Server (zone-redundant), Cosmos DB account, Blob Storage account + 3 containers, Key Vault — all with private endpoints into the data subnet, no public network access enabled
3. **AI layer** (`modules/ai-foundry`): Azure AI Foundry project, Claude Sonnet + Opus model deployments, Azure AI Search service + indexes (empty at this point), Azure AI Document Intelligence resource
4. **Registry** (`modules/acr`): Azure Container Registry — needed before compute since Container Apps pull images from here
5. **Compute** (`modules/container-apps`): Container Apps Environment (VNet-integrated), then the individual Container Apps/Jobs — created but not yet serving traffic (no images pushed yet)
6. **Edge** (`modules/front-door`, `modules/static-web-apps`): Azure Front Door, Static Web Apps — applied last since they route to compute that must already exist

**New decision, flagged:** Terraform is run via a GitHub Actions workflow with `plan` on every PR (posted as a PR comment for review) and `apply` gated behind manual approval on merge to `main` — not run ad hoc from a laptop. This is standard practice, not something the PRD specified, but it's the only way the "no direct human access" principle in `lld.md` §7.4 stays true for infrastructure changes, not just application data.

### 2.2 Secrets & identity provisioning

- [ ] Key Vault populated: Postgres connection details (or confirm Azure AD auth is used instead — see `lld.md` §3.3, no password needed), Entra External ID / WorkOS client credentials, distributor VAN certificates, Datadog/Prefect API keys, and a **separate read-only** Datadog API key scoped only to the metrics `GET /api/admin/platform-status` needs (`engg.md` FEATURE_9, `lld.md` §3.2.2) — not the same key used for writing logs/traces, so a leak of one can't be used to tamper with the other
- [ ] A **system-assigned Managed Identity** created per Container App — not a shared identity across services (least privilege: `edi-transmission-service`'s identity should not be able to read `agent-orchestrator`'s Foundry access, for example)
- [ ] RBAC role assignments scoped per identity: `api-service` → Key Vault Secrets User + Postgres db role; `agent-orchestrator` → Foundry access + Azure AI Search + Cosmos DB + Postgres; `edi-ingestion-service`/`edi-transmission-service` → Blob Storage (`edi-raw` container only) + Postgres + Key Vault (VAN credentials only)
- [ ] Verify no identity has subscription-level Owner/Contributor — every role assignment is resource-scoped

### 2.3 Database bootstrap

1. Connect to the newly-provisioned Postgres Flexible Server as the initial admin
2. Run the full DDL from `lld.md` §3.2 (all 17 tables) as the first Alembic migration
3. Apply the role/permission model from `lld.md` §3.3 — create `rxforecast_app`, grant, then explicitly revoke `UPDATE`/`DELETE` on `audit_log`
4. **Verify, don't trust:** attempt an `UPDATE` on `audit_log` connected as `rxforecast_app` and confirm it's rejected — this is a manual check on first bootstrap, automated in CI thereafter (`execution.md` §5.5)
5. Create the partition-management scheduled job (Container Apps Job) that pre-creates `dispense_events`/`audit_log` partitions 3 months ahead — run it once manually to create the first partitions before any data lands
6. Seed reference data: `distributors` table (McKesson/Cardinal/ABC), and the pilot chain's row in `chains`

### 2.4 Container image build & push

1. CI builds each service's image (`api-service`, `agent-orchestrator`, `edi-ingestion-service`, `edi-transmission-service`, `forecaster-worker`) — one Dockerfile per service, not a monolith image
2. Images scanned for vulnerabilities before push (Trivy or ACR's built-in scanning) — **a failed critical-vulnerability scan blocks the push**, not just a warning
3. Push to ACR, tagged with the Git SHA (never `latest` in `staging`/`prod` — every deploy is traceable to an exact commit)

### 2.5 First deploy — dev environment

1. Deploy `api-service` first (other services depend on the API being reachable for health checks, even though they don't call it directly — this establishes the pattern for revision-based traffic splitting before it matters)
2. Deploy `agent-orchestrator`, `edi-ingestion-service`, `edi-transmission-service`
3. Deploy `forecaster-worker` as a Container Apps Job (not started yet — scheduled trigger configured but first run deferred until §2.7 smoke tests pass)
4. Build and deploy the React SPA to Static Web Apps
5. Configure Azure Front Door to route to the Static Web App (frontend) and `api-service` (API)

### 2.6 DNS & edge cutover

- [ ] Front Door custom domain configured, TLS certificate provisioned (managed certificate, auto-renewing)
- [ ] DNS CNAME/ALIAS pointed at the Front Door endpoint
- [ ] WAF policy attached to Front Door **before** any public traffic is routed — never expose an endpoint through Front Door without WAF active (§3.2 has the ruleset)

### 2.7 Post-deploy smoke tests (every environment, every deploy)

- [ ] `/health` returns 200 on every Container App
- [ ] Login flow completes end-to-end (SSO or password fallback) against a test account
- [ ] `RouteGuard` correctly blocks a test buyer-role account from `/audit`
- [ ] A synthetic PO can be created, approved, and reaches `transmitted_unconfirmed` status against a VAN sandbox/test endpoint (not the real distributor in `dev`/`staging`)
- [ ] Datadog is receiving logs/traces from all services (confirm in the dashboard, don't assume)
- [ ] `forecaster-worker`'s first scheduled run completes successfully against seed/synthetic data before enabling it against real data

### 2.8 Rollback procedure

- **`api-service`**: Container Apps' revision traffic-splitting means rollback is shifting traffic back to the previous revision (0% to new, 100% to old) — should take under a minute, no redeploy needed
- **`agent-orchestrator` / EDI services**: these use drain-then-replace (mid-flight LangGraph runs must finish), so rollback means redeploying the previous image tag and waiting for the drain period — not instant, budget 5–10 minutes
- **Database migrations**: every Alembic migration must have a tested `down_revision` before it ships to `staging`; a migration without a working rollback doesn't merge — this is a PR-gate rule, not just a policy statement
- **Trigger for rollback:** any smoke test failure in §2.7 on `prod`, or a P0/P1 alert (§4.2) within 30 minutes of a deploy

### 2.9 Environment progression

| Environment | Who deploys | Approval | Data |
|---|---|---|---|
| `dev` | Any engineer, on every merge to `main` | Automatic | Synthetic dataset |
| `staging` | CI, on every merge to `main` | Automatic | Larger synthetic dataset (`execution.md` §3.9's PRD-scale re-run) |
| `prod` | CI, triggered by a tagged release | **Manual approval required** (PM + Compliance Lead per `PRD.md`'s team roster) | Real pilot chain data |

---

## 3. Security Foundations

Organized by layer. Each item is either already specified elsewhere (cited) or a new hardening decision made here (flagged). This section is the thing to review line-by-line before any real chain's data touches the system — treat it as the pre-launch security sign-off checklist, not background reading.

### 3.1 Identity & access

- [ ] MFA enforced for compliance/director/pharmacist roles; recommended (not enforced) for buyer/PIC (`engg.md` FEATURE_0 session policy)
- [ ] Session timeout: 15-min inactivity, 12-hr absolute max (`engg.md` FEATURE_0)
- [ ] **New:** rate limiting on the login/MFA endpoints — 5 failed attempts per account per 15 minutes triggers a temporary lockout + `audit_log` entry; this wasn't specified elsewhere and is a standard brute-force mitigation gap that needed closing before this could be called production-ready
- [ ] Every Managed Identity is resource-scoped, never subscription-level (§2.2)
- [ ] No shared service accounts between services — each Container App has its own identity
- [ ] Break-glass DB access uses a separate credential from normal app access, itself logged (`lld.md` §7.4)
- [ ] `enforceChainScope()`/`enforceStoreScope()` tested with an actual cross-tenant access attempt in CI, not just unit-tested in isolation (a test that logs in as Chain A's user and attempts to read Chain B's data via the API, expecting a 403/404)
- [ ] **PIC cross-store test** (added 2026-08-01, same pattern as the line above but at the store level): log in as a PIC user, attempt (a) `GET /api/queue?store_id=<other_store>` and confirm the response is silently scoped back to the PIC's own store rather than honoring the param, and (b) `POST /api/pos` / `POST /api/pos/bulk` for an NDC at another store and confirm 403 per item. The demo prototype implements and passes both checks against its in-memory `enforceStoreScope()` (`engg.md` FEATURE_0) — this line tracks re-verifying the same behavior once that logic moves to the real JWT-claims-based implementation, since a refactor is exactly where this kind of check silently regresses.

### 3.1.1 Internal Admin Dashboard (FEATURE_9) — its own, stricter checklist

The admin metrics dashboard (`engg.md` FEATURE_9, `lld.md` §3.2.1) is the highest-blast-radius surface in the system — cross-chain visibility — and gets a dedicated checklist, not just a line in §3.1:

- [ ] `admin_users` accounts provisioned **only** through RxForecast's internal Entra ID tenant — confirm zero code path allows an Entra External ID (customer-facing) token to satisfy `/api/admin/*` auth, tested the same way as the cross-tenant test above but in the other direction (attempt a chain-issued token against an admin route, expect rejection)
- [ ] MFA has no opt-out in the `admin_users` data model or application logic — verified there's no environment/feature-flag path that disables it, even for local dev convenience
- [ ] Conditional Access policy (corporate network/VPN + device compliance) enforced on the admin portal's Entra ID application registration — confirmed active, not just documented as intended
- [ ] Admin session timeout is 10 minutes idle (stricter than the customer app's 15) — confirmed configured, not left at the same default as the buyer-facing app
- [ ] Every portfolio view, filter, and chain drill-down produces an `admin_dashboard_access_log` row — verified via the same "every write path produces exactly one log row" integration-test pattern used for `audit_log` (`engg.md` FEATURE_7)
- [ ] Portfolio view's default chain-anonymization (`redactChainIdentity()`) confirmed active — a rendering test that no real chain name appears before an explicit drill-down action in the session
- [ ] `InternalOnlyBanner` renders on every page of the admin portal — a screenshot/visual-regression test, since this is a social/procedural control as much as a technical one (reduces accidental screen-sharing to a customer)
- [ ] Admin portal deployed as a genuinely separate Static Web App (`admin.rxforecast.com`), not a route behind the same auth boundary as the buyer-facing SPA

### 3.2 Network

- [ ] All data services (Postgres, Cosmos DB, Blob Storage, Key Vault, Azure AI Search) have **no public network access** — private endpoints only, into the data subnet
- [ ] Front Door WAF policy in **Prevention mode** (not just Detection) with the Microsoft-managed OWASP Top 10 ruleset enabled before go-live
- [ ] Front Door DDoS protection enabled (Azure's standard tier, given this is a public-facing production endpoint handling business-critical ordering data)
- [ ] TLS 1.2 minimum enforced everywhere (Front Door, Container Apps ingress, Postgres connections) — no TLS 1.0/1.1 fallback
- [ ] CORS on `api-service` restricted to the exact Static Web App origin — no wildcard `*`
- [ ] The de-identification connector's network path (`lld.md` §7.5) is the **only** ingress from any customer environment — verified with a network topology review before each new pilot chain onboards, not assumed to hold from the first chain

### 3.3 Data protection

- [ ] Encryption at rest on every data store (Postgres, Cosmos DB, Blob Storage) via platform-managed keys at minimum; customer-managed keys (Key Vault) if a pilot chain's compliance team requires it (`lld.md` §12 open decision)
- [ ] Encryption in transit (TLS) on every connection, including service-to-service within the VNet — not just at the edge
- [ ] Blob `edi-raw` container's immutability policy (time-based retention, locked) verified **active**, not just configured — attempt to delete a blob within the retention window and confirm it's rejected, same verify-don't-trust pattern as §2.3's DB check
- [ ] PHI boundary: confirm via a data-flow review that no field beyond `(NDC, store_id, date, quantity)` ever leaves the customer environment — this should be a documented, signed-off review per pilot chain, not a one-time architecture claim
- [ ] `audit_log` payload's PHI-redaction assertion (`engg.md` FEATURE_7) runs as an automated CI check on every deploy, not just at initial build

### 3.4 Application security

- [ ] Parameterized queries / ORM usage enforced everywhere touching Postgres — no raw string-interpolated SQL, checked via a linter rule in CI (SQL injection is otherwise a live risk given this system handles financially and clinically consequential writes)
- [ ] Input validation on every mutating API endpoint — quantity fields, NDC format, date ranges — rejecting malformed input before it reaches business logic, not relying on DB constraints as the only backstop
- [ ] `Idempotency-Key` enforcement tested against replay attempts, not just documented (`lld.md` §6)
- [ ] **Bulk-endpoint abuse limits** (added 2026-08-01, covers `POST /api/pos/bulk`): a request-body size cap (the prototype hardcodes 200 items/request) enforced server-side, plus per-user rate limiting on the bulk route specifically — an uncapped or unthrottled bulk-approve endpoint lets a compromised buyer session generate an outsized volume of real distributor purchase orders in one call, which is a materially larger blast radius than the single-PO endpoint it's built on
- [ ] Content-Security-Policy header on the React SPA restricting script sources — mitigates XSS given the access token is held in memory (per `engg.md` FEATURE_0's design) but the app itself must not be exploitable to read that memory via injected script
- [ ] Dependency scanning (Dependabot or Snyk) on every repo, with a policy that critical CVEs block merge, not just generate a notification
- [ ] Secret-scanning enabled on the GitHub org (gitleaks or GitHub's native secret scanning) — catches an accidentally-committed API key before it reaches `main`

### 3.5 Secrets management

- [ ] No secrets in environment variables baked into container images — everything pulled from Key Vault at runtime via Managed Identity
- [ ] Secret rotation schedule: distributor VAN credentials per the distributor's own policy (typically annual); Datadog/Prefect API keys every 90 days; any static credentials (should be none, given Managed Identity usage) rotated immediately if this ever becomes necessary
- [ ] Key Vault access logged and alertable — an unexpected identity reading a secret it's never accessed before is itself a signal worth an alert (§4.2)

### 3.6 Compliance controls

- [ ] HIPAA BAA executed with Microsoft (Azure) and confirmed for Anthropic's Claude access via Azure AI Foundry
- [ ] SOC 2 Type 1 achieved before Launch phase go-live; Type 2 track started immediately after (`PRD.md` §9)
- [ ] DEA/DSCSA/340B hard-block rules verified server-side-enforced via a dedicated test suite that attempts to bypass them through the API directly (not just through the UI) — this is the single most important test in the entire system given the compliance stakes, and it should be run on every deploy to `prod`, not just once
- [ ] Annual penetration test scheduled, first one completed before Launch phase go-live (`PRD.md` §9)
- [ ] 7-year retention verified on both `audit_log` (Postgres partition archival to Azure Archive tier) and `edi-raw` (Blob immutability policy) — confirmed these are two independent mechanisms, so a failure in one doesn't silently lose the other's records

### 3.7 Third-party/vendor security

- [ ] Anthropic's data-handling terms confirmed (no training on RxForecast's prompts/completions) via the Azure AI Foundry agreement, not assumed from Anthropic's general consumer terms
- [ ] Prefect Cloud and Datadog reviewed for their own SOC 2/compliance posture (both are receiving operational metadata — `chain_id`, `run_id`, timing data — never PHI, but still worth a vendor security review before go-live)
- [ ] Distributor VAN connections (AS2) use MDN-acknowledged, encrypted transport — not a bare unencrypted SFTP fallback in production, even though `lld.md` §5.1 lists SFTP as an available fallback for distributors that don't support AS2

---

## 4. Post-Deployment Monitoring

Two distinct audiences, two distinct surfaces — don't conflate them:

- **Datadog (§4.1 below)** — engineering telemetry. Who it's for: on-call, SRE, engineers debugging an incident. Answers "is the system healthy."
- **FEATURE_9, the in-product Admin Metrics Dashboard** (`engg.md` FEATURE_9, `lld.md` §3.2.1) — product/business/eval telemetry. Who it's for: RxForecast leadership, ops, and the compliance review board (`PRD.md` §9). Answers "is the product actually hitting the North Star/primary/secondary metrics and HHH gates `PRD.md` defines success by." It is **not** a Datadog dashboard, has its own isolated identity system, and its own security checklist (§3.1.1) — do not attempt to satisfy the "core metrics dashboard for admins" requirement by pointing at Datadog. Datadog access should not even be granted to most people who need FEATURE_9's view.

### 4.1 Dashboards to stand up (Datadog, day one — engineering-facing)

| Dashboard | Contents |
|---|---|
| **Service health** | p50/p95/p99 latency and error rate per Container App, replica count, autoscale events |
| **Agent pipeline** | LangGraph node duration per node type, Prefect flow success/failure rate, Foundry call latency and token usage, model-routing split (Sonnet vs. Opus %, should track the ~5% escalation target) |
| **EDI health** | Inbound/outbound transaction volume per type (846/850/855/856/860/869/997), parse failure rate, dead-letter queue depth, VAN connectivity uptime, 997-missing-within-4hrs count |
| **Business metrics (engineering mirror)** | Same underlying numbers as FEATURE_9 (forecast MAPE, buyer accept rate, substitution acceptance rate, stockout trend, PO modification rate), fed by the same nightly export job — kept here too so on-call can correlate a metric regression with a specific deploy/incident without needing admin-portal access. FEATURE_9 remains the authoritative, audited, cross-chain product view; this is a debugging convenience, not a duplicate source of truth. |
| **Security** | Failed login attempts, MFA challenges, `an-critical` hard-block trigger count (should be non-zero and expected, not an anomaly — but a sudden spike is worth investigating), cross-tenant access-attempt test results, `admin_dashboard_access_log` volume/pattern (an unusual spike in drill-downs by one admin account is itself worth a look) |
| **Cost** | Azure spend by resource group, Foundry token cost by chain, trending against the `PRD.md` Appendix B directional estimate — catches drift early rather than at month-end billing |

### 4.2 Alert thresholds

Extends `lld.md` §8's table with deployment-specific and security signals:

| Signal | Threshold | Tier (`PRD.md` §9) |
|---|---|---|
| p95 API latency | >2s sustained 5 min | P2 |
| EDI parse failure rate | >1% in 15 min | P2 |
| Forecast MAPE rolling 14-day | >20% | P2, auto-filed |
| Buyer accept rate | <65% | P2 |
| Any `an-critical` bypass attempt | Any occurrence | **P0 — page immediately** |
| Cross-tenant access-attempt test failure | Any occurrence | **P0 — page immediately** |
| Chain-issued token accepted by any `/api/admin/*` route (should be structurally impossible) | Any occurrence | **P0 — page immediately** |
| `audit_log` UPDATE/DELETE attempt succeeding (should be structurally impossible) | Any occurrence | **P0 — page immediately** |
| Blob immutability-policy violation (delete succeeding within retention) | Any occurrence | **P0 — page immediately** |
| Failed-login rate spike (possible credential-stuffing) | >20 failed logins/min across the chain | P1 |
| Missing 997 within 4 hrs of PO transmission | Any occurrence | P1, flags `transmitted_unconfirmed` |
| Key Vault secret accessed by an unrecognized identity | Any occurrence | P1 |
| Deploy → smoke test failure within 30 min | Any occurrence | Trigger rollback (§2.8) |
| Azure spend >120% of the `PRD.md` Appendix B directional estimate | Monthly check | P2, review, not page |

### 4.3 Synthetic monitoring

- [ ] Datadog Synthetics hitting `/health` on every Container App every 60 seconds from multiple regions
- [ ] A synthetic full-flow check (login → view queue → view a forecast) every 15 minutes against `prod` — catches integration breakage that individual `/health` checks miss
- [ ] Certificate-expiry monitoring on the Front Door custom domain (30-day and 7-day warnings before a managed-certificate renewal would fail, even though renewal is automatic — catch the failure mode where it doesn't)

### 4.4 On-call & escalation

- [ ] 24/7 on-call rotation during the pilot phase (per `PRD.md` §9), standard business-hours-plus-page rotation acceptable once multiple chains are live and the system has a track record
- [ ] Escalation path: P0 → immediate page → incident commander assigned within 15 min → customer notification within 1 hour (`PRD.md` §9's incident-tiering already specifies this; this is the on-call mechanics that make it actually happen)
- [ ] Public status page (`status.rxforecast.com` per `PRD.md`) kept current during any P0/P1 — this is a communication obligation, not just an engineering one

### 4.5 Ongoing operational cadence

| Cadence | Activity |
|---|---|
| Daily | Review overnight batch run success (all chains' `agent-orchestrator` flows completed) |
| Weekly | Business-metrics dashboard review (MAPE, accept rate, stockout trend) against `PRD.md` targets |
| Monthly | Cost review against Appendix B estimate; dependency/CVE scan review; secret rotation check (90-day items) |
| Quarterly | Independent pharmacist audit sample review (`PRD.md` §8 Annual Safety Review is annual, but a quarterly informal check catches drift earlier); compliance review board meeting (`PRD.md` §9 Responsible AI — Customer Compliance Officer + Pharmacist SME + Engineering Lead) |
| Annually | Full penetration test; SOC 2 Type 2 audit cycle; DR/backup restore drill (untested backups are not backups — this should be an actual restore-to-a-scratch-environment exercise, not a checklist item that just confirms backups are being taken) |

---

## 5. Appendix — One-Page Deploy Checklist

Print/copy this for an actual release:

```
[ ] PR merged to main, CI green (build, unit, integration, contract, agent eval)
[ ] Images built, vulnerability-scanned, pushed to ACR (tagged with Git SHA)
[ ] Terraform plan reviewed for staging/prod (if infra changed)
[ ] Migration has a tested down_revision (if schema changed)
[ ] Deploy to staging (automatic)
[ ] Smoke tests pass on staging (§2.7)
[ ] Manual approval obtained (PM + Compliance Lead, for prod only)
[ ] Deploy to prod
[ ] Smoke tests pass on prod (§2.7)
[ ] Dashboards show healthy signal for 30 min post-deploy
[ ] No P0/P1 alerts within 30 min post-deploy
[ ] Release notes published (customer-facing, if substitution-logic changed — PRD.md Transparency section)
```

---

*Synthesized from `lld.md` (architecture/deployment topology, §7–8), `engg.md` (FEATURE_0 session policy, FEATURE_5 EDI mechanics, FEATURE_7 audit immutability), `PRD.md` (§9 Production Readiness, Responsible AI reliability/safety section), and `execution.md` (phase sequencing). New operational decisions not previously specified elsewhere — login rate limiting, WAF prevention mode, dependency/secret scanning gates, DR restore drills — are flagged inline rather than presented as if they were already decided.*
