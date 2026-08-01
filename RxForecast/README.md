# RxForecast

Predictive EDI ordering agent for mid-market pharmacy chains — Cohort 9 AI Product Management course project.

## Docs, in reading order

1. **[plan.md](./plan.md)** — build plan, PRD analysis, architecture overview, data-point catalog
2. **[PRD.md](./PRD.md)** — the product requirements document (Problem, User, Core Metric, MVP Features, Constraints, Grounding Strategy, Hallucination Guardrails, Evaluation Strategy, Production Readiness)
3. **[engg.md](./engg.md)** — feature-level engineering spec (Product & UX / Data & Backend / Frontend & QA) for all 10 features, FEATURE_0 through FEATURE_9
4. **[design-system.md](./design-system.md)** — the RxForecast design system (tokens, components, typography)
5. **[lld.md](./lld.md)** — low-level design: Azure architecture, full database schema, agent pipeline internals, EDI integration mechanics
6. **[execution.md](./execution.md)** — phased build plan tying the above together, with a production-readiness gate checklist
7. **[deployment.md](./deployment.md)** — deployment runbook, security foundations, post-deployment monitoring

Synthetic test data (12 stores, 208 NDCs, 24 months) lives locally at `AIPMCourse/RxForecast_SyntheticData/` — not included in this repo due to size (~101MB); ask if you want it added as a separate release artifact or Git LFS asset.
