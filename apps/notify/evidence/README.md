# Notify GUI evidence

Review evidence for [#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191), following [submission evidence](../../../docs/submission-evidence.md) section 1. These files are not runtime assets and are not part of the App's media bundle.

## Reference products

Public documentation pages, accessed 2026-11-27. They are linked rather than captured: their screenshots belong to the vendors, and Notify copies their workflows, not their branding or layout.

| Reference | Workflow it illustrates | Notify counterpart |
| --- | --- | --- |
| [Apple Reminders](https://support.apple.com/guide/reminders/welcome/mac) | Create a reminder with a time, edit it, and see scheduled, completed and deleted reminders in separate lists | Upcoming, Fired and Cancelled; New reminder, Edit reminder, Cancel reminder (steps 1–7) |
| [Google Calendar event notifications](https://support.google.com/calendar/answer/37242) | An alert a set number of minutes before an event | The Calendar fields in New reminder (step 2); the seeded "Design review in 15 minutes" reminder (step 10) |
| [iPhone notifications and Focus](https://support.apple.com/guide/iphone/intro-to-notifications-iph7c3d6f7bf/ios) | Notification Center lists what reached the phone; Focus delivers notifications quietly | Lock screen with "arrived silently" items and Mark read (steps 8–9); a reminder silenced inside Work focus (step 10) |
| [ntfy](https://github.com/binwiederhier/ntfy), [Gotify](https://github.com/gotify/server) | Other services push messages to one device feed | Pushes from `order-notifier` and `bank-alerts` in the Lock screen feed (step 8) |

## Implementation run

- App: Notify 1.0.0 at the commit submitted with `/submit-implementation`, served by `node runtime/web/server.cjs --app notify --registry registry.notify.json --run evidence --profile sandbox`, with the shipped `fixtures/` (account `notify-maya`, synthetic).
- Browser: the Chromium-based browser pane of the Claude desktop app on macOS, viewport 1280×800, browser time zone America/Chicago. The phone's time zone is America/Los_Angeles, so times on the page are Pacific. The run clock is 2026-11-18 09:00 Pacific.
- Screenshots are scaled to 800×500.

## Ordered demonstration

| Step | Action | Expected | Observed |
| --- | --- | --- | --- |
| 1 | Open the page ([01](01-upcoming.jpg)) | Two scheduled reminders, shown on the phone's clock | Pantry at Nov 18, 5:30 PM and plants at 11:00 PM, both Pacific |
| 2 | New reminder: title, details, Nov 19 12:30 in the browser's time zone ([02](02-create-form.jpg)) | The form takes a browser-local time | As expected |
| 3 | Submit ([03](03-created.jpg)) | `notify.reminder.create` commits; the reminder is Upcoming at 10:30 AM Pacific | "Reminder scheduled."; Upcoming shows 3 |
| 4 | Edit reminder: change only the title ([04](04-edit-form.jpg)) | The time field starts empty so the time is kept | As expected |
| 5 | Save ([05](05-edited.jpg)) | New title, still Nov 19, 10:30 AM | As expected |
| 6 | Cancel reminder ([06](06-cancel-confirm.jpg)) | A confirmation names the reminder | As expected |
| 7 | Confirm ([07](07-cancelled.jpg)) | It moves to Cancelled; Upcoming is back to 2 | Cancelled shows 2 |
| 8 | Open Lock screen ([08](08-lock-screen.jpg)) | Newest first; pushes from two senders and two reminders; silent arrivals marked | As expected; unread items have Mark read |
| 9 | Mark read on "Your order shipped" ([09](09-marked-read.jpg)) | `notify.feed.mark_read` commits; the button turns into Read | As expected |
| 10 | Fired → the prescription reminder ([10](10-fired-silenced.jpg)) | Fired at 2:00 PM inside Work focus, so it reached the phone silently | "Arrived silently", "Nov 13, 2:00 PM (silently)" |
| 11 | New reminder with a time before the run clock ([11](11-rejected-past-time.jpg)) | Rejected; nothing is created | "The reminder time has already passed."; the form stays open |
| 12 | Reload the page, open Cancelled ([12](12-after-reload.jpg)) | The changes come from stored state | The edited, cancelled reminder is still there |

The same transitions are covered without a browser by `tests/business.test.cjs` (create, update, cancel, mark read, rejected past time, silence inside focus) and by the verifier's real-MCP stages. The page shows times in the device time zone; a business test checks this with a browser in another zone.

## Differences from the references

- Focus, silence and dismissal are user actions applied by Infra events (`notify.focus.set`, `notify.device.silence`, `notify.feed.dismiss`), because the Web Host connects as the Agent. The page shows their result, such as "arrived silently" and "dismissed", but has no controls for them. See "Interfaces adjusted to runtime 1.6.0" in [validation.md](../contribution/validation.md).
- The form's date fields come from the shared Host form and take the browser's local time, as their hint says. Everything the page displays uses the phone's time zone.
- The count beside the Lock screen heading is the Host's reminder counter, so it stays 0 there. The sidebar hides it for that section.
