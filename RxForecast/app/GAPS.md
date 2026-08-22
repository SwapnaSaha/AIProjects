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
- **Buyer override rules actually change agent behavior for 3 of 5 rule types** (wired 2026-08-19, closing what was previously a gap here) — `never_substitute` and `never_generic` genuinely change the Substitution Reasoner's output, `custom_par_level` genuinely changes the Reorder Queue's recommended quantity, and both take effect **immediately** on rule create/toggle, no server restart needed (verified live: created a rule via the API, confirmed the very next request reflected it). `preferred_distributor` and `always_secondary_source` remain unwired — see the 🟠 High item below
- **Duplicate suppression** — a queue row genuinely disappears once an open PO covers it
- **Design system fidelity** — real `an-*` tokens, real Tailwind v4 config, matches `design-system.md`
- **Bulk approve** (added 2026-08-01) — selecting multiple queue rows and approving them in one action runs every row through the exact same server-side checks as a single approval (Schedule II hard-block, store scope, 2-sigma sanity check); a mixed batch returns a real per-row result, not an all-or-nothing outcome
- **PIC store-scoping** (added 2026-08-01 for the Reorder Queue/PO routes, extended 2026-08-19 to the Shortages page) — enforced server-side, not cosmetically: a PIC session's requested `store_id` is overridden on every read, and any write (create/defer/reject a PO, or now accept/reject a substitution) for another store returns a real 403, verified by calling the API directly with a foreign `store_id`, not just by hiding the UI control. The Shortages page had **no store scoping at all** until 2026-08-19 — found by a direct question about what differs between the Buyer and PIC views (it didn't, which was the bug) — see `shortages.md` §5.6
- **Audit trail explainability** (added 2026-08-01) — every audit entry across all write paths now carries real `sources[]` citation content (a few system-generated event types were previously writing empty citation arrays; that gap is closed), and every entry is clickable to a detail view showing that citation content plus the linked raw EDI for PO-related entries
- **Editable qty pre-fill + save, defer resurfacing** (added 2026-08-01) — every queue row's qty field is pre-filled with the same `recommendedQtyFromForecast()` value the backend would default to, editable, and requires an explicit per-row Save before the override is used by bulk approve (unsaved edits don't silently leak into a batch); a saved override genuinely lands on the generated X12 850 (verified: `quantityFinal` in the PO1 segment matches what was typed, not the agent default). Defer is scoped per user and clears on that user's next login (not on server restart); Reject is a separate, permanent decision that survives logins — verified both ways live.
- **Rule (buyer override) detail drawer** (added 2026-08-01) — clicking a rule on the Rules page opens a real detail view: full field grid, a plain-language explanation of what that rule type does, and its actual audit history (create/reactivate/deactivate events with citations) pulled live from the audit log by a new `entity_id` filter on `GET /api/audit`. Toggling active/inactive from inside the drawer updates both the badge and the history list live — a real query-invalidation bug here (badge updated, history didn't) was caught and fixed during this build, not shipped.

---

## Gap summary

| Category | Severity | This prototype | Production spec |
|---|---|---|---|
| Authentication | 🔴 Critical | Mock role picker, no password, opaque bearer token, no expiry | SSO (Entra External ID/WorkOS) + MFA + JWT + 15-min timeout (`engg.md` FEATURE_0) |
| AI reasoning (Shortage Watcher, Substitution Reasoner) | 🔴 Critical | **Verified live end-to-end 2026-08-21** against a real Foundry `gpt-5` deployment (`foundryUsed: true` on every generated option, real varying rationale text, real trace IDs) — see the "AI reasoning" section below for the three bugs found and fixed getting there. Runs on template fallback whenever `FOUNDRY_*` credentials aren't set (still the default for anyone cloning this repo fresh, since `.env` is gitignored) | Claude via Azure AI Foundry, RAG over Azure AI Search (`lld.md` §4) |
| Cloud infrastructure | 🔴 Critical | Runs on a local machine, nothing provisioned | Full Azure stack — Container Apps, Postgres Flexible Server, Cosmos DB, Blob Storage, Key Vault (`lld.md` §1–3) |
| Data persistence | 🔴 Critical | In-memory, resets on restart | Postgres with partitioning, append-only role grants (`lld.md` §3.2–3.3) |
| EDI transport | 🟠 High | Simulated distributor responses on a timer | Real AS2/SFTP VAN connection (`lld.md` §5) |
| Security hardening | 🟠 High | None — open CORS, no WAF, no encryption config | Full checklist in `deployment.md` §3 |
| Observability | 🟡 Medium | Console logs only | Datadog + Azure Monitor + alerting (`deployment.md` §4) |
| Testing | 🟡 Medium | Manual E2E verification in this session | Automated unit/integration/E2E/load suite (`lld.md` §9) |
| Admin dashboard (FEATURE_9) | 🟡 Medium | Not built in this pass | Cross-chain metrics dashboard, separate identity system (`engg.md` FEATURE_9) |
| Buyer override rules — sourcing types (FEATURE_2) | 🟠 High | `preferred_distributor`/`always_secondary_source` stored/audited, but PO sourcing always uses the default distributor — see `rule.md` §5 | Rules actively shape distributor selection at PO creation (`engg.md` FEATURE_2) |
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
- Shortage Watcher: **real live openFDA polling added 2026-08-14** (`backend/src/lib/shortageFeed.js`), off by default (`SHORTAGE_FEED_ENABLED=true` to turn on). When on, it genuinely calls `api.fda.gov/drug/shortages.json` on a recurring interval and replaces the synthetic shortage list entirely — verified working live against a real, currently-active FDA shortage entry during this build. **Important finding, not just a scope caveat:** this prototype's synthetic formulary's NDCs are fictional — verified by checking a sample against openFDA's real NDC Directory, all came back not-found — so the live feed will show 0 shortages against this dataset regardless of formulary size (60 NDCs or the full 8,000-SKU target). That's the correct, honest result for this synthetic data, not a broken integration; the UI reflects this explicitly (Shortages page caption changes when live mode is active, via `GET /api/shortages/feed-status`). A real pilot chain's actual formulary (real NDCs) is what would make this feed return real results. ASHP's shortage database has a real documented API too, but production access is licensed (contact ASHP), not self-serve like FDA's — not wired up.
- When live mode is off (the default), reads the pre-generated synthetic CSV and re-labels a handful of historical events as "active" for demo purposes (flagged in the UI itself, not hidden)
- Substitution Reasoner: **real Foundry integration point added 2026-08-12, verified live end-to-end 2026-08-21** (`backend/src/lib/foundryClient.js`, `contentSafety.js`, `evals.js`) — `substitution.js` tries the Foundry-hosted deployment first, then the Content Safety groundedness gate, then falls back to the original template rationale on any failure or missing config. Both paths verified live: the fallback behaves identically to the pre-integration build when `FOUNDRY_*` is unset (2026-08-12), and the real path genuinely calls Foundry when it is set (2026-08-21, against a real `gpt-5` deployment — every generated option came back `foundryUsed: true` with real, varying rationale text and a real trace ID). Confidence scores are still fixed constants (0.86 / 0.52), not model self-reports — that's unchanged either way. **Three real bugs found and fixed getting the live path working, worth knowing if this breaks again:** (1) the backend never actually loaded `.env` at all — `package.json`'s scripts now pass `--env-file-if-exists=.env`, a pre-existing gap unrelated to Foundry specifically; (2) the Foundry portal's "Project endpoint" (the value you'd naturally copy-paste) is project-scoped and 400s on the Model Inference API — `foundryClient.js` now strips a trailing `/api/projects/<name>` suffix automatically; (3) reasoning-model deployments (e.g. `gpt-5`) spend completion-token budget on internal reasoning before any visible output, so the previous `maxTokens: 200` was consistently exhausted with empty content — raised to 1000. See `foundryClient.js`'s header comment for detail.
- No RAG, no Azure AI Search — the Foundry call above uses the same structured facts the template already had (formulary, contract, DEA schedule), not a real RAG retrieval over `formulary-kb`
- **Offline eval harness added 2026-08-22** (`app/evals/`) — scores the Substitution Reasoner's generated rationale against the ground-truth `pharmacist_rated_appropriate` labels in `substitution_events.csv` (70 unique drug pairs), using Azure AI Foundry Evaluation SDK's groundedness/relevance evaluators plus a custom appropriateness-agreement LLM judge (`PRD.md` §8's offline harness, `lld.md` §4.5's continuous-eval layer). **Smoke-tested live 2026-08-21** against a real `gpt-5` Foundry deployment — found and fixed three real bugs in the process (target-function signature validation, wrong Foundry endpoint shape, wrong token-limit param for reasoning models). `te_match_baseline` and `appropriateness_agreement` run correctly; `groundedness`/`relevance` are currently blocked by a confirmed `azure-ai-evaluation` SDK limitation with reasoning-model deployments (needs a second, non-reasoning judge model deployed — see `app/evals/README.md` "Known gaps"). The 5-row smoke test already surfaced a real signal: inconsistent bottom-line verdicts across structurally identical drug pairs.
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

