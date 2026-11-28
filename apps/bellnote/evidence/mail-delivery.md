# Bellnote → Mail delivery demonstration

Produced by `node scripts/mail-flow.cjs --transcript evidence` from the repository checkout: real Bellnote and Mail MCP servers, real Core and the real Messaging router, each case in its own run. Raw data with every request and receipt: [mail-delivery.json](mail-delivery.json). Wall-clock times are replaced by `<wall-clock>`; everything else is as returned.

## Revisions, contract and binding

- Bellnote 1.0.0 (Core API 1.2.0), Mail 1.3.0 (Core API 1.2.0), public runtime 1.6.0.
- Contract: channel `channel.email`, wire `urn:pale:email-message:2`, type `org.pale.mail.notification.v1`, payload `urn:pale:email-payload:1`, receiver operation `mail.receive_notification`. Wire schema sha256: Bellnote `74d5a4b4406b7ac1…`, Mail `74d5a4b4406b7ac1…` (identical).
- Direction and caller: Bellnote publishes, Mail receives; the caller is the Infra-run sender src/publisher.cjs with Bellnote's Infra connection and a router publisher connection fixed to bellnote-maya.
- Binding: Bellnote account `bellnote-maya` and Mail account `mail-maya`, both owned by `person-maya`; recipient `{"kind":"person_ref","id":"person-maya"}`; Infra grant `{"app_id":"mail","account_id":"mail-maya","channel":"channel.email"}`.
- Each run starts from the reference fixture, turns email copies on with `bellnote.preferences.update` (the call the GUI's Account → Edit preferences makes) and applies the plan's `school.day_changed` example event, which writes one notification with its wire message. Infra then moves Mail's clock to the event time with `env.advance_time` before the sender runs.

Three outcomes are kept apart below: **local commit** (Bellnote stored the notification and its wire message), **receiver delivery/commit** (Mail stored the message, with Mail's own committed event receipt) and **recipient or business confirmation** (someone read or acted on it). No case shows the third: a receipt or a stored inbox message does not mean the guardian read it.

## Cases

| Case | Local commit in Bellnote | Router result | In Mail | Bellnote after |
| --- | --- | --- | --- | --- |
| delivered | event `ev-bn-160` committed at {epoch 2, revision 2}, notification `ntf-0035` | committed, event `router-278e1a661e6098fec780e6e79f7b5289` | message `router-278e1a661e6098fec780e6e79f7b5289` in `inbox` of `mail-maya`; inbox 2 → 3, Mail {epoch 1, revision 1} → {epoch 1, revision 2} | unchanged at {epoch 2, revision 2} |
| email_notices_off | event `ev-bn-160` committed at {epoch 2, revision 2}, notification `ntf-0035` | not sent (`email_notices_off`) | no record; inbox 2 → 2 | unchanged |
| denied | event `ev-bn-160` committed at {epoch 2, revision 2}, notification `ntf-0035` | rejected `recipient_not_authorized` | no record; inbox 2 → 2 | unchanged |
| mail_missing | event `ev-bn-160` committed at {epoch 2, revision 2}, notification `ntf-0035` | rejected `recipient_unavailable` | Mail not in the run | unchanged |
| incompatible_contract | event `ev-bn-160` committed at {epoch 2, revision 2}, notification `ntf-0035` | rejected `incompatible_contract` | no record; inbox 2 → 2 | unchanged |
| unknown_outcome | event `ev-bn-160` committed at {epoch 2, revision 2}, notification `ntf-0035` | unknown `receiver_unconfirmed`, event `router-d82f422ed651daa2d10ea8c93216355b` | Mail receipt committed for `router-d82f422ed651daa2d10ea8c93216355b`; inbox 2 → 3 | unchanged |

## The delivered message

- Request: `router.publish` with request ID `bellnote-2-ntf-0035`, CloudEvents id `ntf-0035` (the Bellnote notification ID), source `urn:pale:app:bellnote:account:bellnote-maya`, source object `{"app_id":"bellnote","account_id":"bellnote-maya","object_type":"school_day","object_id":"day-alder-2026-11-20"}`.
- Receipt: committed, target `{"app_id":"mail","account_id":"mail-maya"}`, event `router-278e1a661e6098fec780e6e79f7b5289`, Mail version {epoch 1, revision 2}, applied at virtual time `2026-11-18T13:05:00-08:00`.
- Mail's own event receipt (`env.event_status`): committed.
- In Mail (`mail.get` on the Mail Agent connection): message `router-278e1a661e6098fec780e6e79f7b5289`, folder `inbox`, subject "Alder Elementary: early dismissal at 12:30 on Friday, November 20", read false.
- Identical retry: the first receipt, marked duplicate; inbox stays at 3.
- Same request ID with a changed title: rejected `idempotency_conflict`; inbox stays at 3.

The unknown-outcome case uses one test double: the router's connection to Mail throws after Mail's `env.apply_event` has returned, as if the acknowledgement were lost. The router reports `unknown` with the attempted event ID, Mail's receipt shows the commit, and the router halts the run so a retry is not sent again before reconciliation. Bellnote never rolls back, and no cross-App transaction is assumed.
