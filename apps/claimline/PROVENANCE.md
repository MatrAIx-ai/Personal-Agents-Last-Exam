# Provenance

Claimline implements the first runnable milestone of PR #42. The approved
proposal is unchanged. Business handlers and UI are original MIT code; the
launcher, Core envelope and public contract copies follow PALE's MIT examples.
No receiving App implementation is copied or imported into business code.

SAP Concur is a workflow and visual reference only:
[Expense overview](https://help.sap.com/docs/concur-expense/concur-expense-standard-edition-end-user-help/expenses-and-reports-overview).
No SAP screenshots, logos, source code or actual employee records are bundled.

The fictional company, trip, ten expenses and electronic originals are authored
by `scripts/build-package.py`. Original synthetic records and text assets are
dedicated to the public domain under CC0-1.0. Saved originals intentionally retain
identical source bytes under separate resource parents. No external collection,
API keys, paid models or live financial service is used.

New resource parent mappings in `runtime/registrations/claimline.json` and the
optional local stylesheet route require platform review with the contribution.
Mail/Files are accessed through public tools; the connected example verifies
actual receiver records and original-byte readbacks.
