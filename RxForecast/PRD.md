# RxForecast — Product Requirements Document

**Predictive EDI Ordering Agent for Mid-Market Pharmacy Chains**
Cohort 9 — PRD for AI Products (source: 5 weekly PRD docs, treated as one PRD)

> **Note on this version:** content is unchanged from the original 5-week PRD. It's reorganized here under the standard checklist: Problem, User, Core Metric, MVP Features, Constraints, Grounding Strategy, Hallucination Guardrails, Evaluation Strategy, Production Readiness. Two sections are **renamed** for clarity (no content lost): *Prompt Strategy + Knowledge Base* → **Grounding Strategy**; *Launch Plan + Go-live Criteria* → **Production Readiness**. One section is **new**: **Constraints**, consolidating statements that were previously scattered across Target Market, Model Requirements, and Responsible AI. Supplementary material that doesn't map to the checklist (risk register, tech stack, market sizing, full Responsible AI detail) is preserved in the Appendix rather than dropped.
>
> Build plan and execution roadmap: see `plan.md` in this same folder.

---

## 1. Problem

### What problem is this solving?

Mid-market pharmacy chains (50–300 stores) place 800–2,000+ EDI 850 purchase orders each week to drug wholesalers — primarily McKesson, Cardinal Health, and AmerisourceBergen. Today that ordering is driven by static min/max par levels inside their pharmacy management system (Enterprise Rx, McKesson Connect, PioneerRx, Rx30). The rules collapse under three predictable conditions:

1. **Demand shocks** — GLP-1 surge, flu spikes, viral OTC trends, weather events
2. **Drug shortages** — 300+ FDA-tracked active shortages requiring substitution reasoning across formulary, payer, and contract terms
3. **Controlled-substance plus expiration management edge cases**

### Job to be done (Category Buyer)

> "Get the right drugs to the right store at the right time, without stockouts, expiration write-offs, or compliance exposure — and stop forcing my buyers to spend three hours a day on manual exception triage."

### Why is this problem worth solving? (economic damage — large, recurring, quantifiable)

| Cost driver | Impact |
|---|---|
| Stockouts | 5–8% of Rx volume lost when SKUs are out of stock; $40–$120 gross profit per lost Rx — roughly $20–$50M annual stockout cost for a 200-store chain |
| Expiration write-offs | 1–2% of pharmacy inventory expires unsold; $3–$8M annual write-off per chain |
| Working capital tied up | 12–18% of total drug inventory is slow-mover overstock |
| Buyer time | 3–4 hours per buyer per day on manual exception handling (shortage reconciliation, substitution decisions, allocation negotiation) |
| FDA shortages | 300+ active in 2024–26 (Adderall, GLP-1s, sterile injectables, IV solutions); manual reconciliation against an 8,000-SKU formulary is unscalable |

### Competitive MOAT

- **vs. ChatGPT, Claude.ai, or Microsoft Copilot** — a horizontal LLM has no access to live distributor EDI 846 inventory feeds, no FDA/ASHP shortage list watcher mapped to the chain's NDC base, no DEA Schedule II ordering thresholds, no integration to Rx dispensing data, and no closed-loop learning over the PO → 855 → 856 → dispense cycle. RxForecast owns the vertical integration plane plus the pharmacy-specific reasoning corpus (Orange Book TE codes, 340B contract pharmacy rules, state-board substitution laws, DSCSA traceability) — that stack cannot be replicated by a prompt.
- **vs. McKesson Sapphire / Cardinal analytics** — those tools are catalog-locked to one distributor. RxForecast arbitrages across primary + secondary wholesalers, structurally impossible for a wholesaler-owned tool.
- **vs. Blue Yonder / IQVIA / Oracle** — horizontal supply-chain tools ignore pharmacy-specific compliance, controlled substances, and 340B; they can't safely auto-order pharmaceuticals.

### Why Agentic AI?

Rule-based and pure-ML systems already exist; they fail for three structural reasons:

1. **Inputs are semi-structured and adversarial** — FDA Drug Shortage bulletins are PDFs and press releases; ASHP updates are free text; distributor allocation notices arrive over email and EDI 869. An LLM is required to extract, normalize, and reconcile these against a formulary.
2. **Substitution requires multi-step reasoning** — a shortage on Wegovy triggers: check therapeutic equivalents (Orange Book) → check payer coverage on alternatives → check 340B contract availability → check DEA schedule constraints → check store-level history → propose substitute mix. Rules cannot enumerate the combinatorics.
3. **Novelty handling** — rules break on every new shortage, biosimilar, GLP-1, REMS program, or tariff. An agent that reasons can handle the new case without a developer in the loop.

