# Separate exploratory calibration (2026-11-21)

This ten-event/ten-candidate extension is supplementary research, not the approved two-session task. Four history variants (W001/W006/W011/W016) of one synthetic family were selected before solver replies. Each event has separately sealed memory (M), relevance (R), and ranking (K) stages. Every stage uses fresh context, with original sources and authentic prior artifacts retrievable. All events/variants are correlated; there is no independent-user significance claim.

GPT configuration: gpt-6.2-astra, high, signed-in Codex CLI. Claude configuration: Opus 5.5 Extra, fresh incognito browser conversations. These are provider-access exploratory runs, not the official designated GPT/Claude/Gemini roster. Local CPU orchestrates and scores remote model inference; no local-GPU inference or API-key access is claimed.

## GPT

Completed 40/40 events, 4/4 worlds. Sealed M/R/K stages: {'M': 40, 'R': 40, 'K': 40}.

| Metric | Raw % | Declared random % | Relative to random % |
| --- | ---: | ---: | ---: |
| Historical memory value accuracy | 100.0000 | 42.388889 | 100.0000 |
| Per-card 0–4 grade agreement | 78.0000 | 20.000000 | 72.5000 |
| Strict-pair ranking agreement | 97.8601 | 50.000000 | 95.7202 |
| Whole-list exact (ties allowed) | 67.5000 | 0.080853 | 67.4737 |
| nDCG | 99.7339 | 67.116686 | 99.1907 |

Three-stage structured conjunction: 15.00%; this is a diagnostic, not an official pass rate. Historical values across sealed M stages: 164/164; sufficient-source-set checks verified 156, with 8 awaiting further review. All 400 per-card reasons need independent semantic review.

Cross-event checks in complete worlds: changed states 5/5; invariant states 31/31. R stages reading current M: 40/40; K stages reading current R: 40/40. Extra working-note writes: 6. Reads establish access, not causal reliance.

Transport audit: 0 future records exported, 0 sealed-receipt errors.
CLI log audit found 0 native-tool items. Four initial transport failures produced no model answers; their logs were retained.

Ranking inversions by reference grade pair: {'1>0': 22, '2>0': 3, '4>3': 7}.

## CLAUDE

Completed 31/40 events, 2/4 worlds. Sealed M/R/K stages: {'M': 31, 'R': 31, 'K': 31}.

| Metric | Raw % | Declared random % | Relative to random % |
| --- | ---: | ---: | ---: |
| Historical memory value accuracy | 100.0000 | 43.512545 | 100.0000 |
| Per-card 0–4 grade agreement | 64.5161 | 20.000000 | 55.6452 |
| Strict-pair ranking agreement | 95.7212 | 50.000000 | 91.4424 |
| Whole-list exact (ties allowed) | 41.9355 | 0.084955 | 41.8861 |
| nDCG | 99.5178 | 67.432142 | 98.5195 |

Three-stage structured conjunction: 0.00%; this is a diagnostic, not an official pass rate. Historical values across sealed M stages: 125/125; sufficient-source-set checks verified 124, with 1 awaiting further review. All 310 per-card reasons need independent semantic review.

Cross-event checks in complete worlds: changed states 3/3; invariant states 15/15. R stages reading current M: 31/31; K stages reading current R: 31/31. Extra working-note writes: 69. Reads establish access, not causal reliance.

Transport audit: 0 future records exported, 0 sealed-receipt errors.
221 browser reply copies were checked against the visible assistant body; 0 audit errors. The UI does not expose a CLI native-tool event stream. A provider concurrency limit required returning from four to two active worlds and retrying an undelivered input; no valid answer was regenerated. Clipboard/rendering mismatches were quarantined before relay.

Ranking inversions by reference grade pair: {'1>0': 27, '2>0': 13, '3>0': 1, '3>1': 3, '4>0': 2}.

## Same-event comparison

Both models completed these same 31 case/events. This subset is determined by actual coverage, not by scores. It is not the completed 40-event matrix.

| Metric | GPT raw % | Claude raw % | Matching random % | GPT relative % | Claude relative % |
| --- | ---: | ---: | ---: | ---: | ---: |
| M.historical_fact_accuracy | 100.0000 | 100.0000 | 43.512545 | 100.0000 | 100.0000 |
| R.grade_accuracy | 77.7419 | 64.5161 | 20.000000 | 72.1774 | 55.6452 |
| K.pairwise_accuracy | 97.8273 | 95.7212 | 50.000000 | 95.6546 | 91.4424 |
| K.whole_ranking_exact | 67.7419 | 41.9355 | 0.084955 | 67.7145 | 41.8861 |
| K.ndcg | 99.7155 | 99.5178 | 67.432142 | 99.1263 | 98.5195 |

Claude run status: provider_quota_blocked. The provider displayed `Usage limit reached · Resets 8:40 PM` on 2026-11-21 Pacific. Remaining events are unfinished coverage, not failures. The exact current-stage transcripts and workspaces are preserved; no credits were requested.

## Interpretation and limits

Relative improvement = 100 × (mean raw − matching mean random)/(100 − matching mean random), retaining negative values. No weighted total or invented random-prose baseline is introduced. Full-list correctness allows ties. The three-stage conjunction is not a product of independent marginal probabilities.

The same-event comparison covers 31/40 events completed by both models; uncompleted events are never imputed as failures. Always assigning grade zero is a stronger trivial grade baseline than uniform guessing (42% on the full fixed matrix versus 20%).

The results do not establish adequate difficulty. High historical accuracy and near-ceiling nDCG coexist with lower exact-grade and whole-list agreement. Some disagreements concern whether an unnecessary backup purchase deserves 0 or 2, or whether an otherwise mismatched outing still deserves 2 for pacing/rest guidance. These boundaries need independent adjudication before they can support a claim of harder reasoning. The labels remain provisional author judgments; the model cannot certify its own reasons.

On the same 40 case/events, the previous GPT ranking-only protocol achieved 80% whole-list exactness versus 67.5% under M/R/K. The protocol changed; this is descriptive, not a causal difficulty claim. Old runs receive no retrospective M/R scores.

Frozen input/runner hash changes detected: []. Reporting, UI transport and diagnostic helpers may evolve; prompts, source records, labels and the scorer were not retuned after observing these results. Official Task-adapter validation, independent labels/reason review, designated-model unhinted trials and fixed-hint validation remain outstanding. Neither a 50% target nor final acceptance is claimed.
