"""
Offline eval harness for the Substitution Reasoner (PRD.md Section 8, lld.md Section 4.5).

Scores every (original_ndc, alt_ndc) pair in data/substitution_pairs.jsonl (built by
../backend/scripts/export-eval-dataset.mjs from substitution_events.csv) two ways:

1. A free, deterministic baseline that needs no model call at all: does TE-match predict
   the historical pharmacist-appropriate verdict? (te_match_baseline evaluator) This is a
   sanity check on substitution.js's own confidence heuristic, which is built on the same
   signal (options.some(o => o.teMatch) ? 0.86 : 0.52).
2. Foundry-backed evaluators, generating a live rationale via the same Claude deployment
   and system prompt substitution.js's buildRationale() uses, then scoring it for:
   - groundedness / relevance (Azure AI Foundry Evaluation SDK's built-in evaluators —
     the "continuous production evaluation" layer lld.md Section 4.5 describes)
   - appropriateness_agreement (custom LLM-judge evaluator below): does the generated
     rationale's tone agree with the historical pharmacist-appropriate consensus? This
     stands in for PRD.md Section 8's 200-case, 5-PharmD-panel offline harness, using this
     prototype's synthetic ground-truth labels instead of real pharmacists.

Setup: pip install -r requirements.txt
Run:   python run_eval.py [--limit N]

Needs FOUNDRY_ENDPOINT / FOUNDRY_API_KEY / FOUNDRY_DEPLOYMENT_NAME set in
../backend/.env (same file/vars the Node backend already uses — see
../backend/.env.example) — this script loads that file directly rather than
duplicating a second credentials file.

Cost note: a full run makes up to 4 Foundry calls per pair (target generation, judge
classification, groundedness, relevance) - with 70 pairs that's up to ~280 calls. Use
--limit for a cheap smoke test first.

NOTE: the GroundednessEvaluator/RelevanceEvaluator constructor and call signatures below
match the azure-ai-evaluation SDK's documented usage at time of writing, but haven't been
exercised against a live endpoint (no Python installed in the environment this was
written in) - verify against your installed package version's own docs before trusting
the output, same disclaimer foundryClient.js/contentSafety.js carry for their own
untested request shapes.
"""

import argparse
import json
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(dotenv_path=BACKEND_ENV)

FOUNDRY_ENDPOINT = os.environ.get("FOUNDRY_ENDPOINT")
FOUNDRY_API_KEY = os.environ.get("FOUNDRY_API_KEY")
FOUNDRY_DEPLOYMENT_NAME = os.environ.get("FOUNDRY_DEPLOYMENT_NAME")
FOUNDRY_API_VERSION = os.environ.get("FOUNDRY_API_VERSION", "2024-05-01-preview")

DATA_PATH = Path(__file__).resolve().parent / "data" / "substitution_pairs.jsonl"
RESULTS_DIR = Path(__file__).resolve().parent / "results"

# Same system prompt substitution.js's buildRationale() sends to Foundry - keep these two
# in sync manually if either changes (same pattern export-seed-data.mjs uses for its own
# manually-synced minDate constant).
SYSTEM_PROMPT = (
    "You are a pharmacy formulary substitution assistant. Given structured facts about a "
    "drug shortage and one candidate alternative, write ONE concise, factual sentence "
    "explaining whether the alternative is appropriate. Cite only the facts provided - "
    "never invent an NDC, dosage, price, or regulatory detail that is not present in the "
    "facts given to you."
)


