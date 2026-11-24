# Order receipt → Mail → Calendar

Run `npm run example:attachments` from the repository root with Node.js 18+. No installation or external accounts are required.

The independent delivery publisher sends the included synthetic `receipt.pdf` and `delivery.ics` through Messaging. Mail commits the notification and bytes together. An Agent reads both files, imports the delivery window into Calendar and attaches the receipt to the new event. A repeated notification produces one email and one set of imported files.

`run.cjs` exports `message()` to show a complete valid message, and prints a compact result with IDs, hashes, delivery receipt and verified steps. `config.json` is trusted example configuration with an explicit attachment-channel grant. Temporary state is removed after the run.

Both fixture files were generated for this example and contain no personal records or third-party assets. Code and synthetic fixture files use the repository's MIT license.

See [the implementation and verification guide](../../../docs/app-attachments.md) for the exact contract, ownership and contributor review workflow.
