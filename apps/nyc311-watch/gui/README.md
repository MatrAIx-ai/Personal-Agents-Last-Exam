# NYC 311 Watch UI

Use the loopback PALE Web Host with this App's staged registry, and a separate
Infra connection to load a seed or inject approved scenario events. The GUI
does not own the clock, database, authorization or a second session state.

Lookup by local ID, borough or as-of status. Open a case and view only fields
known at the current time. Preview, discard, save, edit and remove a private
watch. Refresh to see new cases or local reminders after an Infra operation;
acknowledge a reminder without external delivery. The restricted scenario
profile hides write operations.

The reference NYC311 public lookup uses the original 311 confirmation number.
This sandbox uses deliberately nonfunctional local IDs. Private watch and
activity controls are sandbox features, not a representation of city account
access or a reproduction of a private government page.
