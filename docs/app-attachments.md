# Attachments: implement once, verify the complete workflow

Use public runtime 1.5.0 with the Mail/Calendar 1.3.0 reference Apps. The existing App package layout and business response envelope stay the same. Existing text messages keep their original contract; attachments use an additional capability declaration.

## What a new sender implements

For an order App that emails a receipt, consult Mail's `contribution/contribution.json` and `schemas/router-attachments.schema.json`. Pin the receiver-owned schema, declare the matching `publishes` entry, and implement your own receipt construction. Do not implement another inbox or write Mail state.

The new channel is `channel.email.attachments`, CloudEvents type is `org.pale.mail.attachments.v1`, and payload schema is `urn:pale:email-attachments-payload:1`. Its payload contains the same logical recipient, source object and text body concepts as the text channel, plus `content.attachments`:

```json
{
  "filename": "receipt.pdf",
  "mime_type": "application/pdf",
  "base64": "<canonical base64 of the file bytes>",
  "sha256": "<SHA-256 of those decoded bytes>"
}
```

The placeholders above illustrate fields, not runnable input. For real bytes and a complete message, run `examples/workflows/attachments/run.cjs`; its `message()` function builds the payload from the included synthetic PDF and ICS. Images/audio/video carry the public descriptor's applicable `media` metadata too.

Infra must grant the attachment channel to the destination account explicitly; a text-only grant does not imply file delivery. Messaging validates the matching contracts and invokes Mail's declared `mail.receive_attachments` operation. It does not parse receipts, create calendars or follow arbitrary file URLs. This local profile carries bounded file bytes in the message, so there is no unresolved source-local ID or unauthenticated download URL.

## Who implements each part

| Part | Contributor / platform responsibility |
| --- | --- |
| Sender App | Produce the business file, declare the matching publish capability and invoke the supplied messaging client. |
| Receiving App | Define the receive payload, implement its handler and associate imported IDs with its own business record. Mail demonstrates this in `src/messaging.cjs`. |
| Shared Core | Supply `ctx.assets.add({object_type, object_id, files})` and `ctx.assets.read(asset_id)`; verify encoding/hash/format, apply parent permissions, persist bytes with state and restore the reset baseline. |
| Messaging / Infra | Read declarations, provide trusted run/account bindings and channel grants, deliver through MCP and return the committed receipt. |
| Contributor tests | Exercise domain success and failure with an App-local test context. Fake imports demonstrate business behavior only. |
| Public verifier / CI | Exercise real MCP, actual stored bytes, denied reads/writes, retries, reset and rollback using the exact App package. |
| Reviewer | Check that the approved workflow and real dependency versions are demonstrated, including the receiving App's observable result. |

`ctx.assets` is injected by Core, not imported from a private module. App handlers run on a transaction-local working copy. If one attachment fails validation, neither the new record nor previously staged files commit. Read-only tools cannot import files. Removing a reference revokes reads through that parent; reset removes files introduced after the baseline. Identical bytes may legitimately belong to different runtime records, while fixture duplicate-quality checks remain strict.

## Mail and Calendar behavior

- Mail supports attachment add/remove on drafts, authorized attachment reads, and notifications containing files. Its publisher adapter reads source attachments through the App's authorized interface and transports their actual bytes. The receiver assigns its own parent-scoped IDs.
- Calendar supports attachment add/remove on active events and authorized reads. `calendar.import_ics` creates or updates one event by UID/SEQUENCE and checks conflicts. A Mail attachment does not silently create a Calendar event: the Agent or trusted workflow explicitly calls the Calendar tool under its granted permissions.
- The ICS interchange follows the supported UTC VEVENT subset of [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545). Unsupported properties/components are rejected rather than silently discarded. Export preserves event identity and uses the supplied virtual time for DTSTAMP.
- File operations accept PDF, UTF-8 text, ICS and the existing image/audio/video/JSON formats, subject to the declared media metadata. Each import accepts at most eight files, within the existing per-App 64-asset / 1 MiB decoded bundle budget. PDF bytes are stored/read; parsing/OCR is a separate business tool if an App needs it.

## Run and inspect

```sh
# Full reference verification, with evidence in .artifacts/
npm test

# Complete independent order publisher → Mail → Calendar workflow
npm run example:attachments

# Integrity, unauthorized delivery, rollback, reset and multi-media Mail → Mail
node runtime/tests/attachments.cjs

# Exact App package verification (replace the path for a new App)
npm run app:verify -- --app examples/apps/mail --output .artifacts/mail.json
```

The workflow prints the email/event IDs, file names and hashes, steps and delivery receipt. Verification uses temporary state. A valid test checks exact receiver bytes, not merely that the sender called `router.publish`.

## What belongs in an Environment proposal

Use the existing **App integrations** workstream for the destination App, operation/receive contract to reuse, expected file formats and dependencies. Use **Validation and reset** for observable success/failure: the target inbox contains the receipt; authorized reads return matching bytes; retries do not duplicate it; damaged or unauthorized delivery has no partial effect; reset restores the baseline.

At design review, this is an acceptance plan. At delivery review, attach exact versions, commands and results. The proposal does not need to reproduce Core storage internals, token configuration or the full contributor tutorial.