### Buyer override rules — sourcing types not yet consulted (found 2026-08-19, wired 2026-08-19 for 3 of 5 types)
- **Wired and verified live:** `never_substitute` and `never_generic` are read by `substitution.js` (via the shared `overrideRules.js` lookup), and `custom_par_level` is read by `orderQty.js`. All three take effect immediately on rule create/toggle — `overrides.js` triggers a targeted recompute of the affected pending substitution records (`refreshPendingSubstitutionsForNdc`) rather than requiring a server restart, since `state.substitutions` is otherwise only built at boot / on a live-feed poll.
- **Still not wired:** `preferred_distributor` and `always_secondary_source` — these would need to change which distributor `pos.js` sources from at PO creation, a different subsystem than scoring/substitution. The synthetic data's `contract_type` values (340B/Direct/GPO/Prime Vendor) also don't map cleanly onto a "primary vs. secondary" concept yet, so this needs a small data-model decision, not just a wiring change.
- The Rules page's create-form now shows a per-type note (wired vs. not) so this isn't a silent gap for whoever's using the page.
- **Close via:** `engg.md` FEATURE_2, full detail in `rule.md` §5

---

## 🟡 Medium — matters for production quality, not for a feedback demo

### Observability
- `console.log`/`console.error` only — no Datadog, no Azure Monitor, no dashboards, no alerting, no status page
- No distinction between engineering telemetry and the FEATURE_9 admin metrics view — because FEATURE_9 doesn't exist in this build
- **Close via:** `deployment.md` §4

### Testing
- No automated test suite — this build was verified manually, live, in a browser session (documented in this session's history: login, queue, forecast, shortage accept, Schedule II block, EDI generation, audit trail, dashboard all exercised end-to-end)
- No unit tests, no CI, no load testing. An offline agent eval harness now exists (`app/evals/`, added 2026-08-22) but hasn't been run against a live Foundry endpoint yet — see the "AI reasoning" section above
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

- **12 stores / 60 NDCs / 150-day window** loaded, vs. the PRD's 200-store / 8,000-SKU / 24-month production target. Same generator (`app/backend/scripts/generate.cjs`) can be re-parameterized to full scale — this was a deliberate trim for fast local startup, not a limitation of the approach
- Illustrative "savings" figure on the Director Dashboard uses a placeholder multiplier (15% of shipped-order value), explicitly labeled as a demo estimate, not `engg.md` FEATURE_8's real baseline-vs-current methodology (which needs historical data this fresh in-memory server doesn't have)

---

*Cross-referenced against `PRD.md`, `engg.md`, `lld.md`, `deployment.md`, and `execution.md` in the parent folder — this file lives in `app/` since it describes the prototype specifically, not the production spec.*
