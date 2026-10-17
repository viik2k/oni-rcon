# ONI RCON desktop 1.7.6

Plug-ins can draw their own page, the layout is yours to resize, and Oni has a new mark.

## New

- **Plug-in pages.** A plug-in can send an `html` block: a page of its own, drawn inside its F10 panel. It gets its `data` (redacted like the rest of the console), the server name and the console's theme colours. It can ask back for a refresh, a height, or one of the actions its view already offers, with the same confirms. See the "html block" section of [docs/PLUGINS.md](docs/PLUGINS.md). The `--demo` plug-in has one: a per-server chart with check, go-live and refresh buttons.
- **Scrollable tab bar.** When the F-key tabs don't fit, the bar scrolls (the mouse wheel works too) and keeps the open tab in view.
- **Fold and resize the sidebar.** `«` at the left of the tab bar folds the server list away and `»` brings it back. Drag its right edge to resize it, and double-click the edge to reset it. Both are remembered.
- **Resizable panels.** Drag the gap between any two panels to resize them. Double-click the gap to reset.
- **New logo.** An animated ONI-RCON mark and wordmark in the masthead. It stays still if your system asks for reduced motion.

## Fixes

- Plug-in table actions follow the selected row by its id, so a refresh that reorders the rows can't act on a different one.
- Plug-in views are asked for again when the server changes, even mid-request.
- The plug-in panel no longer clips its title.
- The demo plug-in's undo sends the player's name, not the row id.
- F10 at boot goes straight to Plug-ins, and the footer's tab hint includes F10.
- Dialogs show a numeric default in the form. In a pick list, ArrowDown can't move past the end when nothing matches.
- Setup rejects a typed max players of 0.
- The rotation marker matches map and mode, and falls back to the map alone.
- The restart after a settings save goes to the server that saved, even if the selection has moved.
- The log is capped at 5000 lines. Reconnecting clears the stale banner, alert timer and toasts.

## Security

- A plug-in page runs in a sandboxed frame with its own content policy. It has no network, no storage, and no access to the console window or its commands. Its only way into Oni is messages. It can't send RCON or run an action its view doesn't list, and it can't act while a dialog is open.
- With redaction on, IPv4 addresses are hidden in the page itself before it's served.
- Every other block is still drawn as plain text, never markup.

## Upgrading

Desktop installs update in place from the app. Existing plug-ins work unchanged. `html` is optional and is drawn only by 1.7.6 and later.
