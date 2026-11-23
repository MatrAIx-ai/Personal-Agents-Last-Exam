# Trip alert publisher

A send-only workflow fixture standing in for an airline or travel App that pushes to the user's phone. It is not an airline App. It consumes the pinned `apps/notify/schemas/router-message.schema.json` contract; the workflow checks exact equality to prevent drift. Source identity and the allowed recipient come from the trusted `push-config.json`. It does not write Notify state or bypass the `notify.receive` operation.
