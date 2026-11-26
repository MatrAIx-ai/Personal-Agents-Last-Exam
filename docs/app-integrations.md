# Integrating with existing Apps

Read the destination App's public contracts before implementing an integration. Personal and external Apps are both Apps; deployment category does not determine who may send, receive or mutate state.

## Find the interface you need

| Need | Look at | How to use it |
| --- | --- | --- |
| Query or perform a business action | Receiver `tools.json`, README and `examples/` | An authorized Agent or platform-supplied business client calls that App's MCP tool. |
| Send a notification for another App to receive | Receiver `contribution/contribution.json` → `messaging.receives` → `schema_ref` | Build the receiver's versioned wire message, declare a matching publish capability in your App, then publish through Messaging. |
| Load history, reset or inject a scripted change | Receiver seed/event schemas and Infra interface | Task provides inputs; Infra uses management MCP. Agent and publishing Apps do not acquire these privileges. |

For Mail, start with [tools](../examples/apps/mail/tools.json), [receive declarations](../examples/apps/mail/contribution/contribution.json), [Email payload](../examples/apps/mail/schemas/email-payload.schema.json) and [wire schema](../examples/apps/mail/schemas/router-message.schema.json). For Calendar, start with [tools](../examples/apps/calendar/tools.json) and [events](../examples/apps/calendar/schemas/events.schema.json). Calendar currently has no messaging receiver: do not assume a notification can create a calendar event automatically.

## Record dependencies and the verification path

In your README and proposal, name the existing App, link the exact tool or receive-schema file/version you reuse, and describe the expected change in that App. Distinguish a required dependency from an optional connection. For a required package dependency, pin its `app_id` and `version` in `app.json.dependencies`, and list the same ID in `contribution/contribution.json.dependencies.required_apps`. Supply its package with `app:verify --with PATH`. A scenario-specific recipient belongs in the run assembly; do not turn every possible message destination into a hard package dependency.

Include an integration example/test that invokes the real dependency through its public interface and verifies the receiver's records, files or receipt. An App-only fake client is useful for business tests but does not prove integration. Missing dependencies, incompatible versions/contracts and rejected calls need visible outcomes. If the required receiving capability does not exist, identify that gap for scope review instead of implementing a private copy of the receiving App.

Apply this to every connection claimed as implemented: required dependencies, delivered optional connections, reads through separate Agent calls, and Messaging. The [submission evidence contract](submission-evidence.md#2-demonstrate-declared-app-dependencies) specifies the demonstration: pinned participants, initial states, initiating GUI/MCP action, target account/record/file version, actual receiver result and failure/retry evidence. Keep local commit, delivery and recipient/business confirmation separate. Deferred connections must be labeled deferred, not shown as working integrations.

Proposal reviewers check the dependency choice, interface links and acceptance plan. Implementation reviewers check the pinned packages, actual calls and receiver-side evidence using the [delivery review criteria](review/app-implementation.md).

## Responsibilities

1. **Receiver App:** owns its public payload/operation contract and implementation. It validates accepted content and updates its own business state. Its internal `src/` layout is not a caller's API.
2. **Sender App:** implements its own business action, constructs a compatible message and declares `messaging.publishes`. It does not copy receiver business code or maintain a second receiver state.
3. **Infra:** enables App instances, binds logical recipients to accounts, supplies run/identity/time and explicit grants, and starts the clients.
4. **Messaging:** discovers declarations, checks compatibility and authorization, resolves the configured recipient, calls the declared receiver operation and returns the actual receipt.

```text
Ordering App business action
  → sender-owned notification construction
  → Messaging: declared contract + account binding + explicit grant
  → receiver-owned handler (Mail, another App, or a custom test receiver)
  → receiver state commit + receipt
```

A declaration alone cannot choose a destination or grant access. Contract matching establishes compatibility; the message's logical recipient, enabled run configuration and grant establish the actual route. Ambiguous recipients are rejected, not broadcast.

## Declare only implemented directions

`publishes` and `receives` are independent arrays: send-only, receive-only, both, or neither. Do not register the same directions again in a Router-owned capabilities file. Messaging reads them from the App contribution file.

A declaration identifies `channel`, `event_type`, `schema_id`, `schema_ref`, `payload_schema_id` and implementation status. A receive declaration additionally names `mcp_tool` and `operation`. In this reference host, receiving uses `env.apply_event` with a declared App event handler; only the trusted runtime invokes that management operation.

The wire message uses the CloudEvents 1.0 JSON envelope. PALE's current routing profile expects `data.channel`, `data.recipient` and `data.source_object`; the rest of the payload belongs to the receiver. This profile, account grants and the MCP `message` argument are PALE conventions, not an official CloudEvents-over-MCP binding. AsyncAPI is not required.

For Email, the receiver-owned payload and common envelope generate the wire-schema copies. Run `npm run contracts:check`; use `contracts:build` only when intentionally regenerating them. Matching version IDs must also have matching schema content. A receiver contract change requires version review; do not silently modify another App's public format.

## Examples and proof boundaries

| Example / test | What it proves |
| --- | --- |
| [Delivery → Mail](../examples/workflows/delivery-to-mail/README.md) | An independent, send-only order-notification fixture delivers through MCP to real Mail. It is not a complete ordering service. |
| [Mail → Mail](../examples/workflows/mail-to-mail/README.md) | Two isolated accounts, source business send, explicit recipient grant, actual target read, rejection and retries. |
| [Non-Mail conformance fixture](../runtime/tests/fixtures/non-mail/README.md) | A custom channel reaches Noticebox's own handler and item state; no Mail instance is involved. It is not a production Messages/Push App. |
| Messaging direction tests | Send-only, receive-only, both and neither derive from App declarations. |
| Calendar event checks | Infra applies a scripted calendar update; this does not create a Calendar messaging capability. |

To add Messages, Push or another destination, implement that receiving App and its contract, then test its actual state and failures. The Router must not contain destination-specific business logic.

## Completion, failures and time

A local order commit or Mail `sent` state does not prove downstream delivery. Await the receiver's committed receipt. Rejected delivery leaves receiver business state unchanged; an unknown acknowledgement stops the run for reconciliation. The current implementation has no atomic outbox, crash recovery queue or cross-App transaction.

Preserve optional CloudEvents `time` as producer-reported event time. Core and Messaging separately record reception/application/acknowledgement metadata. Missing source time stays absent. Use event IDs, run/account binding and state versions to correlate, not host clock comparisons alone.

Local stdio identity is fixed by the trusted launcher. A source field, an internal/external label or an Agent argument does not authenticate a caller. Production HTTPS/OAuth, restricted delivery credentials and network controls require Infra deployment work; changing App schema is not a substitute for them.

## File-bearing workflows

See [attachment implementation and verification](app-attachments.md) for the receiver-owned contract, `ctx.assets` interface, Mail/Calendar tools, runnable example and the exact proposal fields to fill. Run `npm run example:attachments` from the repository root.
