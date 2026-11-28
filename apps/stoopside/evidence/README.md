# Stoopside delivery evidence

Evidence index for the Stoopside delivery, following `docs/submission-evidence.md` (merged 2026-11-25 in #260) and the GUI acceptance items of `docs/review/app-implementation-checklist.md`. Scope source: the approved proposal `proposals/environment/stoopside.md` (approved at `41fd0bb`): workflows 1 to 5 through MCP tools **and** eight `pale.web` pages, Mail 1.3.0 as a delivered optional publish target, Calendar not used. Business tests, MCP tests and browser results are reported separately below; screenshots supplement them and do not replace them.

- [Dataset coverage report](coverage.md) ([JSON](coverage.json)), from [`scripts/coverage-report.cjs`](../scripts/coverage-report.cjs).
- [Implementation screenshots](screens/) and their [manifest](screens/manifest.json).
- [Meetup reference screenshots](reference/), with [sources](reference/sources.json) and [notice](reference/NOTICE.md).
- [Mail publisher sample output](mail-publish.sample.json).

## Pinned versions and run

| Item | Value |
| :--- | :--- |
| App commit the screenshots were taken at | `d017fb724afa79ac204741f343a3c84a4e4118ce` (clean tree for `gui/`, `src/`, `tools.json`, `fixtures/`); `gui/src/app.js` SHA-256 `440d073e3f40276c51fc8f9b2ca5d3cc90f02a721bdc46b843a04eab2a477f5a`. Later commits on the branch change only documentation and evidence files. |
| Host | Public business Web Host `runtime/web/server.cjs` (last change `f2eb0396d590f36c139d96ac801c8106b8146ac2`, file SHA-256 `cf8f3b04...0572`), shared `style.css` and `client.js`; public runtime 1.6.0, Core API 1.2.0 |
| Browser | Chromium 141.0.7390.37 (Playwright, headless), Node v24.10.0, macOS |
| Viewport | 1280 x 800 (plus 390 x 844 for the narrow check) |
| Run and account | run `web-checks`, profile `sandbox`, registry `web.registry.json` (clock 2027-03-01 09:00 EST); Core starts the run from the manifest seed (Hillcrest) and Infra loads `fixtures/minimal.json` (Maple St, synthetic) at its clock with `env.load_seed`; account `st-dana` (Dana O., member `m-001`). Read-only run `web-checks-ro` (profile `scenario`). In-window run `web-checks-hillcrest` (`web.hillcrest.registry.json`, Hillcrest at 2026-11-18 09:00 PST). |
| Reproduce | From the repository root, after `npm ci` and `npx playwright install chromium`: `node apps/stoopside/tests/web-checks.cjs --evidence` (85 checks; rewrites `screens/` and `screens/manifest.json`). Without `--evidence` it only runs the checks. |

## Delivery evidence index

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1a. Group discovery, join and leave | Required (workflow 1, group home page); App `4407162`, Host as above | [find groups](reference/meetup-find-groups.png), [group home](reference/meetup-group-home.png) | [Sequence 1](#1-group-discovery-join-and-leave): screens 01, 02, 27, 28 | `tests/business.test.cjs` (workflow 1, `sole_organizer`, `sole_host`, `approval_pending`); `tests/web-checks.cjs` checks on discovery, membership, leave confirmation and join | Infra snapshot: membership `g-garden`/`m-001` `member` to `left` to `member` | N/A (no Task history) | Passed (business, MCP, browser). Human hand read pending (review item 4). |
| 1b. Member search and export | Required (workflow 1, member directory) | No public capture: the members page needs a log-in (recorded in `reference/sources.json`) | [Sequence 2](#2-member-search-and-export): screens 04, 05 | `tests/business.test.cjs` (search covers display names and bios only; export co-organizer and above; `hide_from_member_list`); `tests/fixtures.test.cjs` (g) | `members.export` rows equal the page rows; `birdie.adeyemi@example.net` only in the export | N/A | Passed. Reference not available without an account. |
| 2a. RSVP with pre-filled counts, error and cancel | Required (workflow 2, event page) | [event page](reference/meetup-event-page.png), [find events](reference/meetup-find-events.png). Child counts and the pre-fill rule: no Meetup equivalent | [Sequence 3](#3-rsvp-pre-fill-error-cancel-and-confirm): screens 06 to 09 | `tests/business.test.cjs` incl. `guest_limit_exceeded ... names the RSVP it came from (Maple St e-0125)`; anchors (a) `prefilled_counts` | RSVP `r-0511` yes, 0 guests, 0 children; receipt notice `st-notice-0001`; reload shows the same | N/A | Passed. |
| 2b. Waitlist offer and claim | Required (workflow 2) | Meetup has a waitlist, but the public capture shows only the Attend button; the 24-hour claim window has no Meetup equivalent | [Sequence 4](#4-waitlist-offer-and-claim): screens 22 to 24 | `tests/business.test.cjs` (offer chain, `claim_expired`, late claim anchor); `tests/platform-checks.cjs` (offer stamped at the previous expiry); `tests/replay-checks.cjs` | Infra `env.apply_event` (examples/scenario.json) then RSVP `r-0451` `offered` to `yes`, 2 places; receipt `st-notice-0006` | N/A | Passed. |
| 2c. Event create, edit and cancel with a notify choice | Required (workflow 2, change preview page) | No public capture (organizer tools need a log-in; the help center blocks automated access) | [Sequence 5](#5-event-edit-cancel-and-stale-confirm): screens 10 to 13, 25, 26 | `tests/business.test.cjs` (`notify_required`, `capacity_below_yes`, reconfirm); `tests/platform-checks.cjs` (stale version, retried confirm, consumed preview) | `e-0140` venue Linden Park pavilion, 10 `event_changed` deliveries equal the 10 previewed recipients; stale confirm leaves the independent MCP title on `e-0130`; created event cancelled | N/A | Passed. |
| 3. Post composer with an audience | Required (workflow 3, composer) | Meetup group page shows a Discussions tab ([group home](reference/meetup-group-home.png)); post audiences (`event_guests`, `hosts_only`) have no Meetup equivalent | [Sequence 6](#6-post-composer-audience-and-delete): screens 14 to 17 | `tests/business.test.cjs` (`audience_required`, `post_locked`, `announcement_limit_reached`, anchors and mutations); `tests/fixtures.test.cjs` (f) | Post `p-0307` `event_guests` on `e-0130`, 5 deliveries, none to `m-027`; delete after confirmation keeps the deliveries | N/A | Passed. |
| 4. Sign-up sheet claim, release and swap | Required (workflow 4, sheet page) | No Meetup equivalent (sign-up sheets and swaps are Stoopside's own rules) | [Sequence 7](#7-sign-up-sheet): screens 18 to 20 | `tests/business.test.cjs` (`slot_taken`, `sheet_locked`, `not_your_slot`, `swap_pending`, swap expiry) | `s-0022`: user holds `snacks` only; swap `sw-0005` accepted | N/A | Passed. |
| 5. View-as | Required (workflow 5, selector on three pages) | No Meetup equivalent | [Sequence 8](#8-view-as): screens 03, 21 | `tests/business.test.cjs` (visibility table (f), `view_as` anchor); `tests/fixtures.test.cjs` (f), (g) | `visibility.view_as` answers equal the page for `m-027` (group), `m-016` (event), `m-013` (sheet) | N/A | Passed. |
| Pages: errors, permissions and layout | Required (checklist section 3 and 4) | N/A | [Sequence 9](#9-not-found-read-only-narrow-and-in-window-run): screens 29 to 32 | `tests/web-checks.cjs`: no text below 12px on nine pages, no raw ISO times, 403 on a management call, no write control in the `scenario` profile, no overflow at 390 px, no JavaScript errors | N/A | N/A | Passed. |
| Mail delivery (Messaging, `channel.email`) | Delivered optional (proposal section 3). Stoopside package at App commit `4407162`; Mail 1.3.0 at `examples/apps/mail` (tree `df8a8eac`, last change `3c91dba6`); Messaging `runtime/messaging` (last change `f47bf882`); contract `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver `mail.receive_notification`; direction Stoopside to Mail through `router.publish`; publisher `stoopside` account `st-dana`, recipient Mail account `mail-dana`, both owned by `person-dana-okafor`; Mail starts empty | N/A (no GUI flow; Mail's own GUI is not part of this delivery) | [Mail row](#10-mail-delivery) | `node apps/stoopside/examples/publish-to-mail.cjs` (PASS); `tests/replay-checks.cjs` (companion Mail seeds load and read back) | See [Mail row](#10-mail-delivery) and [sample output](mail-publish.sample.json) | N/A | Passed for local commit, receiver commit, rejection, duplicate and unknown. Recipient/business confirmation: N/A, the notices go to the user's own mailbox. |
| Environment dataset coverage | Required (section 3) | N/A | N/A | `node scripts/coverage-report.cjs --check`; `tests/fixtures.test.cjs` (committed report matches a fresh run) | Seeds and Mail seeds hashed in `coverage.json` and `contribution/dataset.json` | [coverage.md](coverage.md): 618 global distinct dates, every month of 2025-2026 covered; Maple St is the full-window source. Earlier in-window clocks: `scripts/generate-fixture.cjs --cutoff` (tested at six clocks); a load before a seed's history is refused | Passed for the counted data. All synthetic; human read pending. |

## Reference comparison

Meetup is the workflow reference named in the approved proposal. Stoopside copies no Meetup code, assets, branding or pixels; the comparison is about which screens and states exist and what they show.

| Reference | Source URL | Captured (UTC) | Stoopside counterpart | Intentional differences |
| :--- | :--- | :--- | :--- | :--- |
| [Groups near New York](reference/meetup-find-groups.png) | https://www.meetup.com/find/?source=GROUPS&location=us--ny--New%20York | 2026-11-28 03:23:41 | [01 group discovery](screens/01-groups-discovery.png) | Cards carry name, description, member count and the user's own membership; no photos, ratings or location filter (one neighbourhood, no images by design). |
| [Events near New York](reference/meetup-find-events.png) | https://www.meetup.com/find/?source=EVENTS&location=us--ny--New%20York | 2026-11-28 03:23:47 | [02 group home](screens/02-group-home.png) (upcoming event cards) | Event cards show date block, time range with zone, venue and places left instead of attendee avatars; there is no cross-group event search (out of the approved scope). |
| [Group home](reference/meetup-group-home.png) | https://www.meetup.com/nycnonprofit/ | 2026-11-28 03:23:52 | [02 group home](screens/02-group-home.png) | Same parts (title, description, member count, organizers, join/leave, events, discussions); Stoopside adds the role chip, privacy flags and the time zone, and has no photos tab. |
| [Event page](reference/meetup-event-page.png) | https://www.meetup.com/nycnonprofit/events/317300605/ | 2026-11-28 03:23:59 | [07 RSVP start](screens/07-rsvp-start.png), [22 waitlist offer](screens/22-waitlist-offer.png) | Same date block, time and place, hosts and Attend action. Stoopside's RSVP carries guest and child counts and always goes through a preview that lists the outcome before it is confirmed. |

**No Meetup equivalent (no reference invented):** the 24-hour waitlist claim window and its pass-on chain, child counts on RSVPs and the pre-fill from the latest RSVP, post audiences `event_guests` and `hosts_only`, sign-up sheets and swaps, member export, and view-as. These are Stoopside's own rules in the approved proposal.

**References that could not be captured** (all tried on 2026-11-28 UTC; see `reference/sources.json`):

- `https://help.meetup.com/hc/en-us` and every help article: the site answers automated browsers with a Cloudflare bot check ("Just a moment...", HTTP 403). It was not bypassed. These articles would have shown the RSVP, waitlist, guest, event edit/cancel and discussion screens.
- `https://www.meetup.com/nycnonprofit/members/`: redirects to the log-in page. Not captured; no account was used.
- Organizer screens (create, edit, cancel an event; post a discussion; manage members) and the logged-in RSVP and waitlist dialogs need an account.

Proposed alternative for review: accept the four public captures above for discovery, group home and event page, and for the logged-in screens either (a) a maintainer or reviewer opens the help center in an ordinary browser, or (b) the reviewer names public pages or PR attachments to use. I will add whatever the reviewer accepts.

## Ordered sequences

Each step names the control used, the expected and the observed result, and the check in `tests/web-checks.cjs` that asserts it (the manifest records the check that precedes every screenshot). State is read with an Infra `env.snapshot` after each write.

### 1. Group discovery, join and leave

1. Start: [01](screens/01-groups-discovery.png) `#/groups`. One card per group from `groups.list`, with member count and "Request pending" on the run club. Above them, "Waiting for your answer" lists Theo's pending swap ("Theo B. offers you snacks for your coffee urn and cups on Spring cleanup sign-ups. Answer by Tue, Mar 2, 2027, 5:30 PM EST."), linked to its sheet; it also lists waitlist places to claim and RSVPs to reconfirm when there are any. Checks: "group discovery shows a card for exactly the groups groups.list returns" and "the groups page lists what waits for the user".
2. Open the block association: [02](screens/02-group-home.png). Hosts, upcoming event cards ("Wed, Mar 10, 2027, 7:00 PM to 8:30 PM EST", "4 of 10 places left"), posts newest first; Edit only on the user's own posts.
3. Action: Leave group on the community garden. Intermediate: [27](screens/27-leave-confirm.png) inline confirmation that says RSVPs become no and slots are released; nothing written yet (checked).
4. Result after confirming: receipt "You left Elm Ave Community Garden..." kept on the page; membership `left`. Then Join group: [28](screens/28-join-receipt.png), "You joined...", membership `member`.

### 2. Member search and export

1. Start: `#/members/g-block`, one card per member from `members.search`.
2. Action: search "Birdie" (the user's everyday name for Wren Adeyemi). Result: [04](screens/04-members-search-everyday-name.png) "0 members match", same as the tool (error-like path: a routine search that silently finds nobody).
3. Action: search "Wren", then Export members (co-organizer). Result: [05](screens/05-members-export.png), every row of `members.export`, including `birdie.adeyemi@example.net`, the link between the two names.

### 3. RSVP: pre-fill error, cancel and confirm

1. Error path: `#/event/e-0125` (Book fair volunteers, no guests allowed), counts left empty, Preview RSVP. Observed: [06](screens/06-rsvp-error-guest-limit.png) next to the form: "Book fair volunteers allows at most 0 guests per RSVP. The 1 guest was pre-filled from your latest RSVP in this group for Pi Day bake sale, answered Sat, Mar 7, 2026, 8:15 PM EST (guests 1, children 2). Enter a smaller number of guests to continue." The page words tool errors in its own terms (no argument names, RSVP IDs or ISO dates; the code stays in a `data-error-code` attribute). State hash unchanged. This is review item 6.
2. Start: [07](screens/07-rsvp-start.png) `#/event/e-0121`, no RSVP; time "Sat, Mar 20, 2027, 4:00 PM to 7:00 PM EST". Bad input: guests -1, then 1.5, Preview: "Enter the number of guests as a whole number, 0 or more." next to the form, nothing written (browser check; no screenshot).
3. Intermediate: Preview RSVP with empty counts: [08](screens/08-rsvp-preview-prefilled.png). Party of 4 and a note naming the Pi Day bake sale RSVP (guests 1, children 2); Confirm and Cancel. Cancel discards it; no RSVP is written (checked).
4. Action: guests 0, children 0, Preview, Confirm RSVP. Result: [09](screens/09-rsvp-receipt.png) receipt kept after the re-render: "RSVP saved: Going, just you (1 place). Receipt st-notice-0001 for RSVP r-0511." Snapshot: `r-0511` yes, 0, 0. After a browser reload the page and `events.get` both show yes.
5. Error after a result: guests 9, Preview. The earlier receipt is removed when the new action starts, and only the new `guest_limit_exceeded` error shows next to the form (a browser check; no screenshot).

### 4. Waitlist offer and claim

1. Independent update: Infra applies `examples/maple-street-event.json` (m-009 drops out of the full Spring potluck).
2. Start after refresh: [22](screens/22-waitlist-offer.png) "A place was offered to you for you and 1 guest (2 places). Claim by Sat, Mar 6, 2027, 6:20 PM EST."
3. Intermediate: guests 1, children 0, Preview: [23](screens/23-waitlist-claim-preview.png) outcome "Claims the offered place".
4. Result: [24](screens/24-waitlist-claim-receipt.png) "RSVP saved: Going, you and 1 guest (2 places). Receipt st-notice-0006 for RSVP r-0451." Snapshot: `r-0451` yes. The late-claim error (`claim_expired`) is covered by the business tests and the (a) anchors.

### 5. Event edit, cancel and stale confirm

1. Error path: `#/change/edit/e-0140`, venue changed, "Nobody" notified, Preview: [10](screens/10-change-notify-required.png) `notify_required` next to the form, worded "Moving the date, time or venue needs a notice. Choose whether to tell the guests or the whole group."; nothing written.
2. Intermediate: notify "Guests", Preview: [11](screens/11-change-preview-recipients.png) "Venue: Linden Park pavilion (was Elm Ave lot)", every open RSVP notified, 11 yes RSVPs must reconfirm, the 10 recipients by name; Confirm and Cancel.
3. Result: [12](screens/12-change-receipt.png) on `#/event/e-0140`: "Change saved for Spring cleanup. 10 members notified by email. Receipt st-notice-0002." The receipt survives the hashchange re-render and a Refresh. Snapshot: 10 `event_changed` deliveries, equal to the preview.
4. Stale path: preview a description change on `e-0130`; an independent MCP write (`events.preview_change` and `events.confirm_change` over MCP) renames the event; Confirm in the page: [13](screens/13-change-stale.png) `stale_version` next to the preview; the MCP title stays.
5. Create and cancel: a new "Stoop sale" event is created from `#/change/new/g-block` (times stored as `-05:00`), then `#/change/cancel/<id>`: [25](screens/25-cancel-preview.png) says it cannot be undone and sheets lock, and, since nobody has answered, "Nobody has an open RSVP, so no email goes out." (it no longer also says that every open RSVP is notified); [26](screens/26-cancel-receipt.png) result, state `cancelled`.

### 6. Post composer, audience and delete

1. Error paths: `#/compose/g-block` with no text, Preview: "Write the post before you preview it." (browser check). Then text but no audience, Preview: [14](screens/14-post-audience-required.png) `audience_required`, worded "Choose who sees this post: the whole group, the event guests or the hosts."; nothing written.
2. Intermediate: `#/compose/g-block/event/e-0130`, audience preset to the event's guests: [15](screens/15-post-preview-recipients.png) "A post to the guests of June social: planning meeting (moved indoors) (RSVP yes) and its hosts.", 5 named recipients.
3. Result: [16](screens/16-post-receipt.png) on the group page: "Published. 5 members notified. Post p-0307." Snapshot: 5 deliveries, none to `m-027` (Wren Adeyemi, whose send-off it is).
4. Delete: [17](screens/17-post-delete-confirm.png) inline confirmation; "Keep it" leaves the post published; confirming hides it and keeps its 5 deliveries.

### 7. Sign-up sheet

1. Start: [18](screens/18-sheet-start.png) `#/sheet/s-0022`. Full slots show "Full" and no Claim; the user's slots offer Release; Theo's pending swap offers Accept and Decline only (no Withdraw, which only the proposer has); the swap form's Want list has no slot the user holds.
2. Action: Release on the carpool seat: [19](screens/19-sheet-release-receipt.png) receipt kept.
3. Action: Accept swap `sw-0005`: [20](screens/20-sheet-swap-accepted.png). Snapshot: the user holds `snacks` only; `sw-0005` accepted.

### 8. View-as

1. Group home, choose the first member listed (the selector lists hosts and post authors on the page): [03](screens/03-view-as-group.png) "can see this group now", "As of Mon, Mar 1, 2027, 9:00 AM EST" (the tool's UTC time shown in the group's zone).
2. Sheet, choose Theo B.: [21](screens/21-view-as-sheet.png) his slots after the swap, as `visibility.view_as` returns them. The event page selector is checked the same way for `m-016`.

### 9. Not found, read-only, narrow and in-window run

- [29](screens/29-not-found.png) `#/event/e-9999`: page and document title "Not found".
- [31](screens/31-read-only-profile.png) `scenario` profile: no RSVP form, edit, cancel or post links; the page says the profile is read-only. Checked on the group, event, sheet and profile pages. A forbidden management call from the page gets HTTP 403.
- [30](screens/30-narrow-event.png) 390 px viewport, no horizontal overflow (four pages checked).
- [32](screens/32-hillcrest-in-window.png) review item 10: a run at the Hillcrest clock, 2026-11-18 09:00 PST, inside the coverage window (`npm run web:hillcrest`, `web.hillcrest.registry.json`, `scripts/web-fixture.cjs`).

**Clocks.** The manifest seed is Hillcrest, at the shared registry time 2026-11-18 09:00 PST, and a seed never loads at a clock earlier than its history. The sequences above run on Maple St at its clock, 2027-03-01 09:00 EST, because the proposal's examples and anchor tasks are set in March 2027; Infra loads it into the run with `env.load_seed`. The Hillcrest run above is in the coverage window, and `scripts/generate-fixture.cjs --cutoff` builds any fixture at an earlier in-window clock (see the package README, Data).

### 10. Mail delivery

Command: `node apps/stoopside/examples/publish-to-mail.cjs` (from the repository root). It needs the repository-level `examples/registry.mail.json` (Mail 1.3.0 at `examples/apps/mail`), which the Router's trusted config and the Mail clients name. Output of one run: [mail-publish.sample.json](mail-publish.sample.json); the run ID is random, so Router event IDs differ per run.

| Case | Request | Result in Stoopside | Result in Mail |
| :--- | :--- | :--- | :--- |
| Rejected | `router.publish` with request `offer-no-grant`, CloudEvents `id` `st-notice-0001` (waitlist offer), config without a grant for `mail-dana` | `rejected` / `recipient_not_authorized`; Stoopside data hash unchanged, notice not marked published | Mail data and version unchanged |
| Committed | request `offer-1`, same CloudEvent | local commit: notice `st-notice-0001` stored with the offer; receipt `status: committed`, `event_id` `router-...` | receiver commit: `mail.get` with the `event_id` returns the message with the notice's title and text (`thread_id` `st-notice-0001`) |
| Committed (claim receipt) | request `receipt-1`, CloudEvent `st-notice-0002` after the Agent claims `r-0451` | RSVP `r-0451` yes, 1 place | `mail.get` returns the receipt; RSVP ID, counts and start time agree with the RSVP |
| Duplicate | request `receipt-retry`, same CloudEvent `st-notice-0002` | none | `duplicate: true`, same `event_id`; still one message for the notice |
| Unknown | request `fling-receipt-1`, CloudEvent `st-notice-0003`; staged fault: the Router's receipt log is replaced by a directory so it cannot record the acknowledgement after Mail commits (nothing under `runtime/` changed) | RSVP `r-0511` yes stays; the publisher does not mark the notice delivered; a later publish answers `halted` / `run_halted` | reconciliation: `mail.get` with the reported `event_id` finds exactly one message for the notice; the run is stopped and not scored |

Recipient/business confirmation: **N/A**. Every notice goes to the user's own Mail account (`mail-dana`, owned by the same person as `st-dana`); no other person or business has to confirm anything. A committed receipt proves receiver commit only. Deliveries to other members stay in Stoopside's history and are not sent anywhere.

## Commands and results for this delivery

See the PR description for the full reproduction table. Package tests: `cd apps/stoopside && npm test` (61 tests); browser: `node apps/stoopside/tests/web-checks.cjs` (85 checks); platform, replay and Mail scripts as listed in the App README.
