# Mail to Mail

Two isolated Mail accounts share a run and use separate state roots. The source Agent sends a local draft through its authorized Mail tool; a host-supplied publisher then constructs the receiver's Email contract and calls Messaging. The target Agent reads the committed received record.

```sh
npm run example:mail-to-mail
node examples/workflows/mail-to-mail/run.cjs no_grant
node runtime/tests/mail-to-mail.cjs
```

Cases: `allowed`, `readonly`, `no_grant`, `spoof_source`, `cross_run`, `admin`, `invalid_event`. The checks cover explicit authorization, both sides' state, real MCP discovery, request/event deduplication and changed retries. Run state is temporary. An optional third CLI argument writes a trace to a chosen path.

`router.json` is trusted run wiring, not a second App capability declaration. Both Apps declare their own contracts. A local `sent` record can exist when downstream delivery is denied; there is no atomic outbox. See [integration instructions](../../../docs/app-integrations.md).
