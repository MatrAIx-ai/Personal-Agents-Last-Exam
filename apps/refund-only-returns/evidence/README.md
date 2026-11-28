# Review evidence | Refund-only Returns
Scope: PALE [#7](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/7); revision in response to the [November 28 implementation re-review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/7#pullrequestreview-6096954492). The November 26 [original attachment](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/7#issuecomment-7181272603) is for **220fea5**, not this revision. For the current revision, use the same-commit companion capture named in the PR validation reply. Its run is `refund-browser`, viewports 1280 × 900, 768 × 900 and 390 × 844, and its `sequence.json` records the verified Chromium version and the exact result and Infra version for every numbered frame. The candidate commit and package hash are recorded in the companion capture manifest, not hardcoded into the package itself.

## Reference comparison
These are **published Loop Help Center screenshots**, not captured live shopper/customer sessions. Source: [Portal Customizations](https://help.loopreturns.com/en/articles/1910977), edited February 13, 2026; screenshot links checked November 28, 2026. No real order was entered or changed. Linked only, not redistributed as App assets.

| Portal step | Published reference | Implemented view and intended differences |
| --- | --- | --- |
| Lookup | [Order lookup screenshot](https://usw2.frontkb-cdn.com/attachments/8948122/283393/52135308-c4c9-42b4-9bf8-11b2e10a9a03.png) | Order-number field, find action and local field feedback. A bound synthetic account replaces postcode/phone/email identity verification. No gift flow. |
| Order | [Order page description](https://help.loopreturns.com/en/articles/1910977#order-page) | Item and eligibility, human-readable browser-local dates, fixed refund amount, and one preview action for this single-item order. No return reason, exchange or item selection. |
| Review | [Review screenshot](https://usw2.frontkb-cdn.com/attachments/8948122/283393/6c197169-feb2-4b62-b8ae-859788d588c4.png) | Order and item details sit beside the return summary with a prominent fixed amount and full-width Confirm action. Compact screens stack the panels. No labels, shipments, return methods, gift cards, or fees. |
| Status | [Return status screenshot](https://usw2.frontkb-cdn.com/attachments/8948122/283393/97695f6f-94e7-4061-a1b5-3fa6d8acc0d4.png) | Show the item, deadline, what happens next, recorded status, and cancellation if enabled. No money is moved, no tracking email or external notification is sent, and dispatched requests cannot be cancelled. |

## Current run
The 23 numbered screenshots per viewport are captured by [tests/browser.cjs](../tests/browser.cjs) against a real shared Web Host. Paired actual results and independent Infra `env.snapshot` version/time are in the archive's `sequence.json`.

| Frames | Action sequence | Expected and observed read-back |
| --- | --- | --- |
| 01–06 | Open lookup; malformed input; missing order; expired and excluded orders; valid # 10421 | Scoped hints, correct states, natural currency and dates in the browser zone; baseline Core business data unchanged. |
| 07–10 | Preview and discard twice, without advancing time | Each draft is separately recorded; both end discarded, with no confirmed request. |
| 11–13 | Eligible draft → Infra time advance → stale button click → refresh | Stale explanation near the action, then no confirm action for the expired draft; Core business records unchanged. The script repeats this on a fresh reset. |
| 14–19 | Confirm/cancel, then reconfirm/cancel the same order without advancing time | Each confirmation commits a distinct request, cancel preview leaves it confirmed, and cancellation commits successfully both times. |
| 20 | Confirm before expiry; advance and refresh | Confirmed status persists after cutoff; cancellation still works independently of expiry. |
| 21 | Inspect dispatched request | Accurate dispatch status; no cancellation offered. |
| 22 | Another Agent session confirms; stale browser refreshes | Browser changes from Request review to Request status with a submission time and cancellation, confirmed once in Core. |
| 23 | Reset through Infra and look up again | Baseline data and clock restored. |

Independent Agent/Infra integration tests cover exact replay, role isolation, read-only policy, stale and fresh expiry errors, the full-window dataset load and retrieval, and reset. The Web Host HTTP test separately checks state sharing and denied administrative requests. The browser uses Asia/Shanghai to prove that dates honor the browser zone. See the [validation record](../VALIDATION.md).

## Model smoke trial evidence

The [exact prior-head PR validation reply](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/7#issuecomment-7235548101) links the [actual-model smoke archive](https://github.com/user-attachments/files/35541732/PALE-PR7-model-smoke-exact-acd0675.zip) for `acd0675f69ab2778df911d544f731d420092ba1c`. It records model actions through public Agent MCP and independent state grades. That archive is evidence for the previous head. It is not a raw reasoning transcript and is not presented as a model rerun on this revision.
