# Non-Mail routing conformance fixture

`sender/` is a publish-only declaration. `noticebox/` is a minimal receive-only App with its own item state, tools, event handler and `channel.test-notice` contract. It is a test fixture, not a supported Messages or Push product. The message format belongs to this receiver; it is deliberately not Mail's Email payload.

Run `node runtime/tests/non-mail-routing.cjs` from the repository root. The test starts real MCP publisher and receiver connections, verifies the Noticebox state, denied delivery, retries and tracing, and asserts that no Mail state is created. The runtime and existing Mail/Calendar schemas are unchanged.
