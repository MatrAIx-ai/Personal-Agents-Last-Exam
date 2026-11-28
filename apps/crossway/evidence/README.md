# Crossway delivery evidence

Evidence index for the Crossway App (PR #27) under `docs/submission-evidence.md` (merged 2026-11-25, #260): reference and implementation screenshots, ordered workflow sequences, the Mail dependency and the dataset coverage report. Approval baseline: `proposals/environment/crossway.md` at `3e54ef52`. Everything here is review evidence, not a runtime asset; the App never loads it.

| Item | Where |
| :--- | :--- |
| Implementation screenshots (33) and their manifest | [`screens/`](screens/), [`screens/manifest.json`](screens/manifest.json) |
| Reference screenshots (14), sources, notice | [`reference/`](reference/), [`reference/sources.json`](reference/sources.json), [`reference/NOTICE.md`](reference/NOTICE.md) |
| Mail dependency run | [`publish-to-mail.json`](publish-to-mail.json) |
| Dataset coverage | [`coverage.md`](coverage.md), [`coverage.json`](coverage.json), [`coverage-loading.json`](coverage-loading.json) |

## Versions and how the screenshots were made

- **App:** code commit `962bdff059e18b830b7e92da19ff4b3ad69f71af` (app version 0.3.0), working tree clean for `apps/crossway` outside `evidence/` (`app_tree_clean: true` in the manifest). Page controller SHA-256 `82cb9846ce29e4cef5f652d1e2c9d0da39d95dbc29cbbc8194f8b2eefec74c88`.
- **Host:** the public business Web Host `runtime/web/server.cjs` (blob `bf8c174224f8549a894b25bf7722059572b761c5`), public runtime 1.6.0, Core API 1.2.0, started by the test with `web-registry.json`, run id `web`, profile `sandbox`, then `browse` and `scenario` for the profile steps.
- **Browser:** Chromium 141.0.7390.37 through Playwright 1.56.1, headless, viewport 1280x800 (one step at 390x844). Node v24.10.0.
- **Data:** synthetic seed `dani` (`fixtures/minimal.json`) at its clock, 2026-11-02 9:00 AM EST, for every workflow sequence; then `marisol`, `theo` and `priya` at their clocks.
- **Reproduce:** from the repository root, `npm ci && npx playwright install chromium`, then `node apps/crossway/tests/web-checks.cjs --evidence` (59 checks; it writes the 33 PNGs and `manifest.json`), then `python3 -I apps/crossway/evidence/compress-screens.py` (128-colour palette PNG, 2,951,252 to 1,068,594 bytes). The screenshots are taken by the same test steps that assert the state, so every image below is an observed state, not a mock-up. Each shot's caption, seed, page and record IDs are in the manifest.
- **Shot frame:** the main column at 1280x800 (the sidebar only names the page, which the heading also shows), scrolled to the element the step is about.

## Delivery evidence index

Business and MCP tests are listed separately from the GUI. "Test" links point at the step in `tests/web-checks.cjs` that performs the action and asserts the result.

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Top-up (workflow 1) | Required; App 0.3.0 at `962bdff`, runtime 1.6.0 | [ezpass-faq-replenish](reference/ezpass-faq-replenish.png), [ezpass-home-rebill-alert](reference/ezpass-home-rebill-alert.png) | [Top-up](#top-up): start, `card_expired`, preview, Cancel, lost response, retry | `tests/business.test.cjs`; `tests/permission-checks.cjs` (`account.topup.confirm` under browse/full); [web-checks L189](../tests/web-checks.cjs#L189) | Receipt `rc-0041`, one charge after the lost response; Mail `receipt` notice in the [unknown-ack run](#mail-dependency) | N/A (no Task history) | Passed |
| Auto-replenish change (workflow 1) | Required | same as top-up | [Auto-replenish](#auto-replenish-change): start, save, `amount_out_of_range` with the old receipt cleared | `tests/business.test.cjs`; `permission-checks` (`account.replenish.set`); [L239](../tests/web-checks.cjs#L239) | Stored rule: on, $40.00 below $15.00, `card-dani-visa` | N/A | Passed |
| End possession (workflow 2) | Required | [ezpass-faq-plates](reference/ezpass-faq-plates.png), [ezpass-faq-update-account](reference/ezpass-faq-update-account.png) | [End possession](#end-possession): start, `end_in_future`, confirmation, result | `tests/business.test.cjs`; `permission-checks` (`vehicles.end`, `vehicles.update`); [L257](../tests/web-checks.cjs#L257) | `v-0002` ended, `possession_end` 2026-09-28, `tp-0002` unassigned | N/A | Passed |
| Transponder assignment (workflow 2) | Required | [ezpass-faq-tags](reference/ezpass-faq-tags.png), [ezpass-account-types](reference/ezpass-account-types.png) | [Transponder](#transponder-assignment): occupied vehicle, choose, result | `tests/business.test.cjs` (`transponder_in_use`, class change); `permission-checks`; [L285](../tests/web-checks.cjs#L285) | `tp-0001` on `v-0004`, class 1 | N/A | Passed |
| Batch payment (workflow 4) | Required | [tbm-pay-toll](reference/tbm-pay-toll.png), [tbm-ways-to-pay](reference/tbm-ways-to-pay.png), [tbm-faq-pay-toll-bill](reference/tbm-faq-pay-toll-bill.png), [ezpass-faq-pay-violation](reference/ezpass-faq-pay-violation.png) | [Payment](#batch-payment): start, `in_collections`, `stale_version`, preview, receipt; reload and MCP read | `tests/business.test.cjs` (`amount_changed`, every ineligible state); `permission-checks` (`notices.pay.confirm`); [L340](../tests/web-checks.cjs#L340) | Receipt `rc-0044`, $42.75 for `n-0014`, `n-0016` on `card-dani-visa`; independent `notices.get` sees `paid` | N/A | Passed |
| Dispute file and withdraw (workflow 5) | Required | [tbm-faq-dispute-violation](reference/tbm-faq-dispute-violation.png), [tbm-faq-not-my-vehicle](reference/tbm-faq-not-my-vehicle.png), [ezpass-faq-dispute-violation](reference/ezpass-faq-dispute-violation.png) | [Dispute](#dispute-file-and-withdraw): form, preview, submitted, withdraw confirmation, withdrawn | `tests/business.test.cjs` (every dispute error and outcome); `permission-checks` (`disputes.confirm`, `disputes.withdraw`); [L301](../tests/web-checks.cjs#L301) | `dp-0003` submitted on `n-0017` with evidence `mail/mail-dani/m-11133`; `dp-0004` withdrawn, `n-0018` issued again | N/A | Passed |
| Toll activity, notices, statements (workflow 3, reads) | Required, read-only | [tbm-pay-toll](reference/tbm-pay-toll.png) (lookup entry) | Every row checked against the tools for all seeds; [narrow-01](screens/narrow-01.png), [seed-priya-02](screens/seed-priya-02.png) | `tests/business.test.cjs`; `tests/hidden-values.cjs` | Refresh shows a toll posted by a scenario event (`t-0912`) | [coverage.md](coverage.md) | Passed |
| Rates and policies | Required, read-only | [mta-tolls-archive](reference/mta-tolls-archive.png) (archive capture, see below) | [policies-01](screens/policies-01.png) | `tests/business.test.cjs` (policy text) | N/A | N/A | Passed; reference is an archive copy |
| Permission profiles and business-only access | Required | N/A (no reference equivalent) | [profiles-01](screens/profiles-01.png); browse hides confirms, ends, corrections, withdraw; scenario hides every write | `tests/permission-checks.cjs` (16 checks); `tests/platform-checks.cjs` | `env.snapshot` from the page session returns 403 | N/A | Passed |
| Notices to Mail (Messaging) | Delivered optional connection; Mail 1.3.0, runtime 1.6.0 | N/A | [Mail dependency](#mail-dependency) | `examples/publish-to-mail.cjs` (real Messaging and Mail over MCP) | Rejected, committed and read back, duplicate, unknown reconciled, one run per seed with every cited message read | N/A | Passed; recipient confirmation N/A |
| Dataset coverage 2025-01-01..2026-12-31 | Required (section 3) | N/A | N/A | `tests/coverage.test.cjs`; `scripts/coverage-report.cjs --loading` | 4 seeds, SHA-256 per seed | [coverage.md](coverage.md): 1,473 records, 436 distinct dates, all 24 months | Passed; human read-through pending |
| Independent reproduction, check (g) | Planned M3 | N/A | N/A | N/A | N/A | N/A | Not run yet: in progress with a second person |

## Reference comparison

E-ZPass NY and Tolls by Mail NY share one public site (`tollsbymailny.com` redirects to `www.e-zpassny.com`). Their account screens (vehicles, tags, replenishment settings, violation lists, dispute forms) are behind sign-in, which is off limits, so the public references are the pay-a-bill entry page, the ways-to-pay page, FAQ answers that describe each workflow, the account-types page and a home-page alert. All were captured on 2026-11-28 (UTC) with headless Chromium at 1280x800, without sign-in, form input or personal data; per-file URLs and timestamps are in [`reference/sources.json`](reference/sources.json). The images belong to their owners ([`reference/NOTICE.md`](reference/NOTICE.md)).

| Workflow | Reference (source, capture date) | What it shows | Crossway | Intentional differences |
| --- | --- | --- | --- | --- |
| Pay a notice | [tbm-pay-toll](reference/tbm-pay-toll.png): https://www.e-zpassny.com/tbm/pay-toll, 2026-11-28; [tbm-ways-to-pay](reference/tbm-ways-to-pay.png); [tbm-faq-pay-toll-bill](reference/tbm-faq-pay-toll-bill.png); [ezpass-faq-pay-violation](reference/ezpass-faq-pay-violation.png) | Look up a bill by number or plate, then pay; payment channels; violation payment answers | [pay-01](screens/pay-01.png) to [pay-05](screens/pay-05.png) | The holder is signed in, so the page lists the account's notices instead of a lookup; batch preview and confirm with the final-payment statement, per the approved proposal |
| Dispute a notice | [tbm-faq-dispute-violation](reference/tbm-faq-dispute-violation.png): https://www.e-zpassny.com/tbm/faq#violations, 2026-11-28; [tbm-faq-not-my-vehicle](reference/tbm-faq-not-my-vehicle.png); [ezpass-faq-dispute-violation](reference/ezpass-faq-dispute-violation.png) | Dispute online or in the app; "not my vehicle" path | [dispute-01](screens/dispute-01.png) to [dispute-05](screens/dispute-05.png) | Reason codes, a 45-day window and evidence references (Mail message IDs) are Crossway's own rules from the proposal |
| Vehicles and plates | [ezpass-faq-plates](reference/ezpass-faq-plates.png): https://www.e-zpassny.com/faq#vehicles-&-tags, 2026-11-28; [ezpass-faq-update-account](reference/ezpass-faq-update-account.png) | Every plate must be listed; account updates | [end-possession-01](screens/end-possession-01.png) to [-04](screens/end-possession-04.png) | Possession dates and the "plate stays with a sold vehicle" rule differ from New York on purpose (Policies page) |
| Transponders | [ezpass-faq-tags](reference/ezpass-faq-tags.png): https://www.e-zpassny.com/faq#vehicles-&-tags, 2026-11-28; [ezpass-account-types](reference/ezpass-account-types.png): https://www.e-zpassny.com/ezpass/account-types | Lost or extra tags; tags move between vehicles of the same type | [transponder-01](screens/transponder-01.png) to [-03](screens/transponder-03.png) | A moved tag charges the class of its assigned vehicle, as the proposal states |
| Top-up and auto-replenish | [ezpass-faq-replenish](reference/ezpass-faq-replenish.png): https://www.e-zpassny.com/faq#payments, 2026-11-28; [ezpass-home-rebill-alert](reference/ezpass-home-rebill-alert.png): https://www.e-zpassny.com/ | Auto-replenishment, manual payment; rebill amount review | [topup-01](screens/topup-01.png) to [-05](screens/topup-05.png), [replenish-01](screens/replenish-01.png) to [-03](screens/replenish-03.png) | Crossway's amounts, threshold and two-failure suspension are its own |
| Rates | [mta-tolls-archive](reference/mta-tolls-archive.png): web.archive.org snapshot 2026-11-04 of https://www.mta.info/fares-tolls/tolls, captured 2026-11-28 | Toll rates by crossing and payment method | [policies-01](screens/policies-01.png) | Fictional plazas and rates; no MTA or E-ZPass rates are used |

**Blocked or unavailable.** `https://www.mta.info/fares-tolls/tolls` returned HTTP 403 "Access Denied" to headless Chromium on 2026-11-28 (tried once, not retried, no user-agent change); the web.archive.org copy of the same page is used instead and labelled as an archive capture. E-ZPass NY has no rate table of its own (its Toll Rates menu links to each agency). Signed-in screens have no public reference: the proposed alternative, if the reviewer wants screens rather than FAQ text, is a public handbook or the app-store screenshots of the Tolls NY app, or a reviewer's own signed-in capture with personal data redacted.

**Intentional layout differences.** No brand marks, colours or pixel layout are copied. Crossway is one App with a sidebar of nine pages; record IDs are shown last and muted; times are Eastern with the zone named; every write is preview then confirm, and destructive steps ask first.

## Ordered sequences

Every step lists the action taken, what was expected and what was observed (the test asserts it). Record IDs are from seed `dani`.

### Top-up

| Step | Screenshot | Action | Expected and observed |
| --- | --- | --- | --- |
| 1 Start | [topup-01](screens/topup-01.png) | Open Top up | Balance $18.75; card list offers Dani's cards; the expired Mastercard `card-dani-mc` is disabled with "expired 09/2026". Observed. |
| 2 Error `card_expired` | [topup-02](screens/topup-02.png) | A client that ignores the disabled option submits $50.00 on `card-dani-mc` | Refused in place with `card_expired`; state hash unchanged. Observed. |
| 3 Preview | [topup-03](screens/topup-03.png) | $25.00 on Dani's Visa, Preview top-up | Labelled facts: amount, card "Visa ending 4417, Dani Reyes", balance before and after, expiry "Nov 2, 2026, 9:15 AM EST"; Confirm and Cancel. Cancel closes it and writes nothing (asserted), then the preview is made again. |
| 4 Lost response | [topup-04](screens/topup-04.png) | Confirm; the browser drops the response after Core commits | Error shown in the preview, no receipt. Observed. |
| 5 Retry | [topup-05](screens/topup-05.png) | Confirm again (same request ID) | First receipt `rc-0041` returned; exactly one new receipt; balance +$25.00; the receipt stays after Refresh. Observed. |

### Auto-replenish change

| Step | Screenshot | Action | Expected and observed |
| --- | --- | --- | --- |
| 1 Start | [replenish-01](screens/replenish-01.png) | Open Account overview | Replenish card is Jordan Albright's Amex; Mastercard shows Expired "yes" in the danger style, valid cards "no" in neutral (review item 9). The top-up receipt from another page is not carried over. Observed. |
| 2 Save | [replenish-02](screens/replenish-02.png) | Choose Dani's Visa, Save | Receipt names the stored rule; `replenish.card_id` is `card-dani-visa`. Observed. |
| 3 Error after success | [replenish-03](screens/replenish-03.png) | Amount $500.00, Save | `amount_out_of_range` in place; the earlier "saved" receipt is gone (review item 8); hash unchanged. Observed. |

### End possession

| Step | Screenshot | Action | Expected and observed |
| --- | --- | --- | --- |
| 1 Start | [end-possession-01](screens/end-possession-01.png) | Select HKR4471 (`v-0002`, sold 2026-09-28) | Still active, possession open, carries `tp-0002`. Observed. |
| 2 Error `end_in_future` | [end-possession-02](screens/end-possession-02.png) | End date Dec 1, 2026, End possession, confirm | Refused in the confirmation with `end_in_future`; hash unchanged. "Keep the vehicle" then closes it, nothing written. Observed. |
| 3 Confirmation | [end-possession-03](screens/end-possession-03.png) | End date Sep 28, 2026, End possession | Confirmation names the vehicle, "Sep 28, 2026", the transponder that comes off, and what changes; nothing written yet. Observed. |
| 4 Result | [end-possession-04](screens/end-possession-04.png) | End possession | Receipt "Possession of HKR4471 ended on Sep 28, 2026."; `v-0002.possession_end` 2026-09-28, `ended_at` set. Observed. |

### Transponder assignment

| Step | Screenshot | Action | Expected and observed |
| --- | --- | --- | --- |
| 1 Occupied vehicle | [transponder-01](screens/transponder-01.png) | Select the van VNT8812 (`v-0001`) | It carries `tp-0001`; no assign form (it would be `transponder_in_use`); the note says why. Observed. |
| 2 Choose | [transponder-02](screens/transponder-02.png) | Select the Kia KLM2210 (`v-0004`), choose `tp-0001` | Option shows its serial, class 2 and current vehicle. Observed. |
| 3 Result | [transponder-03](screens/transponder-03.png) | Assign transponder | `tp-0001.vehicle_id` `v-0004`, class 1; receipt and table agree. Observed. |

### Batch payment

| Step | Screenshot | Action | Expected and observed |
| --- | --- | --- | --- |
| 1 Start | [pay-01](screens/pay-01.png) | Open Pay notices | Payable notices preselected (`n-0012`, `n-0013`, `n-0014`, `n-0015`, `n-0016`, `n-0018`); disputed `n-0017` and collections `n-0001` have disabled boxes with the reason. Observed. |
| 2 Error `in_collections` | [pay-02](screens/pay-02.png) | A client that ignores the disabled box adds `n-0001` and previews | Whole preview refused, `n-0001` named; hash unchanged. Observed. |
| 3 Error `stale_version` | [pay-03](screens/pay-03.png) | Another MCP client writes after the page loaded; preview `n-0014`, `n-0016` | Refused in place with `stale_version`; nothing stored. Observed. |
| 4 Preview | [pay-04](screens/pay-04.png) | Refresh, select `n-0014`, `n-0016`, Visa, Preview | One sentence per notice (amount, plaza, toll date, plate), total $42.75, cardholder Dani Reyes, expiry with zone, "Payment is final and closes the right to dispute."; Confirm and Cancel. Observed. |
| 5 Result | [pay-05](screens/pay-05.png) | Confirm payment | Receipt `rc-0044`, both notices `paid` on `card-dani-visa`. After a reload the page still shows the committed state, and an independent MCP `notices.get` sees `paid`. Observed. |

### Dispute file and withdraw

| Step | Screenshot | Action | Expected and observed |
| --- | --- | --- | --- |
| 1 Form | [dispute-01](screens/dispute-01.png) | Notice `n-0017`, reason sold or not in possession, transfer date, evidence `mail/mail-dani/m-11133` | Non-disputable notices are disabled options with the reason. Observed. |
| 2 Preview | [dispute-02](screens/dispute-02.png) | Preview dispute | Labelled facts: notice, amount, reason, "Sep 28, 2026", evidence "Mail message m-11133 (mailbox mail-dani)", expiry with zone, the rules; Submit and Cancel. Observed. |
| 3 Submitted | [dispute-03](screens/dispute-03.png) | Submit dispute | `dp-0003` submitted with its reason, date and evidence; receipt shown. Observed. |
| 4 Withdraw confirmation | [dispute-04](screens/dispute-04.png) | (after filing `dp-0004` on `n-0018`) Withdraw | Confirmation says withdrawal is final; nothing written. "Keep the dispute" closes it and `dp-0004` stays submitted (asserted). Observed. |
| 5 Withdrawn | [dispute-05](screens/dispute-05.png) | Withdraw, then Withdraw dispute | `dp-0004` withdrawn; `n-0018` back to issued with the days that remained. Observed (review item 10). |

### Other pages and states

[policies-01](screens/policies-01.png) (rules and rates), [not-found-01](screens/not-found-01.png) (unknown address: heading and browser title "Page not found"), [profiles-01](screens/profiles-01.png) (browse: preview without confirm), [narrow-01](screens/narrow-01.png) (390px), and each other seed at its clock: [seed-marisol-01](screens/seed-marisol-01.png) (suspended banner), [seed-theo-01](screens/seed-theo-01.png), [seed-priya-01](screens/seed-priya-01.png) and [seed-priya-02](screens/seed-priya-02.png) (the year-end seed, Dec 31, 2026).

## Mail dependency

`node apps/crossway/examples/publish-to-mail.cjs --evidence` wrote [`publish-to-mail.json`](publish-to-mail.json). Source: Crossway 0.3.0 (publisher `crossway`, account `cw-<seed>`); destination: Mail 1.3.0 (`examples/apps/mail`, account `mail-<seed>`) through the public Messaging router (`runtime/messaging/service.cjs`, trusted-stdio launch), contract `channel.email` (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver `mail.receive_notification`). Mail is loaded with the holder's Mail seed from `examples/messaging/` at Crossway's clock and its clock is advanced to Crossway's before each delivery. Event IDs are deterministic; `received_at` and `committed_at` are wall-clock.

| Case | Request | Result in Mail | Both Apps |
| --- | --- | --- | --- |
| Missing grant | `router.publish` of `cw-notice-0001` (dispute received on `n-0017`) with `config.no-grant.json` | `rejected`, `recipient_not_authorized`; 2 messages, unchanged | Mail and Crossway snapshots unchanged |
| Committed | `router.publish`, request `publish-cw-notice-0001` | receipt `event_id` `router-003e855423c4adc8070f09b5387f9293`; `mail.get` returns that message with the same subject and body | Crossway keeps its notice (no delivery state) |
| Duplicate | same CloudEvents id, request `retry-cw-notice-0001` | `duplicate: true`, same `event_id`; still one copy | unchanged |
| Deadlines | `env.advance_time` to 2026-11-06 creates nothing; event `ev-0031` then commits escalation and collections notices, each read back | 9 messages committed in all, decision on `n-0017` included | |
| Unknown acknowledgement | top-up receipt `cw-notice-0001` in run `crossway-mail-unknown`; the receiver client throws after Mail's commit | router `unknown`, `receiver_unconfirmed`, `stop_run: true`, `event_id` `router-b065172d0e0f1fb569f06d12dcaf2606`, no `committed_at`; the next publish is `halted` (`run_halted`). Reconciled: Mail `env.event_status` `committed`, `mail.get` finds the message, Mail holds exactly one copy (2 to 3) | Crossway unchanged; publisher stops, notice left unhandled, run not scored |
| One run per seed | reference actions and example schedule of each seed, every new notice published and read back | dani 12, marisol 7, theo 9, priya 9 notices delivered; cited evidence read from Mail: `m-11133`, `m-11140` (dani), `m-21107` (marisol), `m-30815`, `m-31042` (theo), `m-41206` (priya) | each dispute's evidence joins to a real Mail message |

Local send (Crossway's outgoing record), receiver commit (`committed` receipt plus `mail.get`) and business confirmation are distinct. Recipient or business confirmation is N/A: the notices go to the account holder's own mailbox and ask nobody else to act.

## Not covered here

- Check (g), the independent reproduction by a second person, and the author's read-through of the four seeds are in progress; `contribution/dataset.json` keeps `review.status: "pending"`.
- Calendar is used only through its own Agent tools and receives nothing from Crossway, so there is no Calendar dependency run.
