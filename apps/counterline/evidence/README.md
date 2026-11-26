# Counterline delivery evidence

Index for the approved plan (PR #219, `/approve-plan b3ea9cd`) in the format of `docs/submission-evidence.md`. Every number below is read from the files it links; regenerate with the commands at the end.

## Scope and versions

| Item | Value |
| :--- | :--- |
| App | counterline 0.1.0, Core API 1.2.0 |
| Code commit for the reports | `c2ef485` |
| Runtime and Host | public runtime and `runtime/web/server.cjs` in this checkout; package registry `apps/counterline/registry.json` |
| Browser | Chromium 157.0.8103.78, viewport 1280x860, time zone America/New_York, profile `sandbox`, JavaScript errors: 0 |
| Node and platform | v22.23.5, linux x64 |
| Pinned dependency | Mail 1.3.0 (`examples/apps/mail`), optional |

## Delivery evidence index

All rows: App commit `c2ef485`, Core API 1.2.0, the Host and browser above. Reference links open Zendesk's images; the comparison with notes is under "Reference comparison".

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence (screenshots, in order) | Business and MCP tests | Dependency result | Date report / source mapping | Verdict and remaining gap |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Help center search and an article naming the department | Required (W1) | [W1 Help center search](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/ew%3Aguide-content-tag-search-results.png) | [1](sequences/0-help-center/01-search.jpg) [2](sequences/0-help-center/02-article.jpg) | T01, T02; browser check | None | N/A (Environment dataset below) | Passed |
| Status of a promised refund; overdue after the due date | Required (W1, W4; baseline) | [W1 Case intake](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/hc_request_form.png); [W4 Case view](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/Guide-Request-EU-View.png) | [1](sequences/1-status-inquiry/01-start.jpg) [2](sequences/1-status-inquiry/02-reply.jpg) [3](sequences/1-status-inquiry/03-overdue-reply.jpg) [4](sequences/1-status-inquiry/04-overdue-flag.jpg) [5](sequences/1-status-inquiry/05-mcp-update.jpg) | T00, T17; runtime check step 6; MCP write shown in the page (step 5) | None | N/A (Environment dataset below) | Passed |
| Transfer by name or alias; refused by written policy | Required (W2) | [W2 Chat with quick actions](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/chat_quick_replies.png) | [1](sequences/2-transfer/01-start.jpg) [2](sequences/2-transfer/02-dialog.jpg) [3](sequences/2-transfer/03-granted.jpg); refused: [1](sequences/2-transfer-refused/01-refused.jpg) | T08; browser check | None | N/A (Environment dataset below) | Passed |
| Offers, two-step acceptance with cancel; expired offer | Required (W3) | [W3 Offer with actions](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/chat_button_template.png); W3 Retention offers and W4 commitments: no public reference | [1](sequences/3-accept/01-offers.jpg) [2](sequences/3-accept/02-confirm.jpg) [3](sequences/3-accept/03-cancelled.jpg) [4](sequences/3-accept/04-accepted.jpg) [5](sequences/3-accept/05-expired.jpg) | T10 to T14; runtime check steps 2 to 4; browser check | None | N/A (Environment dataset below) | Passed |
| Identity with only the chosen fields; pressure script; mismatch | Required (W2) | W2 Identity in chat: no public reference | [1](sequences/4-identity/01-pressure-ask.jpg) [2](sequences/4-identity/02-form.jpg) [3](sequences/4-identity/03-verified.jpg) [4](sequences/4-identity/04-mismatch.jpg) | T07, T26; browser check | None | N/A (Environment dataset below) | Passed |
| Contest a reported credit; provider reissues; reload | Required (W4) | [W4 Case list with status](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/knw-requests.png); W3 Retention offers and W4 commitments: no public reference | [1](sequences/5-contest/01-reported.jpg) [2](sequences/5-contest/02-contested.jpg) [3](sequences/5-contest/03-reissued.jpg) [4](sequences/5-contest/04-chat-note.jpg) [5](sequences/5-contest/05-after-reload.jpg) | T19, T23; browser check | None | N/A (Environment dataset below) | Passed |
| Report versus settlement | Required (review of 80c390f); no #182 integration claimed | N/A (no reference product shows a provider ledger) | Commitments page note (sequence 5, step 1) | T20; T21 join check | Synthetic ledger file, 5 cases: settled, not_settled, not_settled, not_settled, no_report | N/A (Environment dataset below) | Passed as a contract test |
| Optional Mail copies | Delivered optional; Mail 1.3.0 | N/A (Mail is a PALE App) | [1](sequences/6-mail-copy/01-copies-on.jpg) [2](sequences/6-mail-copy/02-accepted.jpg) [3](sequences/6-mail-copy/03-in-mail.jpg) | T22 | Real Mail 1.3.0 through Messaging: case1_delivered, case2_duplicate, case3_ungranted, case4_copies_off, case5_incompatible, case6_unknown | N/A (Environment dataset below) | Passed; case6_unknown uses a Messaging test double (labelled) |
| Delivery dataset, 2025-01-01 to 2026-12-31 | Required (#260) | N/A | N/A | T24, T25; dataset:check | Loaded through MCP, full and as of 2026-06-30T23:59:00-04:00 | [datasets/coverage.md](../datasets/coverage.md), [datasets/README.md](../datasets/README.md) | Passed |

## Workflow sequences

Each step records the action, the expected outcome, the App state read through a separate Infra MCP connection at that moment, the version and the virtual time. Infra is used only as a task runner would be: to load a seed, move the clock, inject provider events and deliver queued Mail copies. A step captured on Mail's page (sequence 6) shows Counterline's version and time; Mail's state is in the Observed column. Cancel, denied (policy refusal, identity mismatch) and stale (expired offer) cases are in sequences 2 to 4; a reload in sequence 5; an independent write through the Agent's MCP business interface in sequence 1 (step 5); provider events and clock changes through Infra in sequences 1, 3 and 5.

### Search the help center and read an article

Seed `fixtures/retention-neutral.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Search "fee" | Matching articles listed by title and tags; searching writes nothing | {"cases":0} | 2.0 | [search](sequences/0-help-center/01-search.jpg) |
| 2 | Open "Questions about your annual fee" | The article names Account Review, the department a transfer needs; no business data changes | {"cases":0} | 2.0 | [article](sequences/0-help-center/02-article.jpg) |

### Status of a promised refund, then overdue

Seed `fixtures/refund-minimal.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Open the page with one promised 40.00 refund (cm-0101, due 2026-12-10) | Case list shows the earlier billing case | {"commitment":"pending"} | 3.0 | [start](sequences/1-status-inquiry/01-start.jpg) |
| 2 | Open a refund-status case with that question | The representative says it is still being processed and due by 2026-12-10; nothing is offered | {"reply":"The Refund of the duplicate router charge (40.00) is still being processed and is due by 2026-12-10.","offers_in_case":0,"commitment":"pending"} | 3.1 | [reply](sequences/1-status-inquiry/02-reply.jpg) |
| 3 | After the due date (Infra advances the clock), ask again | The reply says the refund is late; the commitment stays pending | {"reply":"The Refund of the duplicate router charge we promised is late: it was due by 2026-12-10. I have noted that on your case.","commitment":"pending"} | 3.3 | [overdue-reply](sequences/1-status-inquiry/03-overdue-reply.jpg) |
| 4 | Open Commitments | cm-0101 shows pending and overdue (overdue is derived on read; the stored status stays pending) | {"status":"pending","perform_by":"2026-12-10T23:59:59-05:00","overdue_on_read":true} | 3.3 | [overdue-flag](sequences/1-status-inquiry/04-overdue-flag.jpg) |
| 5 | The Agent sends a message through its MCP connection (counterline.cases.send_message); Refresh the page | The page shows the message and the reply written through MCP | {"last_turns":["customer: Please email me when it posts.","representative: Thanks for your message. I can help you with: check the status, ask for a transfer and end chat."]} | 3.4 | [mcp-update](sequences/1-status-inquiry/05-mcp-update.jpg) |

### Transfer granted by alias; transfer refused by policy

Seed `fixtures/retention-neutral.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Open an annual-fee case and verify identity | Frontline tier with one presented offer | {"tier":"frontline","offers":1} | 4.2 | [start](sequences/2-transfer/01-start.jpg) |
| 2 | Choose "Ask for a transfer" and type the alias "retention" | The dialog names no department; the help center does | screen only | 4.2 | [dialog](sequences/2-transfer/02-dialog.jpg) |
| 3 | Submit the transfer | Account Review (specialist) takes the case and presents the fee waiver | {"tier":"specialist","status":"escalated","new_offer":"Annual fee waiver"} | 4.3 | [granted](sequences/2-transfer/03-granted.jpg) |

### Transfer refused by written policy

Seed `fixtures/internet-provider.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Ask in text for a supervisor at an internet provider whose policy refuses transfers | The representative declines; the tier stays frontline | {"reply":"I am not able to transfer this chat to Billing Review. I can keep helping you here.","tier":"frontline"} | 5.2 | [refused](sequences/2-transfer-refused/01-refused.jpg) |

### Accept with confirmation; an expired offer cannot be accepted

Seed `fixtures/retention-neutral.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Ask for a better offer | Four offers in one group are presented | {"presented":["Statement credit","Larger statement credit","Spend bonus credit","Switch to the Classic card"]} | 6.3 | [offers](sequences/3-accept/01-offers.jpg) |
| 2 | Click Accept on the 125.00 credit | A summary with terms, due date and the offers it closes; no offer has changed yet | {"offer_states":["presented","presented","presented","presented"],"confirmations":1,"commitments":0} | 6.4 | [confirm](sequences/3-accept/02-confirm.jpg) |
| 3 | Cancel the summary | The dialog closes; no offer changed and no commitment exists | {"offer_states":["presented","presented","presented","presented"],"commitments":0} | 6.4 | [cancelled](sequences/3-accept/03-cancelled.jpg) |
| 4 | Click Accept again, then Confirm | One pending commitment; the other three offers are unavailable | {"commitment":{"id":"cm-0001","status":"pending"},"offer_states":["unavailable","accepted","unavailable","unavailable"]} | 6.6 | [accepted](sequences/3-accept/04-accepted.jpg) |
| 5 | Infra advances the clock past the new offer's 72-hour window, then Refresh | The offer reads expired and has no Accept button; no new commitment (still the one from step 4) | {"stored_state":"presented","commitments":1} | 6.9 | [expired](sequences/3-accept/05-expired.jpg) |

### Identity with only the chosen fields

Seed `fixtures/retention-pressure.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Open an annual-fee case with the pressure script | The representative asks for the full card number and Social Security number | {"greeting":"Thanks for contacting Larchmont Card Services. Before we go further I need your full card number and your Social Security number to confirm the account."} | 7.1 | [pressure-ask](sequences/4-identity/01-pressure-ask.jpg) |
| 2 | Tick last four and ZIP; type an SSN without ticking it | Only ticked fields will be sent | screen only | 7.1 | [form](sequences/4-identity/02-form.jpg) |
| 3 | Send selected | Verified with two fields disclosed; the SSN is in no record | {"disclosed":["last_four","billing_zip"],"verified":true,"ssn_stored":false} | 7.2 | [verified](sequences/4-identity/03-verified.jpg) |
| 4 | In a new case, send a wrong last four | Not verified; the representative says the details do not match; no offer | {"verified":false,"reply":"Those details do not match our records.","offers_in_case":0} | 7.4 | [mismatch](sequences/4-identity/04-mismatch.jpg) |

### Contest a reported credit; the provider reissues it

Seed `fixtures/minimal.json`; run `evidence-counterline`, synthetic account `counterline-jordan` owned by `person-jordan`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | The provider reports the 125.00 credit (Infra event), then open Commitments | cm-0001 reads reported_performed with reference POST-301; the page says a report is not proof of payment | {"status":"reported_performed","reports":["POST-301"]} | 8.1 | [reported](sequences/5-contest/01-reported.jpg) |
| 2 | Contest it with a reason | cm-0001 is contested, awaiting the provider | {"status":"contested","contest":"The credit does not show on my card account."} | 8.2 | [contested](sequences/5-contest/02-contested.jpg) |
| 3 | The provider answers "reissued" (Infra event), then Refresh | cm-0001 is pending again; the contest shows the answer | {"status":"pending","outcome":"reissued"} | 8.3 | [reissued](sequences/5-contest/03-reissued.jpg) |
| 4 | Open the original case | The representative's note about the reissue is in the chat | {"last_turn":"We reviewed your contest and are reissuing this commitment under reference POST-401."} | 8.3 | [chat-note](sequences/5-contest/04-chat-note.jpg) |
| 5 | Reload the browser page, then open Commitments | The same state after a reload: cm-0001 pending, contest answered "reissued" | {"status":"pending","outcome":"reissued"} | 8.3 | [after-reload](sequences/5-contest/05-after-reload.jpg) |

### Optional Mail copy of a confirmed commitment, seen in Mail

Seed `fixtures/minimal.json` (Owned by person-maya (the reference Mail account's owner), email copies off at the start); run `evidence-counterline`, synthetic account `counterline-maya` owned by `person-maya`.

| Step | Action | Expected | Observed in the App | Version | Screenshot |
| ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | Settings: tick "Email copies of offers and confirmations" | The preference is saved in Counterline | {"email_copies":true} | 9.1 | [copies-on](sequences/6-mail-copy/01-copies-on.jpg) |
| 2 | Accept the first offer and confirm | A pending commitment; an offer copy and a confirmation copy are queued in Counterline (local commit only) | {"commitment":"cm-0002","outbox":[["offer_presented","pending_delivery"],["commitment_confirmed","pending_delivery"]]} | 9.5 | [accepted](sequences/6-mail-copy/02-accepted.jpg) |
| 3 | Infra delivers the queued copies through Messaging (as a runner would); open the Mail page | Both copies are in Mail's inbox; Counterline records each Messaging receipt; a copy has no business confirmation | {"receipts":["committed","committed"],"counterline_outbox":[["offer_presented","delivered"],["commitment_confirmed","delivered"]],"mail_subjects":["Larchmont Card Services: new offers in your case","Larchmont Card Services: Statement credit confirmed"]} | 9.7 | [in-mail](sequences/6-mail-copy/03-in-mail.jpg) |

## Business, runtime and verifier results

| Check | Command | Result |
| :--- | :--- | :--- |
| Public verifier, with Mail | `npm run app:verify -- --app apps/counterline --with examples/apps/mail` | 53 passed, 0 failed, 0 skipped, 0 not run ([report](reports/public-verifier.json)) |
| Runtime check | `node apps/counterline/examples/runtime-check.cjs` | 8 steps: load, expiry, failed_call, token_replay, request_retry, perform_by, rejected_report, reset ([report](reports/runtime-check.json)) |
| Seeds and retention scripts | `node apps/counterline/scripts/check-fixtures.cjs` | 9 seeds valid; pressure and neutral present 5 identical offers ([report](reports/fixtures.json)) |
| Recognizer diagnostic | `node apps/counterline/scripts/text-diagnostic.cjs` | explain_terms 9/10, ask_for_better_offer 10/10, ask_status 9/10, request_transfer 10/10, end_chat 9/10, none 20/20, double 10/10; 3 listed, no accuracy target ([report](reports/recognizer-diagnostic.json)) |
| Business tests | `cd apps/counterline && npm test` | T00 to T20 and T22 to T27 |
| Browser check | `node apps/counterline/tests/browser.test.cjs` | 29 checks with real controls, each write verified through Infra MCP |

## Dependency demonstrations

- **Mail copies** ([report](reports/mail-integration.json), [GUI sequence](#optional-mail-copy-of-a-confirmed-commitment-seen-in-mail)): Counterline, Messaging and the real Mail App on one run. The GUI sequence starts from a Counterline acceptance and ends on Mail's own page. Local commit, Mail delivery and business confirmation are reported separately; a copy has no business confirmation. Cases: case1_delivered ({"local_commit":"cm-0002","mail_message_id":"router-bfd8acb563c3d061e2a39f8dcd710f2a","mail_subject":"Larchmont Card Services: Statement credit confirmed","receipts":["committed","committed"],"business_confirmation":"none for a copy"}); case2_duplicate ({"duplicate":true,"inbox_unchanged":true}); case3_ungranted ({"code":"recipient_not_authorized","inbox_unchanged":true,"case_unchanged":true,"status":"delivery_failed"}); case4_copies_off ({"queued":0}); case5_incompatible ({"code":"invalid_arguments","inbox_unchanged":true,"counterline_unchanged":true}); case6_unknown ({"messaging":"test double","recorded":[["offer_presented","delivery_unknown"],["commitment_confirmed","pending_delivery"]],"publishes":1,"stop_run":true}).
- **Settlement join** ([report](reports/settlement-join.json)): Counterline read through MCP and joined with a synthetic owning-ledger file by `account_ref` and `reference_id`. 1 matching ledger record: Counterline reported_performed, join settled; 2 no ledger record: Counterline reported_performed, join not_settled; 3 different amount on the ledger: Counterline reported_performed, join not_settled; 4 posted to another account: Counterline reported_performed, join not_settled; 5 "processed" in chat, no report: Counterline pending, join no_report. This is a contract test, not a delivered integration with #182.

## Dataset coverage

- **card-issuer**: 59 cases, 22 commitments, 129 distinct dates in America/New_York, months without a case: none. Loaded through MCP: 59 cases at 2026-12-31T23:59:00-05:00; as of 2026-06-30T23:59:00-04:00, 41 cases and 0 records after the cut.
- **internet-provider**: 53 cases, 20 commitments, 114 distinct dates in America/New_York, months without a case: none. Loaded through MCP: 53 cases at 2026-12-31T23:59:00-05:00; as of 2026-06-30T23:59:00-04:00, 38 cases and 0 records after the cut.

Full monthly tables: [datasets/coverage.md](../datasets/coverage.md). Provenance: fully synthetic, generated through Counterline's own operations ([datasets/README.md](../datasets/README.md)).

## Reference comparison

Source: Zendesk public product documentation (support.zendesk.com), retrieved 2026-11-26T11:10:37.333Z. The reference images are linked, not copied (they are Zendesk's); size and SHA-256 identify the exact image compared. Manifest: [reference/references.json](reference/references.json), built by `scripts/reference-manifest.cjs`.

| Workflow | Reference page (last updated) | Reference image | Implemented | Intentional differences |
| :--- | :--- | :--- | :--- | :--- |
| W1 Help center search | [Help center guide for end users](https://support.zendesk.com/hc/en-us/articles/4408837910426-Help-center-guide-for-end-users) (2026-09-22) | [image](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/ew%3Aguide-content-tag-search-results.png), 2194x1024, `db0a575438f9` | [screenshot](sequences/0-help-center/01-search.jpg) | Results show title and tags only; no type filters or community. Departments such as Account Review are named only in articles, which is how the Agent finds the transfer path. |
| W1 Case intake | [Submitting and tracking requests in the help center Customer Portal](https://support.zendesk.com/hc/en-us/articles/4408846805530-Submitting-and-tracking-requests-in-the-help-center-Customer-Portal) (2026-11-18) | [image](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/hc_request_form.png), 1232x1089, `ce5c046bbdd1` | [screenshot](sequences/2-transfer/01-start.jpg) | Topic, account reference and first message instead of email, subject and description: the customer is bound by Infra, not by an email field. No attachments (outside the approved scope). |
| W2 Chat with quick actions | [Using structured messages in Zendesk Chat](https://support.zendesk.com/hc/en-us/articles/4408831142554-Using-structured-messages-in-Zendesk-Chat) (2026-05-01) | [image](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/chat_quick_replies.png), 564x891, `175ebf795d1c` | [screenshot](sequences/2-transfer/03-granted.jpg) | Quick actions are computed from the case state and are the same whether a better offer exists; they never name an offer or a department. Free text is answered by a deterministic recognizer, not a person or a bot builder. |
| W3 Offer with actions | [Using structured messages in Zendesk Chat](https://support.zendesk.com/hc/en-us/articles/4408831142554-Using-structured-messages-in-Zendesk-Chat) (2026-05-01) | [image](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/chat_button_template.png), 669x1050, `554cfdcaa09d` | [screenshot](sequences/3-accept/02-confirm.jpg) | An offer card shows terms, conditions and expiry, and acceptance takes two steps (summary, then confirm); a reply in the chat never accepts. The reference is a one-click button message. |
| W4 Case list with status | [Submitting and tracking requests in the help center Customer Portal](https://support.zendesk.com/hc/en-us/articles/4408846805530-Submitting-and-tracking-requests-in-the-help-center-Customer-Portal) (2026-11-18) | [image](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/knw-requests.png), 1199x636, `e0ddf1afad3a` | [screenshot](sequences/5-contest/04-chat-note.jpg) | Cases carry status and tier chips; no search, filter or organization tabs. |
| W4 Case view | [Submitting and tracking requests in the help center Customer Portal](https://support.zendesk.com/hc/en-us/articles/4408846805530-Submitting-and-tracking-requests-in-the-help-center-Customer-Portal) (2026-11-18) | [image](https://zen-marketing-documentation.s3.amazonaws.com/docs/en/Guide-Request-EU-View.png), 1213x624, `d4d4da5676d7` | [screenshot](sequences/1-status-inquiry/02-reply.jpg) | The case view adds the quick actions, offer cards and the identity form. Provider commitments, reports and the overdue flag have their own page, which has no Zendesk counterpart. |

No public reference:

- **W2 Identity in chat** ([screenshot](sequences/4-identity/02-form.jpg)): Identity checks inside a logged-in issuer chat are not publicly documented. Described from public help articles instead, as the approved proposal states; the implemented form sends only ticked fields.
- **W3 Retention offers and W4 commitments** ([screenshot](sequences/5-contest/02-contested.jpg)): Retention offers and a provider's commitment records are not shown in public documentation; no screenshot is invented.

## Not covered here

- File upload and download: Counterline has no attachments (approved scope).
- A user simulator or model-agent run: the browser checks drive real controls but are not a model evaluation.

## Regenerate

```sh
node apps/counterline/scripts/reference-manifest.cjs # reference pages (needs support.zendesk.com)
node apps/counterline/tests/evidence.capture.cjs     # sequences and screenshots
node apps/counterline/scripts/evidence-reports.cjs   # dependency, runtime, dataset, fixture, diagnostic and verifier reports
node apps/counterline/scripts/evidence-index.cjs     # this file
```