This is not a forecasting problem alone (LightGBM can forecast) — it's an orchestration-plus-reasoning problem: forecast → check live inventory (846) → reason about shortages → reason about substitutions → choose distributor → draft 850 → monitor 855 → replan on backorder. Multi-tool, multi-step, memory-bearing — the textbook agentic shape.

---

## 2. User

### Primary persona — Category Buyer / Pharmacy Procurement Manager

At mid-market regional retail pharmacy chains (50–300 stores). Manages 8,000–15,000 active NDCs across 40+ therapeutic categories. Reports to a VP of Supply Chain or COO. Representative customer profiles: HEB Pharmacy, Wegmans Pharmacy, Discount Drug Mart, Thrifty White, Fruth Pharmacy, Hartig Drug, Tops Friendly Markets Pharmacy.

### Secondary persona — Director of Supply Chain

Economic buyer. Owns inventory KPIs, stockout rate, working-capital efficiency, expiration write-offs.

### Tertiary persona — Pharmacist-in-Charge (PIC)

At the store level. Consumes order outcomes (what arrives on the truck) and flags exceptions back to the buyer.

### Target market

~250 US mid-market pharmacy chains representing ~$60B in annual drug procurement spend. Deliberately excludes the top 5 (CVS, Walgreens, Walmart, Costco, Kroger) — they have internal data-science teams; selling to them is a 24-month enterprise grind. Independent pharmacies (<10 stores) are a later phase — different price point, lighter compliance, lighter integration.

---

## 3. Core Metric

### North Star Metric

**Net Out-of-Stock Hours per 1,000 Rx dispensed** (lower is better) — captures the joint outcome of forecast quality, shortage handling, and PO execution in a way the customer's board already tracks.

### Primary metrics

| Metric | Target |
|---|---|
| Stockout rate reduction | 20% within 90 days at pilot chain |
| Working capital reduction on managed SKUs | 15% |
| Buyer time saved | 50% reduction in manual exception handling time |
| Forecast accuracy (MAPE) | ≤15% on 7-day forecast, SKU-store level, top 200 SKUs |

### Secondary metrics

| Metric | Target |
|---|---|
| Expiration write-off reduction | 30% across managed SKUs |
| Shortage substitution acceptance rate | >70% of recommendations accepted by buyer |
| PO accuracy | >85% of generated EDI 850s accepted without modification |
| Compliance | Zero DEA/340B/DSCSA incidents per quarter |
| Buyer NPS | >40 after 90 days |

---

## 4. MVP Features

### End-to-end flow

**Input:** dispense history (NCPDP 837 aggregates, PHI-stripped), current per-store inventory, distributor EDI 846 inventory feeds (McKesson + Cardinal), open POs and 855 acks, FDA/ASHP shortage list (polled every 4 hours), contract pricing sheets (GPO, 340B ceiling, direct), buyer override history.

**Agent pipeline** (executed nightly + on-trigger), 9 components as a directed graph:

1. **Data Ingestion** — dispense feeds, store inventory, EDI 846, FDA shortage list, contract sheets
2. **Demand Forecaster** — LightGBM, 7-day SKU-store forecast with confidence interval
3. **Shortage Watcher** — LLM-extracted FDA/ASHP/distributor allocation notices, mapped to in-formulary NDCs
4. **Inventory Reconciler** — nets forecast against on-hand + in-transit, flags stockout risk
5. **Substitution Reasoner** — proposes therapeutic alternatives (Orange Book TE code), checks formulary/payer/contract availability
6. **Sourcing Optimizer** — chooses primary vs. secondary distributor by availability, contract price, lead time, allocation status
7. **PO Drafter** — generates EDI 850 message structure, queues for buyer approval (no auto-send in MVP)
8. **Exception Handler** — monitors 855 ack; on backorder or partial allocation, replans
9. **Explainability Layer** — cross-cutting; attaches source citations to every output