def call_foundry(system_prompt: str, user_prompt: str, max_tokens: int = 200) -> Optional[str]:
    """Mirrors foundryClient.js's callFoundryModel(): same endpoint shape, same
    fall-through-to-None-on-failure contract (never raises)."""
    import requests

    url = f"{FOUNDRY_ENDPOINT.rstrip('/')}/chat/completions?api-version={FOUNDRY_API_VERSION}"
    body = {
        "model": FOUNDRY_DEPLOYMENT_NAME,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    try:
        resp = requests.post(url, headers={"api-key": FOUNDRY_API_KEY}, json=body, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as exc:  # mirrors foundryClient.js: log and degrade, never crash the run
        print(f"[run_eval] Foundry call failed: {exc}")
        return None


def target(originalGenericName, altGenericName, teMatch, originalTeCode, altTeCode,
           contract, controlled, deaSchedule, **_):
    """The thing being evaluated - generates the same rationale text
    substitution.js's buildRationale() would produce for this pair."""
    facts = {
        "originalGenericName": originalGenericName,
        "altGenericName": altGenericName,
        "teMatch": teMatch,
        "originalTeCode": originalTeCode,
        "altTeCode": altTeCode,
        "contract": contract,
        "controlled": controlled,
        "deaSchedule": deaSchedule,
    }
    response = call_foundry(SYSTEM_PROMPT, f"Facts: {json.dumps(facts)}") or ""
    query = f"Is substituting {altGenericName} for {originalGenericName} appropriate given these facts?"
    return {"response": response, "context": json.dumps(facts), "query": query}


def te_match_baseline(*, teMatch, groundTruthLabel, **_):
    """Free, deterministic sanity check - no model call. Does TE-match alone predict the
    historical pharmacist verdict?"""
    predicted = "appropriate" if teMatch else "flagged"
    return {"te_match_baseline_correct": int(predicted == groundTruthLabel)}


class AppropriatenessAgreementEvaluator:
    """Custom LLM-judge evaluator: does the generated rationale's tone agree with the
    historical pharmacist-appropriate consensus for this pair? Standing in for PRD.md
    Section 8's 5-PharmD panel review, with a second Foundry call acting as judge."""

    def __call__(self, *, response, groundTruthLabel, **_):
        if not response:
            return {"appropriateness_agreement": None}
        judge_prompt = (
            "A pharmacy substitution rationale is given below. Classify its overall stance "
            "as exactly one word: APPROPRIATE or FLAGGED. Respond with only that one word.\n\n"
            f"Rationale: {response}"
        )
        verdict = call_foundry(
            "You are a strict classifier. Respond with exactly one word: APPROPRIATE or FLAGGED.",
            judge_prompt,
            max_tokens=5,
        )
        predicted = "appropriate" if verdict and "APPROPRIATE" in verdict.upper() else "flagged"
        return {"appropriateness_agreement": int(predicted == groundTruthLabel)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Only score the first N pairs (cheap smoke test).")
    args = parser.parse_args()

    if not (FOUNDRY_ENDPOINT and FOUNDRY_API_KEY and FOUNDRY_DEPLOYMENT_NAME):
        raise SystemExit(
            f"FOUNDRY_ENDPOINT / FOUNDRY_API_KEY / FOUNDRY_DEPLOYMENT_NAME must be set in "
            f"{BACKEND_ENV} before running evals - see backend/.env.example."
        )
    if not DATA_PATH.exists():
        raise SystemExit(
            f"{DATA_PATH} not found - run `node scripts/export-eval-dataset.mjs` from "
            f"app/backend/ first."
        )

    from azure.ai.evaluation import evaluate, GroundednessEvaluator, RelevanceEvaluator

    data_path = DATA_PATH
    if args.limit:
        lines = DATA_PATH.read_text(encoding="utf-8").splitlines()[: args.limit]
        data_path = RESULTS_DIR / "_smoke_test_data.jsonl"
        RESULTS_DIR.mkdir(exist_ok=True)
        data_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    model_config = {
        "azure_endpoint": FOUNDRY_ENDPOINT,
        "api_key": FOUNDRY_API_KEY,
        "azure_deployment": FOUNDRY_DEPLOYMENT_NAME,
        "api_version": FOUNDRY_API_VERSION,
    }

    RESULTS_DIR.mkdir(exist_ok=True)
    result = evaluate(
        data=str(data_path),
        target=target,
        evaluators={
            "te_match_baseline": te_match_baseline,
            "groundedness": GroundednessEvaluator(model_config),
            "relevance": RelevanceEvaluator(model_config),
            "appropriateness_agreement": AppropriatenessAgreementEvaluator(),
        },
        evaluator_config={
            "groundedness": {"column_mapping": {
                "response": "${target.response}", "context": "${target.context}", "query": "${target.query}",
            }},
            "relevance": {"column_mapping": {
                "response": "${target.response}", "context": "${target.context}", "query": "${target.query}",
            }},
        },
        output_path=str(RESULTS_DIR / "eval_results.json"),
    )

    metrics = result.get("metrics", {})
    print("\n=== Eval summary ===")
    for k, v in metrics.items():
        print(f"{k}: {v}")
    print(f"\nFull per-row results: {RESULTS_DIR / 'eval_results.json'}")


if __name__ == "__main__":
    main()
