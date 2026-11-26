# Reviewer renderer

`gui/src/view.js` renders escaped, read-only views for human reviewers. It has no controls and is not an interactive GUI. The approved plan lists only this optional read-only renderer, so no GUI is claimed. Agents use the MCP tools.

`render` dumps records. `renderPullThread` shows a pull request with its reviews, comments and timeline. `renderProfile` shows an account, its links and recent public activity. `renderEvidenceSummary` shows counts from an `urn:pale:public-speech-evidence:1` document. Text is escaped before it is inserted. The page has no scripts.
