# ApeMind login UI

The ApeMind plugin owns its connection presentation through the locale dictionary and scoped styles. The three states are signed out, waiting for browser authorization, and connected. The settings page deliberately stops at authentication state and an external ApeMind Web shortcut; it has no knowledge base, model, or workspace browser. Agents use the bundled ApeMind CLI separately, while humans use ApeMind Web for data and model work. The brand mark is shared with the desktop resource so every surface uses the ApeMind asset.

The public `./types` entry includes a small runtime export and its generated JavaScript in the package file list because the webworker packer resolves package exports at runtime.
