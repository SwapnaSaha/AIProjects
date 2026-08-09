# RxForecast Prototype — Production-Readiness Gap List

**What this is:** a working, demoable prototype of the core EDI predictive ordering loop — real computed forecasts, real priority scoring, real X12 850/855 generation, a real audit trail, running against a trimmed slice of the actual synthetic dataset. Built to show customers the product concept and get feedback, **not** to process real chain data.

**How to read this doc:** every gap below is something the full production spec (`PRD.md`, `engg.md`, `lld.md`, `deployment.md`) calls for that this build deliberately substitutes, simplifies, or skips — each one is a real, identified line of work, not an oversight. Organized by how serious the gap is to close before this could touch a real pharmacy chain's data.

---

## What's actually real in this build

Worth stating plainly, since a demo full of caveats can undersell what's genuinely working:

- **Forecasting** — real trailing-average + confidence-band computation over real (synthetic) dispense history, not canned numbers
- **Priority scoring** — real stockout-risk × velocity-tier formula, matches `engg.md` FEATURE_1's spec, deliberately excludes dollar margin as an input (same bias mitigation `PRD.md`'s Fairness section requires)
- **EDI 850/855 generation** — genuine ANSI X12 004010 envelope structure (ISA/GS/ST…SE/GE/IEA), with real control-number sequencing — this is not mocked text, it's a working X12 generator
- **Schedule II hard-block** — enforced server-side (verified: the API rejects the request, not just a hidden button)
- **Audit trail** — complete, accurate, real event chain (approve → transmit → ack → substitution → override), verified end-to-end in this build
- **Buyer override feedback loop** — accepting a substitution genuinely creates a persistent override, verified live
- **Duplicate suppression** — a queue row genuinely disappears once an open PO covers it
- **Design system fidelity** — real `an-*` tokens, real Tailwind v4 config, matches `design-system.md`
- **Bulk approve** (added 2026-08-01) — selecting multiple queue rows and approving them in one action runs every row through the exact same server-side checks as a single approval (Schedule II hard-block, store scope, 2-sigma sanity check); a mixed batch returns a real per-row result, not an all-or-nothing outcome
- **PIC store-scoping** (added 2026-08-01) — enforced server-side, not cosmetically: a PIC session's requested `store_id` is overridden on every read, and any write (create/defer/reject a PO) for another store returns a real 403, verified by calling the API directly with a foreign `store_id`, not just by hiding the UI control
- **Audit trail explainability** (added 2026-08-01) — every audit entry across all write paths now carries real `sources[]` citation content (a few system-generated event types were previously writing empty citation arrays; that gap is closed), and every entry is clickable to a detail view showing that citation content plus the linked raw EDI for PO-related entries
- **Editable qty pre-fill + save, defer resurfacing** (added 2026-08-01) — every queue row's qty field is pre-filled with the same `recommendedQtyFromForecast()` value the backend would default to, editable, and requires an explicit per-row Save before the override is used by bulk approve (unsaved edits don't silently leak into a batch); a saved override genuinely lands on the generated X12 850 (verified: `quantityFinal` in the PO1 segment matches what was typed, not the agent default). Defer is scoped per user and clears on that user's next login (not on server restart); Reject is a separate, permanent decision that survives logins — verified both ways live.
- **Rule (buyer override) detail drawer** (added 2026-08-01) — clicking a rule on the Rules page opens a real detail view: full field grid, a plain-language explanation of what that rule type does, and its actual audit history (create/reactivate/deactivate events with citations) pulled live from the audit log by a new `entity_id` filter on `GET /api/audit`. Toggling active/inactive from inside the drawer updates both the badge and the history list live — a real query-invalidation bug here (badge updated, history didn't) was caught and fixed during this build, not shipped.

---

## Gap summary

| Category | Severity | This prototype | Production spec |
|---|---|---|---|
| Authentication | 🔴 Critical | Mock role picker, no password, opaque bearer token, no expiry | SSO (Entra External ID/WorkOS) + MFA + JWT + 15-min timeout (`engg.md` FEATURE_0) |
| AI reasoning (Shortage Watcher, Substitution Reasoner) | 🔴 Critical | Rule-based templates over pre-loaded synthetic data | Claude via Azure AI Foundry, RAG over Azure AI Search (`lld.md` §4) |
| Cloud infrastructure | 🔴 Critical | Runs on a local machine, nothing provisioned | Full Azure stack — Container Apps, Postgres Flexible Server, Cosmos DB, Blob Storage, Key Vault (`lld.md` §1–3) |
| Data persistence | 🔴 Critical | In-memory, resets on restart | Postgres with partitioning, append-only role grants (`lld.md` §3.2–3.3) |
| EDI transport | 🟠 High | Simulated distributor responses on a timer | Real AS2/SFTP VAN connection (`lld.md` §5) |
| Security hardening | 🟠 High | None — open CORS, no WAF, no encryption config | Full checklist in `deployment.md` §3 |
| Observability | 🟡 Medium | Console logs only | Datadog + Azure Monitor + alerting (`deployment.md` §4) |
| Testing | 🟡 Medium | Manual E2E verification in this session | Automated unit/integration/E2E/load suite (`lld.md` §9) |
| Admin dashboard (FEATURE_9) | 🟡 Medium | Not built in this pass | Cross-chain metrics dashboard, separate identity system (`engg.md` FEATURE_9) |
| Data scope | 🟢 Low | 12 stores, 60 NDCs, 150-day window | 200 stores, 8,000 SKUs, 24 months (`PRD.md` Appendix B) |

---

## 🔴 Critical — must close before any real chain's data touches this

### Authentication & session management
- No SSO — a role picker with zero credential check. **Never point this build at real chain data as-is.**
- No MFA, no session expiry, no rate limiting on login
- Bearer token is a random string, not a real JWT with verifiable claims
- No `RouteGuard`-equivalent server-side enforcement beyond the role check already on each route (this part is real — every API route checks role — but there's no identity *behind* that role)
- **Close via:** `engg.md` FEATURE_0, `deployment.md` §3.1, `execution.md` §3.1

### AI reasoning
- Shortage Watcher doesn't poll FDA/ASHP — reads the pre-generated synthetic CSV and re-labels a handful of historical events as "active" for demo purposes (flagged in the UI itself, not hidden)
- Substitution Reasoner is template logic (generic-name matching + TE-code lookup + hardcoded rationale sentences), not Claude reasoning — confidence scores are fixed constants (0.86 / 0.52), not model self-reports
- No RAG, no Azure AI Search, no Azure AI Foundry connection at all
- **Close via:** `lld.md` §4 (LangGraph node graph), §4.5 (Foundry integration), `execution.md` §4.1

### Cloud infrastructure & persistence
- Everything runs as two local Node processes (`npm run dev` / `node server.js`) on one machine
- No Azure subscription touched — no Container Apps, no managed Postgres, no Cosmos DB, no Blob Storage, no Key Vault, no Front Door
- All application state (POs, audit log, overrides, substitution decisions) lives in a JS array in process memory — **a server restart erases everything**
- The `audit_log`'s "append-only" behavior is enforced by *nothing calling `.splice()`* — there is no database permission model behind it (explicitly commented in `state.js`)
- **Close via:** `lld.md` §1–3 (architecture + DDL), `deployment.md` §2 (deployment procedure), `execution.md` Phase 0

---

## 🟠 High — needed before a pilot chain, not needed to demo the concept

### EDI transport
- The generated X12 850/855 documents are real, but nothing sends them anywhere — the "distributor response" is a `setTimeout` in this app's own process, not a real McKesson/Cardinal system
- No AS2 or SFTP connector, no MDN acknowledgment, no real VAN
- 997 functional acknowledgment and 860 cancellation aren't implemented (both flagged as gaps in `lld.md` §5.2 even for the full spec — this prototype doesn't have them either)
- Only one distributor (McKesson) is wired into the frontend's create-PO call, though the data model supports three
- **Close via:** `lld.md` §5, §12 (AS2 build-vs-buy decision), `execution.md` §5.2

### Security hardening
- CORS is wide open (`cors()` default — any origin)
- No TLS (plain HTTP on localhost)
- No WAF, no DDoS protection, no CSP headers
- No dependency scanning, no secret scanning (no CI pipeline exists to run them in)
- No rate limiting anywhere
- **Close via:** `deployment.md` §3 (the full Security Foundations checklist — none of it is applied here)

### Multi-tenancy
- This build implicitly represents **one** chain — there's no `chain_id` scoping, no second tenant to test isolation against
- The logical multi-tenancy model `lld.md` §3.1 specifies isn't exercised at all here
- **Close via:** `lld.md` §3.1, re-introduce `chain_id` when moving to real Postgres

---

## 🟡 Medium — matters for production quality, not for a feedback demo

### Observability
- `console.log`/`console.error` only — no Datadog, no Azure Monitor, no dashboards, no alerting, no status page
- No distinction between engineering telemetry and the FEATURE_9 admin metrics view — because FEATURE_9 doesn't exist in this build
- **Close via:** `deployment.md` §4

### Testing
- No automated test suite — this build was verified manually, live, in a browser session (documented in this session's history: login, queue, forecast, shortage accept, Schedule II block, EDI generation, audit trail, dashboard all exercised end-to-end)
- No unit tests, no CI, no load testing, no agent eval harness (there's no real AI to eval yet)
- **Close via:** `lld.md` §9, `execution.md` §3.9/§4.6

### FEATURE_9 — Admin Metrics Dashboard
- Not built in this pass. No internal admin identity, no cross-chain metrics, no AI Quality/User Trust/Business/Platform panels
- Deliberately deprioritized for this round since it's an RxForecast-internal tool, not part of the customer-facing demo story
- **Close via:** `engg.md` FEATURE_9, `execution.md` §3.10/§4.8

### Known small UX bugs in this build
- The EDI status stepper polls via `setInterval`, which browsers throttle heavily on a backgrounded/non-visible tab — in a normal focused browser tab this updates live every ~1.5s; it was slow to update during this session's automated testing specifically because the tab wasn't visually composited
- Session restore across a page refresh caches the user object in `localStorage` (fixed during this build) — this is a prototype-only shortcut; production auth verifies the session server-side on every request instead
- **Defer resurfacing is scoped per demo persona, not per real individual or chain-wide** (added 2026-08-01) — `engg.md` FEATURE_1's real spec is a single shared queue where a defer resurfaces for everyone after the next nightly cycle. This prototype has no nightly job and only 5 fixed demo identities, so "next login" for that persona is the practical stand-in; a defer by "buyer" isn't visible to "director" even though a real chain-wide queue would show the same state to both. Fine for a single-reviewer demo, would need re-architecting (shared state keyed by chain, not by userId) for a multi-user pilot.

---

## 🟢 Low — scale/scope only, not a design gap

- **12 stores / 60 NDCs / 150-day window** loaded, vs. the PRD's 200-store / 8,000-SKU / 24-month production target. Same generator (`RxForecast_SyntheticData/generate.js`) can be re-parameterized to full scale — this was a deliberate trim for fast local startup, not a limitation of the approach
- Illustrative "savings" figure on the Director Dashboard uses a placeholder multiplier (15% of shipped-order value), explicitly labeled as a demo estimate, not `engg.md` FEATURE_8's real baseline-vs-current methodology (which needs historical data this fresh in-memory server doesn't have)

---

*Cross-referenced against `PRD.md`, `engg.md`, `lld.md`, `deployment.md`, and `execution.md` in the parent folder — this file lives in `app/` since it describes the prototype specifically, not the production spec.*
