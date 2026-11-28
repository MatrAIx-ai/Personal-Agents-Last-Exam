# Bellnote dataset loading and query demonstration

Produced by `node scripts/dataset-coverage.cjs --retrieval` on the pinned public runtime: Infra loads `fixtures/reference.json` with `env.load_seed` at `2026-11-17T07:00:00-08:00`, then an Agent MCP connection reads every family back through the Bellnote tools, in 120-day windows (the tools' maximum) across 2025-01-01..2026-12-31.

- Loaded data equals the fixture: true. Reads left the data unchanged: true. Agent calls: 103.

| Family | Stored | Retrieved through the Agent tools | Not retrieved, and why |
| --- | --- | --- | --- |
| `schools` | 2 | 2 | – |
| `staff` | 4 | 0 | 4: no Agent tool lists the staff directory; staff appear by name in attendance marks, reviews and notices |
| `children` | 3 | 3 | – |
| `guardian_links` | 6 | 6 | – |
| `pickup_people` | 8 | 7 | 1: the account holder is not custodial for Nico, so pickup.get refuses his list (not_permitted): by the plan's rule a non-custodial guardian learns nothing of that pickup list |
| `restrictions` | 1 | 1 | – |
| `dismissal_changes` | 35 | 35 | – |
| `attendance` | 147 | 147 | – |
| `absence_reports` | 20 | 20 | – |
| `forms` | 28 | 28 | – |
| `form_responses` | 37 | 37 | – |
| `lunch_accounts` | 3 | 3 | – |
| `lunch_transactions` | 276 | 276 | – |
| `menu_days` | 151 | 151 | – |
| `payment_methods` | 2 | 2 | – |
| `payments` | 34 | 34 | – |
| `notifications` | 122 | 122 | – |

## One sample call per tool

| Tool | Arguments | Records returned |
| --- | --- | --- |
| `bellnote.children.list` | `{}` | 3 |
| `bellnote.schools.get` | `{"id":"school-alder"}` | 1 |
| `bellnote.preferences.get` | `{}` | 2 |
| `bellnote.absences.list` | `{}` | 20 |
| `bellnote.forms.list` | `{}` | 28 |
| `bellnote.forms.get` | `{"id":"form-2025-vision"}` | 1 |
| `bellnote.attendance.list` | `{"start":"2025-01-01","end":"2025-04-30"}` | 4 |
| `bellnote.menu.list` | `{"start":"2025-01-01","end":"2025-04-30"}` | 17 |
| `bellnote.payments.list` | `{"start":"2025-01-01","end":"2025-04-30"}` | 4 |
| `bellnote.notifications.list` | `{"start":"2025-01-01","end":"2025-04-30"}` | 14 |
| `bellnote.lunch.account_get` | `{"id":"lunch-theo","start":"2025-01-01","end":"2025-04-30"}` | 16 |
| `bellnote.pickup.get` | `{"id":"child-theo","start":"2025-01-01","end":"2025-04-30"}` | 3 |

Full list of not-retrieved IDs: [dataset-retrieval.json](dataset-retrieval.json).
