# Independent order notification to Mail

The `delivery/` directory is a synthetic send-only publisher fixture, not a complete DoorDash/order-management App. Its own contribution file declares the Email message it publishes. Mail owns the receive schema and handler; Messaging invokes that handler via real MCP.

```sh
npm run example:delivery-to-mail
```

The example verifies a committed receipt, the record observed by the target Mail Agent and idempotent retry. Other receivers/channels are possible only when their contracts and handlers exist; the non-Mail conformance test demonstrates that path separately.

See [App integration instructions](../../../docs/app-integrations.md) before implementing a new sender. Do not copy Mail into the sending App or edit Mail state files directly.
