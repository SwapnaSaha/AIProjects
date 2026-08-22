# Substitution Reasoner — offline eval harness

Implements the start of `PRD.md` §8's offline evaluation strategy and `lld.md` §4.5's
Azure AI Foundry Evaluation SDK layer, against this prototype's synthetic data. Not a
replacement for either doc's full spec (a real 200-case, 5-PharmD-panel review, and a
continuous nightly-rollup production pipeline) — a runnable, honest-scale stand-in, same
trim-not-shortcut approach as the rest of this prototype (`../GAPS.md`).

## What it scores

`data/substitution_pairs.jsonl` — 70 unique (original drug, alternative drug) pairs, built
from every historical event in `substitution_events.csv` and deduped down to the distinct
pairs those events cover (see `../backend/scripts/export-eval-dataset.mjs`'s header for
why dedupe). Each pair carries a ground-truth `pharmacistAppropriateRate` and
`groundTruthLabel` derived from the synthetic `pharmacist_rated_appropriate` column.

`run_eval.py` generates a live rationale for each pair via the same Foundry-hosted Claude
deployment and system prompt `substitution.js`'s `buildRationale()` uses, then runs four
evaluators against it:

| Evaluator | What it measures | Needs a model call? |
|---|---|---|
| `te_match_baseline` | Does TE-match alone predict the historical pharmacist verdict? Sanity-checks the confidence heuristic `substitution.js` already uses (`teMatch ? 0.86 : 0.52`). | No — free, deterministic |
| `groundedness` | Is the generated rationale grounded in the facts it was given? (Foundry SDK built-in, same signal `contentSafety.js` checks live in production.) | Yes |
| `relevance` | Does the rationale actually address the substitution question? (Foundry SDK built-in.) | Yes |
| `appropriateness_agreement` | Does the rationale's tone agree with the historical pharmacist-appropriate consensus? Custom LLM-judge evaluator standing in for the PRD's 5-PharmD panel. | Yes (generation + judge = 2 calls) |

## Setup

```bash
cd app/evals
pip install -r requirements.txt
```

Needs `FOUNDRY_ENDPOINT` / `FOUNDRY_API_KEY` / `FOUNDRY_DEPLOYMENT_NAME` set in
`../backend/.env` — the same file and variable names the Node backend already uses (copy
`../backend/.env.example` if you haven't). This script reads that file directly rather
than keeping a second copy of credentials.

## Run

Regenerate the dataset if `substitution_events.csv` has changed since the last export:

```bash
cd ../backend && node scripts/export-eval-dataset.mjs && cd ../evals
```

Then:

```bash
python run_eval.py --limit 5   # cheap smoke test first — ~20 Foundry calls
python run_eval.py             # full run — up to ~280 calls across 70 pairs
```

Results: a per-row breakdown lands in `results/eval_results.json`; a metrics summary
prints to stdout.

## Known gaps vs. the production spec

- 70 pairs, not the PRD's 200 — same trim-for-demo-scale pattern as everywhere else in
  this repo (`../GAPS.md` "Data scope").
- Ground truth is a synthetic `rand()`-driven label correlated with TE match (see
  `../backend/scripts/generate.cjs`'s substitution-events block), not a real pharmacist
  panel — the harness and metrics are real, the labels they're scored against are not.
- This is a one-shot offline batch run, not the continuous/sampled production pipeline
  `lld.md` §4.5 describes (nightly rollup into `metric_snapshots`, weekly HHH_Eval
  review) — there's no scheduler, database, or dashboard wired to this yet.
- `GroundednessEvaluator`/`RelevanceEvaluator` call signatures here haven't been exercised
  against a live Foundry endpoint — verify against your installed `azure-ai-evaluation`
  version's docs if the run errors on evaluator construction or invocation.
