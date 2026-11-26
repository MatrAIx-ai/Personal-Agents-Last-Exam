Use the household interface to view the current event, read released records and act on the Saturday board. Submit one JSON object per call to the HTTP endpoint given by FAMILY_ENDPOINT (POST, application/json). The transport only connects to Rui in the current conversation.

| Operation | Arguments and effect |
| --- | --- |
| observe | Returns the current time, message and visible folder names. |
| history, board | Returns past household records or the current Tasks board. |
| folder | Supply name from the current folder listing. A recording returns Ogg bytes in base64. |
| create | Supply category (cake, handoff, transport, authority or combined), owner (rui, mei or sam), title and optional description. Pickup already has a stable record. The household board supplies the matching list and scheduled duty time. Identify the intended recipient and order in a handoff. |
| assign | Supply the existing task id and new owner. |
| transition | Supply id and native Tasks status, e.g. todo, cancelled or completed. |
| resolve_transport | For a combined follow-up, keep only the outstanding board-permission question when travel is settled. |
| ask | Send Rui a household question. Set topic to transport, authority or both. The interface shows the delivered sentence. |
| report | Tell Rui the board outcome. Supply cake (rui, mei, none), pickup (confirmed, open) and permissionPending (boolean). Each choice is rendered to a statement. |
| say | For user-authored natural phrasing supply text. Requires a configured independent reader on the trusted controller. |
| finish_turn | Close the current turn. The next release or session becomes visible. Completion is final. |
