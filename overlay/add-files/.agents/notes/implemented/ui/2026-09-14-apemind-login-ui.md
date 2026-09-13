# ApeMind login UI

The ApeMind plugin owns its connection presentation through the locale dictionary and scoped styles. The three states are signed out, waiting for browser authorization, and connected; workspace data stays rendered from the login controller instead of being inferred by the view. The brand mark is shared with the desktop resource so every surface uses the ApeMind asset.

The public `./types` entry includes a small runtime export and its generated JavaScript in the package file list because the webworker packer resolves package exports at runtime.
