# ONI RCON desktop 1.8.0

Plug-ins can stay running, hear the servers, read the answers to their RCON, and update themselves from git.

## New

- **Session plug-ins.** A plug-in with `mode = "session"` runs as one long-lived process beside the console. It gets the events its manifest asks for, can send RCON and hear the reply, and can push its view, toasts and log lines at any time. If it dies, Oni restarts it (1 s, doubling to 60 s). F10 shows whether it's running. [examples/plugins/greeter](examples/plugins/greeter) is one: it welcomes each player who joins and answers `!rules`.
- **Plug-in updates from git.** A plug-in installed with `git clone` into `plugins/` is checked for new commits each time the app starts, on a window reload, and on Ctrl+R in F10. When there are some, F10 marks it ▲ and asks once whether to update, showing the commits and where they came from. UPDATE fast-forwards the folder and restarts the plug-in. Oni doesn't restart. A plug-in's author releases by committing to `main`.
- **RCON replies.** What a server answers goes back to the plug-in that asked: at once to a session or a page, and in the next view request (`replies`) to a service plug-in. Plug-ins can now query (`status`, ban checks) and show the answer.
- **Pages can do more.** A plug-in page can send RCON within its permissions, `call` its own `exec` to fetch or store data, and hear the events its manifest lists. With `"persist": true` a page keeps running, hidden, while F10 is closed or another plug-in is shown.
- **Server snapshot.** View and action requests carry the selected server's players, map, mode and team scores.
- A plug-in with its own page shows only that page. Its other blocks are its fallback for the terminal console.

## Security

- Every RCON a plug-in sends, whether from an action, a session or a page, is filtered by its `permissions.rcon` and the config's server names. Each one is logged.
- Events, snapshots and replies have addresses blanked unless the manifest grants `permissions.addresses`.
- Updates never prompt for a login, and never show the login part of an https remote. A folder with its own commits or edits isn't touched. A changed manifest needs approving again; read what changed if you don't know the author.

## Upgrading

Desktop installs update in place from the app. Existing plug-ins work unchanged. To be offered a plug-in's updates, install it with `git clone` (git must be on PATH). See [docs/PLUGINS.md](docs/PLUGINS.md) for the session protocol and the new page messages.
