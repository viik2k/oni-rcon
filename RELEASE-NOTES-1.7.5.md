# ONI RCON desktop 1.7.5

Plug-ins: programs you add that draw their own panel on a new F10 tab.

## New

- **F10 Plug-ins.** A plug-in is a separate program, in any language, that Oni runs on this machine or over ssh. It gets one line of JSON and sends one back. Its panel can hold key-value facts, tables with per-row buttons, text and a log. Its actions become buttons and palette entries (`Name › Action`). The protocol is in [docs/PLUGINS.md](docs/PLUGINS.md).
  - Put its folder in `plugins/` next to the config and name it at the top of the config: `plugins = ["hello"]`. [examples/plugins/hello](examples/plugins/hello) is a working one in a single Python file.
  - **Approval first.** Nothing runs until you approve it. F10 shows what it runs, where, and which RCON commands it may send. Approval is tied to the manifest's hash, so any change to `oni-plugin.toml` asks again.
  - **RCON only by permission.** A plug-in can ask Oni to send RCON commands, but only the ones its manifest lists, and only to servers you have. Everything it sends is logged as `plug-in <id> ▸ command`. A dropped command is shown, with the reason.
  - **Badges.** A plug-in can report ok, warn or alert. Warn turns CONDITION amber and alert turns it red, so a plug-in can raise the alarm even when F10 is shut (it is polled every 60 s). If a plug-in fails, its badge is not counted.
  - **Refresh.** Plug-ins are refreshed when F10 opens, on Ctrl+R, after an action, and every 30 s while F10 is open. One that fails shows its last answer greyed out, with the reason.
  - `--demo` has one (a moderation log with check, go-live and undo).

## Security

- A plug-in runs as you and isn't sandboxed: approve only one you'd run yourself.
- Everything a plug-in sends is drawn as plain text, never markup, and addresses are redacted like the rest of the console.
- Replies are capped at 1 MiB, 500 rows, 10,000 characters per string, 20 actions and 10 params. A view must answer within 10 s and an action within 30 s, or it is stopped.
- Error text from a plug-in has addresses and IDs stripped before it is shown.
- Saving prefs now keeps keys it doesn't know, so approvals survive.

## Upgrading

Desktop installs update in place from the app. Nothing changes until you add a plug-in, and it works with any server version.