*(Note, added 2026-08-01: only components 3 and 5 above — Shortage Watcher and Substitution Reasoner — are genuinely agentic/LLM-based; the other 7 are deterministic code, per this section's own descriptions (LightGBM, arithmetic reconciliation, EDI templating). Full stage-by-stage "agentic vs. deterministic, and why" breakdown: `lld.md` §4.6.)*

**Output:** a ranked daily decision queue for the buyer + a transmitted EDI 850 to the chosen distributor (after buyer approval) + an audit trail.

### Required features (V1 MVP)

- Daily prioritized reorder queue, ranked by stockout risk × velocity × margin
- Shortage alert feed mapped to chain formulary with proposed substitutes
- Per-SKU forecast view with explainability panel
- One-click approve / modify / reject for PO recommendations
- EDI 850 generation for approved POs; transmission via existing VAN/clearinghouse
- Buyer override capture with persistent learning ("never substitute Synthroid at Store 047")
- Audit trail of every recommendation, override, and substitution with rationale + source
- Director-level weekly dashboard: stockout rate, working capital, expiration trend, savings to date

### User stories

- As a **Buyer**, I want a daily prioritized list of SKUs needing reorder so I can focus on what matters.
- As a **Buyer**, I want shortage alerts mapped to my formulary with proposed substitutes so I stop reading FDA bulletins manually.
- As a **Buyer**, I want to override the agent for specific SKU-store combos with persistent rules so it learns my preferences.
- As a **Director of Supply Chain**, I want a weekly dashboard showing stockout, working capital, and expiration trend so I can prove ROI to the COO.
- As a **Buyer**, I want to one-click-approve a recommended PO and transmit it via EDI 850 so I save time.
- As a **Buyer**, I want to see the Why behind every recommendation (forecast inputs, shortage source, contract used).
- As a **Pharmacist-in-Charge**, I want to flag a recommendation as wrong from the store-level dashboard so the system learns.
- As a **Compliance Officer**, I want a full audit trail of every PO suggestion, override, and substitution so we can defend in audit.

### Phased rollout (detail in `plan.md`)

| Phase | Scope |
|---|---|
| MVP (12 wks) | Data Ingestion, Demand Forecaster (top 200 SKUs), Shortage Watcher, Buyer UI + Explainability |
| MVP 1 (12 wks) | Substitution Reasoner (advisory), Sourcing Optimizer (adds Cardinal), top 2,000 SKUs |
| Launch (12 wks) | PO Drafter with EDI 850 transmission, Exception Handler, 340B-aware sourcing, expiration optimization |
| Iteration (6-mo cadence) | Controlled-substance ordering, multi-chain rollout, GPO partnerships, autonomous PO for whitelisted SKUs |

---

## 5. Constraints

*(New section — consolidated from statements previously scattered across Target Market, Model Requirements, Fairness, and Pricing.)*

**Scope constraints**
- Excludes the top-5 national chains (CVS, Walgreens, Walmart, Costco, Kroger) — internal DS teams, 24-month sales cycle
- Excludes independent pharmacies (<10 stores) — different price point, lighter compliance, later phase
- Excludes compounding/503B and specialty pharmacy (oncology, ophthalmic, biologics) — sparse training data, high patient heterogeneity, no reliable therapeutic equivalents
- Not a clinical decision tool — explicitly out-of-scope: dispensing decisions, patient counseling, prescriber recommendations
- No Schedule II auto-ordering in V1/Beta/Launch — requires DEA Form 222 / CSOS, deferred to Iteration under a separate compliance track

**Regulatory constraints**
- HIPAA — BAA executed per customer; PHI never enters the LLM context window; minimum-necessary principle
- DSCSA — drug supply-chain traceability
- DEA — controlled-substance schedules gate what can ever be auto-substituted or auto-ordered
- 340B — ceiling pricing rules; hard rule against 340B/non-340B inventory commingling
- State pharmacy board substitution law — varies by state, not federally uniform

**Technical constraints**
- Context window: 200K+ tokens required (chain formulary + shortage notices + override history + contract terms must fit in one call)
- Latency: medium priority — daily batch dominates; real-time path reserved only for shortage alerts (<30 sec target)
- No LLM fine-tuning in V1 — prompting + RAG only; fine-tuning deferred to V2 (style/functional output only, not new clinical knowledge)
- Fixed hybrid model architecture: LightGBM for forecasting, Claude for reasoning — not a single-model system

**Resource & timeline constraints**
- 6-month MVP timeline (pilot signed month 1, forecast online month 4, buyer UI in production month 6, beta month 7)
- ~$675K one-time MVP build cost (core engineering $355K + ML/PharmD/PM/Design/Compliance $320K)
- ~$8.2K/mo steady-state run cost per chain
- Fixed MVP team: 1 DevOps/Platform, 2 Backend, 1 Frontend, plus ML Eng, PharmD SME, PM, Design, Compliance lead

---

## 6. Grounding Strategy

*(Renamed from "Prompt Strategy" + "Knowledge Base" — same content.)*

### Knowledge base

**Structured, RAG-served:**
- RxNorm concept graph (~120K concepts)
- FDA NDC Directory (~150K active NDCs)
- FDA Orange Book — therapeutic equivalents (~17K entries)
- FDA Drug Shortage List (live)
- ASHP Drug Shortages bulletin archive
- GPO/340B contract pricing sheets (per customer)
- DEA controlled-substance schedules
- Distributor product catalogs (McKesson, Cardinal, ABC)
- USP <797>/<800> compounding flags (advisory)

**Unstructured:** ASHP free-text notices, FDA press releases, distributor allocation emails (parsed nightly).

### Prompt strategy

- **Structured XML-tagged input** — every agent call receives `<dispense_history>`, `<current_inventory>`, `<shortage_alerts>`, `<contract_terms>`, `<buyer_preferences>`, `<safety_constraints>` as discrete tags. Improves recall, reduces structural hallucination.
- **Chain-of-thought reasoning for substitution** — the agent must enumerate (Orange Book TE class → payer coverage → contract availability → DEA schedule → store history) before proposing. Reasoning is visible in the explainability panel.
- **Few-shot exemplars from buyer override history** — recent (last 90 days) accepted and rejected substitutions are included in the prompt context to anchor preferences.
- **RAG over formulary KB, FDA shortage list, contract sheets** — retrieved with hybrid search (BM25 + embedding) against Pinecone.
- **Structured output (JSON schema enforcement)** — every recommendation returns to a strict schema (Pydantic-validated): drug NDC, quantity, distributor, contract, rationale, confidence, sources[]. Off-schema responses trigger retry-with-correction.

---

## 7. Hallucination Guardrails

Every recommendation must cite:
- (a) the forecast inputs and confidence
- (b) the shortage source URL + timestamp
- (c) the substitute rationale (Orange Book TE code)
- (d) the contract used and pricing decision

**Additional controls:**
- Substitutions are advisory-only until pharmacist-panel signoff in Beta.
- PO generation is human-in-the-loop in MVP.
- **Constitutional / explicit safety rules** — hardcoded constraints: no Schedule II auto-substitution; no narrow-therapeutic-index swaps without flag; no expired-stock recommendation; no formulary violation; no 340B/non-340B inventory commingling.
- **Self-consistency safety pass** — every substitution proposal runs through a second LLM pass (with a safety-only system prompt) before reaching the buyer. Discrepancies escalate to pharmacist review.
- **Structured output enforcement** — strict JSON schema (Pydantic-validated); off-schema responses trigger retry-with-correction, not silent pass-through.
- **Groundedness detection (added 2026-08-12)** — every substitution rationale is scored by Azure AI Content Safety's groundedness API against its actual retrieved grounding documents (TE code, contract record, DEA schedule) before the self-consistency pass; a below-threshold score routes to pharmacist review, same as any other discrepancy. Aimed specifically at the case the other controls don't cover: a fabricated NDC, dosage, or price embedded in an otherwise well-formed, schema-valid rationale. Detail: `lld.md` §4.5.

---

## 8. Evaluation Strategy

### Ground truth setup

Pilot chain provides 24 months of historical dispense data (NCPDP 837), PO history (EDI 850), 855 acks, 856 ASNs, recorded stockout events, and expiration write-offs. The demand forecaster is back-tested against actuals week-over-week with a 6-month holdout. A 200-case substitution evaluation set is built from historical shortage events, with documented buyer decisions, validated by a 5-PharmD pharmacist panel.

### Offline evals

- **Forecast** — MAPE, MAE, sMAPE at SKU-store-day level
- **Substitution** — pharmacist-rated appropriateness on 200 sampled cases
- **Sourcing** — cost-optimal vs. chosen-distributor delta
- **PO accuracy** — line-item match vs. buyer-edited final

### Online evals

Live A/B test in beta: 50% of stores see agent recommendations, 50% remain on baseline par levels. Compare stockout rate, working capital, expiration write-offs over 90 days. Statistical power calibrated to detect a 15% relative lift on stockout rate at p<0.05.

### Monitoring

Live dashboard tracking forecast drift (rolling 14-day MAPE), buyer accept rate, override patterns, substitution outcomes, PO accuracy. Drift triggers retraining. Substitution acceptance below 65% triggers a model review. Any clinically flagged substitution triggers a P1 incident.

### Continuous production evaluation (added 2026-08-12)

The offline evals and 200-case pharmacist panel above remain the system of record for whether the model is *good* — that judgment is domain-specific and stays a custom harness. Azure AI Foundry's Evaluation SDK adds a layer those offline runs can't: continuous groundedness/relevance scoring on a sample of live Substitution Reasoner and Shortage Watcher calls, not a periodic batch. Scores roll up nightly into the AI Quality metric category (`engg.md` FEATURE_9); a below-threshold single call is logged into the weekly HHH_Eval review rather than triggering any runtime action on its own — that gating already happens via the groundedness detection control in §7. Detail: `lld.md` §4.5.

### Annual safety review

Independent pharmacist audit (n=500 cases) of substitution recommendations. Results published in a customer-facing system card.

### HHH launch criteria

Evaluations are organized around Anthropic's HHH framework (Helpful, Honest, Harmless) with launch-stage gates.

| Launch stage | Helpful | Honest | Harmless |
|---|---|---|---|
| **Measurement launch** (1–2%) | Forecast MAPE ≤20% on top 200 SKUs; recommendations generated daily for 1 pilot store in shadow mode (no buyer action) | 100% of recommendations include source citation; zero hallucinated drug names/NDCs/dosages in 2-week shadow run | Zero autonomous actions; all output read-only; no PO transmission; no PHI in LLM context |
| **Beta launch** (2–10%) | Stockout rate reduced ≥10% vs. baseline; buyer accept rate >70%; explainability rated ≥4/5 by buyers | <1% incorrect source citations; substitutions grounded in Orange Book TE codes with link-out | <0.5% substitutions flagged clinically inappropriate; zero DEA/340B/DSCSA compliance events |
| **Launch** | 20% stockout reduction; 15% working-capital reduction; NSM materially moved; buyer NPS >40 | <0.1% citation errors; full audit trail covers 100% of generated POs; explainability passes regulator-grade review | Zero DEA/340B compliance events; zero unsafe substitutions in production |

Full evaluation spreadsheet (forecast cases, substitution scenarios, sourcing trade-offs, adversarial prompts, refusal patterns) maintained in a linked HHH_Eval workbook, reviewed weekly during development.

---

## 9. Production Readiness

*(Renamed from "Launch Plan" + "Go-live Decision Criteria" — same content, plus the Reliability/Safety recovery tiers.)*

*(Note, added 2026-08-01: a working prototype covering the buyer/director/PIC/compliance/pharmacist flows below — including bulk approve and a citation-backed audit detail view — exists at `app/` for customer-feedback demos ahead of the launch plan below. It is not itself a production-readiness milestone; see `app/GAPS.md` for exactly what's simulated versus real.)*

### Launch plan

1. **Measurement launch** — 1 store, 2 weeks, shadow mode. Agent generates recommendations; buyer does not act on them. Validates forecast accuracy and source-citation rate.
2. **Beta launch** — 10–20 stores at pilot chain, 90 days. Buyers see and act on recommendations. Tracks stockout, working capital, accept rate, substitution safety.
3. **Launch** — 60+ stores at pilot chain, 6 months. All buyers using the agent for top 2,000 SKUs. Substitution moves from advisory to recommended-with-1-click-accept.

### Go-live decision criteria (must all be true)

- Forecast MAPE ≤15% on top 200 SKUs at pilot chain
- Pharmacist panel approves substitution safety profile (>95% appropriate)
- Buyer accept rate >70% across two consecutive 30-day windows
- Zero P0 (compliance) and zero P1 (clinical safety) incidents during beta
- Infrastructure: SOC 2 Type 1 in hand, HIPAA BAA executed, penetration test passed
- Customer sign-off: pilot chain VP of Supply Chain explicitly approves the launch ROI case

### Reliability & safety — acceptable error rates

| Surface | Acceptable | Triggers review/incident |
|---|---|---|
| Forecast | MAPE ≤15% on top-200 SKUs | MAPE >25% triggers retraining |
| Substitution | — | ≥2% false-positive (clinically inappropriate) is incident-level; zero tolerance for Schedule II auto-sub or DSCSA violation |
| PO | ≤5% modification rate | >15% modification rate triggers a model review |
| Recovery | Rollback to par-level baseline is one buyer click | — |

### Incident recovery tiers

- **Tier 1 (degraded forecast):** automatic fallback to existing par levels; UI surfaces a banner; buyer continues manual ordering.
- **Tier 2 (substitution error):** pull substitution recommendations from UI within 15 minutes of detection; pharmacist panel review; postmortem within 7 days.
- **Tier 3 (incorrect PO transmitted):** EDI 860 cancellation immediately; customer notified; root-cause review with the customer's compliance team; SRE on-call 24/7 during pilot.

### Time to market

Medium — 6 months to MVP at pilot chain. Pilot signed by month 1; integration + data ingest by month 3; forecast online by month 4; buyer UI in production by month 6; beta launch month 7.

---

## Appendix A — Component Risk Register

| Component | Risk | Mitigation |
|---|---|---|
| Data Ingestion (EDI 846, dispense, shortage list) | Low | Mature EDI/HL7 tooling; 24-hr cache + graceful degradation on feed outage |
| Demand Forecaster | Medium | Sparse-SKU risk (<6mo history); confidence-banded output, fallback to par levels, monthly retraining |
| Shortage Watcher | Medium | Dual-source extraction (FDA + ASHP cross-check); human SME review of new shortage sources for 1 cycle |
| Substitution Reasoner | **High** | Orange Book grounding, pharmacist panel sign-off in Beta, advisory-only in MVP, zero auto-sub on Schedule II/REMS/narrow-TI drugs |
| Sourcing Optimizer | Medium | Contract schema versioning; weekly reconciliation against distributor invoices |
| PO Drafter (EDI 850) | Medium-Low | Human approval gate in MVP; 2-sigma sanity check vs. trailing 30-day order history |
| Exception Handler (855/856) | Medium | Deterministic state machine; bounded LLM context (impacted SKU + alternatives only) |
| Explainability Layer | Low build risk / High consequence if missing | Treated as a P0 feature — absence is a dealbreaker for buyer trust and audit |

---

## Appendix B — Technology Stack & Costs

### Model requirements

| Criteria | Requirement | Rationale |
|---|---|---|
| Open vs. closed source | Hybrid — closed for reasoning, open for forecasting | Claude for reasoning (safety track record); open-source LightGBM for forecasting (cheap, controllable) |
| Context window | 200K+ tokens | Full chain formulary + shortage notices + override history + contract terms in one call |
| Modalities | Text primary, vision optional | Vision parses PDF shortage bulletins when text extraction fails |
| Fine-tuning | Not required V1; required V2 | V1 prompting+RAG for faster iteration/compliance review; V2 fine-tunes on buyer override style |
| Latency | Medium priority | Daily batch dominates; real-time only for shortage alerts (<30s) |
| Accuracy | Critical/high priority | >95% substitution appropriateness, >85% PO line accuracy — hallucinations unacceptable |
| Parameters | N/A (managed) LLM; ~1M forecaster | Claude API-served; LightGBM ensemble ~1M effective parameters |

### Tech stack

| Layer | Choice | Trade-off accepted |
|---|---|---|
| Orchestration framework | LangGraph + LangChain | More boilerplate than AutoGen/CrewAI; ties to LangChain abstractions |
| LLM inference | Claude Sonnet (95% of traffic) + Opus (5% escalation), **served via Azure AI Foundry's model catalog** (updated 2026-07-31 — full Azure migration, see `lld.md` §1/§4.5) | ~30% higher per-token cost than GPT-4o-mini; vendor concentration (mitigated by model-routing abstraction); Foundry may carry a small platform premium over calling Anthropic directly — unconfirmed, see Operational Costs note below |
| Libraries | LightGBM, Pandas/Polars, Pydantic, edi-x12, FHIR/HL7 SDK, Prefect | Operational burden of self-hosted OSS vs. managed |
| UI | React + TypeScript + Tailwind | Higher build cost than Retool/no-code |
| Vector DB | **Azure AI Search** (updated 2026-07-31, was Pinecone — single-vendor consistency now that hosting is Azure; `lld.md` §1) | Per-index pricing vs. Pinecone's namespace model; still supports the hybrid vector+keyword search the original Pinecone choice was made for |
| Hosting | **Azure (Container Apps + Container Registry + Front Door)** (updated 2026-07-31, was AWS ECS Fargate/ECR/CodeCommit; `lld.md` §7.6 has the full service-mapping table) | Azure lock-in for ingress/identity instead of AWS; migration was a deliberate choice, not a default |
| Dev tooling | Cursor + Claude Code | Per-seat licensing cost |

### Development costs (one-time, 6-month MVP)

| Role | Cost |
|---|---|
| DevOps/Platform Engineer | $90K |
| Frontend Engineer | $85K |
| Backend Engineer × 2 | $180K |
| **Core subtotal** | **$355K** |
| ML Engineer + PharmD SME + PM + Designer + Compliance Lead | $320K |
| **Grand total** | **~$675K** |

### Operational costs (steady state, per chain per month)

> **Updated 2026-07-31 — re-priced for the full Azure migration.** The original column (below) priced AWS; it's kept for traceability, not deleted. The Azure column is a **directional engineering estimate**, not a verified quote — final numbers need confirmation against the Azure Pricing Calculator at build time, especially the Claude/Foundry line (Azure AI Foundry's pricing for partner-catalog models like Claude may match Anthropic's direct rates or carry a small platform premium; unconfirmed either way). Full service-mapping rationale is in `lld.md` §7.6.

| Item | Originally (AWS) | Now (Azure) | Azure directional estimate |
|---|---|---|---|
| Claude Sonnet input | ~$1,800/mo (Anthropic API direct) | Azure AI Foundry model catalog | ~$1,800–2,100/mo |
| Claude Sonnet output + Opus escalation | ~$2,700/mo | Azure AI Foundry model catalog | ~$2,700–3,100/mo |
| PDF bulletin OCR (shortage parsing) | ~$200/mo (Google Cloud Vision) | Azure AI Document Intelligence | ~$150–250/mo |
| App hosting | ~$400/mo (ECS Fargate + ALB) | Container Apps + Azure Front Door | ~$350–500/mo |
| Agent-run checkpoint store | ~$50/mo (DynamoDB) | Cosmos DB (NoSQL API, serverless) | ~$40–75/mo |
| Document/artifact storage | ~$150/mo (S3, 50TB tier) | Blob Storage (Hot tier + immutability policy) | ~$130–180/mo |
| Vector search (formulary + shortage KB) | ~$200/mo (Pinecone) | Azure AI Search (Basic tier, per-chain index) | ~$75–250/mo |
| Prefect Cloud | ~$200/mo | Unchanged — cloud-agnostic SaaS | ~$200/mo |
| Datadog | ~$400/mo | Unchanged — cloud-agnostic SaaS | ~$400/mo |
| Container registry, source control, CDN/DNS | ~$65/mo (Docker Hub, GitHub, DNS/CDN) | Container Registry + GitHub + Front Door base + Static Web Apps | ~$70–110/mo |
| SSO (not separately costed originally) | — | Microsoft Entra External ID | ~$0–50/mo (pilot-scale MAU likely within the free tier) |
| Content Safety + Evaluation SDK (added 2026-08-12) | — | Azure AI Content Safety + Foundry Evaluation SDK | **Not yet priced** — new addition, not folded into the subtotal below; needs a real number once Evaluation SDK sampling rate (`lld.md` §12.9) is set |
| **Infra subtotal** | **~$6,200/mo** | | **~$5,900–7,000/mo** (excludes the unpriced Content Safety/Evaluation SDK line above) |
| Customer Success + model maintenance (allocated) | ~$2,000/mo | Unchanged | ~$2,000/mo |
| **Total run cost per chain** | **~$8,200/mo** | | **~$7,900–9,000/mo** |

### Cost/accuracy trade-offs made

- LightGBM (14% MAPE) chosen over deep transformer/TFT (12% MAPE) — saves ~$40K/yr per chain, keeps model auditable for compliance.
- Claude Sonnet (91% pharmacist-rated appropriate) as default, escalating to Opus (96%) only on complex multi-criteria substitutions (~5% of cases) — ~1/5 the cost of Opus-everywhere.
- 200K context + RAG chosen over a fine-tuned smaller model — faster iteration, easier compliance review, ~30% higher per-call cost, no fine-tune lifecycle to manage in V1.

---

## Appendix C — Market Sizing & Pricing

### Market size

- **TAM** (US retail + pharmacy supply chain software): ~$4.2B annually
- **SAM** (mid-market US pharmacy chains, 50–500 stores, ~250 chains): ~$900M addressable software spend/year
- **SOM** (year 1–3, 8% of SAM via direct sales + GPO partnerships): ~$70M ARR by year 3
- Adjacent expansion: hospital pharmacy SAM ~$1.8B, independent pharmacy SAM ~$600M, long-term-care pharmacy ~$300M (combined ~$2.7B)

### Revenue scenarios (3-year, mid-market wedge only)

| Scenario | Pilots Y1 | Chains Y3 | ARR Y3 | Valuation |
|---|---|---|---|---|
| Conservative | 4 | 30 | ~$9M | $90M @ 10x |
| Base | 8 | 60 | ~$18M | $216M @ 12x |
| Aggressive | 15 | 100 + GPO deal | ~$35M | $525M @ 15x |

### Pricing model — chosen

**Per-store SaaS subscription**, sliding scale by chain size:

| Chain size | Price | Chain MRR |
|---|---|---|
| 50–100 stores | $400/store/mo | $20K–$40K |
| 100–200 stores | $350/store/mo | $35K–$70K |
| 200–500 stores | $300/store/mo | $60K–$150K |
| Enterprise (>500 stores) | Negotiated | Typically $1.5M–$2.5M ACV |

Plus a **$50K one-time implementation fee** (waived for early design-partner customers). Gross margin at steady state: ~72% on a 150-store chain ($52.5K MRR vs. $8.2K opex).

*Rejected models:* gain-share (buyers don't trust the baseline, 3–6mo legal cycle); per-PO transaction fee (misaligns incentives — we want more good recommendations, not fewer).

---

## Appendix D — Responsible AI (supplementary detail)

*(Constraints derived from this material are pulled forward into Section 5. Full detail kept here for reference.)*

### Accountability

- **Efficacy:** 14% MAPE on top-200 SKU forecast; >95% appropriate substitution recommendations (pharmacist-rated); 20% target stockout reduction.
- **Human oversight:** buyer-in-the-loop required for all POs in MVP and Beta. PIC can flag any recommendation. No autonomous transmission until Launch — and even then, only for whitelisted low-risk SKUs (non-controlled, >6 months history, within 2-sigma quantity band, primary distributor in stock). Quarterly compliance review board (Customer Compliance Officer + RxForecast Pharmacist SME + Engineering Lead).

### Transparency

- **Direct use case:** procurement decision support (forecast + sourcing + shortage substitution recommendations).
- **Indirect use cases:** inventory analytics, supplier performance benchmarking, expiration management, buyer time-savings reporting.
- **Disclosure:** system card on launch (refreshed each major version) — model versions, training-data classes, known failure modes, scope-of-use restrictions, audit results. Customer-facing release notes for every substitution-logic change.

### Fairness

- **Underrepresented groups:** rare-disease/orphan drugs (sparse training data, long replenishment cycles, few therapeutic equivalents); specialty pharmacy — oncology, ophthalmic, biologics (heterogeneous patient mix, complex storage).
- **Mitigation:** confidence-banded output with a hard threshold below which the system defers to par levels; explicit "insufficient data" label; V2 data-collection plan for bespoke specialty-pharmacy models.
- **Feedback loop:** SKUs with >40% buyer-override rate trigger model review; low-accept-rate SKU categories trigger quarterly investigation; pharmacist panel reviews edge cases; PIC store-level flagging; weekly QA dashboard.

### Reliability & safety — data-quality mitigations

- **Bad data in:** input validation (NDC checksum, quantity sanity check, last-7-day variance check); recommendations >2 sigma from historical require explicit buyer confirmation; nightly data-quality dashboard.
- **Bad data out:** buyer approval gate; sanity bounds on quantities; distributor allocation cross-check before transmission.
- **Monitoring:** real-time tracking of forecast drift, substitution accept rate, recommendation latency, citation grounding rate, prompt-injection signals. Daily anomaly detection. Public status page. Customer-specific incident notification within 1 hour of P0/P1. Quarterly transparency report.

---

*Reorganized from `PRD_ForecastRx.docx` (Week 1), `Week2_PRD.docx` (Week 2), `RxForecast_Week3_PRD.docx` (Week 3), `PRD_Week4_RxForecast.docx` (Week 4), and `PRD_Week5_RxForecast.docx` (Week 5) — Cohort 9, PRD for AI Products.*
