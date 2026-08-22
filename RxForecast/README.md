# RxForecast

Predictive EDI ordering agent for mid-market pharmacy chains — AI Product Management project.

## Working prototype

**[app/](./app/)** — a working, demoable prototype of the core ordering loop (real forecasting, real X12 850/855 generation, real audit trail with citations, bulk approve, role-scoped access) built to gather customer feedback ahead of the full production build below. Start with **[app/README.md](./app/README.md)** to run it, and **[app/GAPS.md](./app/GAPS.md)** for exactly what's real vs. simulated versus the spec in the docs below.

## Explainer for a non-engineering audience

**[manager_brief.html](./manager_brief.html)** — open in a browser. A single-page, jargon-explained walkthrough: what the app does, the data it runs on and where each source comes from, a flow chart of the full application (personas → frontend → backend → agent pipeline → wholesaler → data stores, with the feedback loops), and a stage-by-stage table of every pipeline stage's inputs/outputs and whether it's genuinely agentic or ordinary deterministic code (spoiler: only 2 of the 9 stages need a model at all — see `lld.md` §4.6 for the same breakdown in spec form).

## Docs, in reading order

1. **[plan.md](./plan.md)** — build plan, PRD analysis, architecture overview, data-point catalog
2. **[PRD.md](./PRD.md)** — the product requirements document (Problem, User, Core Metric, MVP Features, Constraints, Grounding Strategy, Hallucination Guardrails, Evaluation Strategy, Production Readiness)
3. **[HLD.md](./HLD.md)** — high-level architecture: major components, key architectural decisions, current-vs-target state, and a map of every other doc — read this before `lld.md`
4. **[engg.md](./engg.md)** — feature-level engineering spec (Product & UX / Data & Backend / Frontend & QA) for all 10 features, FEATURE_0 through FEATURE_9
5. **[design-system.md](./design-system.md)** — the RxForecast design system (tokens, components, typography)
6. **[lld.md](./lld.md)** — low-level design: Azure architecture, full database schema, agent pipeline internals, EDI integration mechanics
7. **[execution.md](./execution.md)** — phased build plan tying the above together, with a production-readiness gate checklist
8. **[deployment.md](./deployment.md)** — deployment runbook, security foundations, post-deployment monitoring

Full synthetic test data (12 stores, 208 NDCs, 24 months) lives locally at `AIPMCourse/RxForecast_SyntheticData/` — the ~101MB *output* is not included in this repo due to size; ask if you want it added as a separate release artifact or Git LFS asset. The deterministic generator that *produces* it **is** committed, at `RxForecast/app/backend/scripts/generate.cjs`, so the full dataset is reproducible from a fresh clone even though its output isn't checked in. A trimmed slice of that output (12 stores, 60 NDCs, 150 days — what the prototype actually loads) **is** committed at `RxForecast/app/backend/seed-data/` (~7MB), added 2026-08-22 specifically so `app/` can be deployed without needing the full external dataset — see `RxForecast/app/backend/scripts/export-seed-data.mjs`.
