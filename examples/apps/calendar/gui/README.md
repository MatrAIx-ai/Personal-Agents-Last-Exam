# App renderer

`src/view.js` renders authorized App records and is referenced by `contribution/gui.json`. The platform reviewer UI supplies layout, controls and connections. This renderer does not maintain state and is not a standalone web server. Local business tests do not exercise the platform UI.
