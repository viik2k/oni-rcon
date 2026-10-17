# Plug-in engine: where it stands and what to build on it

Companion to [PLUGINS.md](PLUGINS.md) (the protocol) and [PLUGINS-BUILD.md](PLUGINS-BUILD.md) (the build brief). This file
says what the engine in desktop 1.7.6 can and can't do, the small changes that would unlock more, and plug-ins worth writing.

## What the engine does today

- **Service mode only.** Oni runs `exec` (locally, or over ssh with `host`) once per request: one JSON line in, one JSON
  object out. Timeouts are 10 s for `view` and 30 s for `action`. A session manifest is listed, disabled.
- **Blocks:** `kv`, `table`, `text`, `log`, and `html` (desktop only). A view with an html block shows only its html
  blocks in the desktop app; the other blocks stay as the terminal console's fallback.
- **Pages** run in a sandboxed frame (opaque origin, no network, no storage, no forms). They get `data`, the server
  name, the redaction flag and the theme colours, and can post back `action` (one of the view's own), `refresh`,
  `height` and `ready`.
- **RCON** goes only through an action's `rcon` reply, filtered by `permissions.rcon` and the config's server names.
- **Badges** of `warn` and `alert` raise CONDITION to AMBER and RED. Views refresh on open, on Ctrl+R, after an action
  and every 30 s while F10 is open; a plug-in with a badge is polled every 60 s while the console is open.

## Limits that shape what a plug-in can be

1. **No live data from Oni.** A view request is only `{"type": "view", "server": "3"}`
   ([lib.rs](../desktop/src-tauri/src/lib.rs), `plugin_view`). Players, the feed, the map and the scores never reach a
   plug-in, so it has to read its own: the server's logs and files over ssh, an API, or a file next to itself.
2. **The page can't fetch or remember.** Fetching and storage belong in the `exec` process, which has both.
3. **The page unmounts when F10 closes** ([App.tsx](../desktop/src/App.tsx) renders `<Plugins />` only on that tab), so
   its timers stop. A countdown or auto-broadcast can't outlive the tab.
4. **RCON is send-only.** A plug-in can ask Oni to send a command but never sees the reply.

## Engine additions, smallest first

| Change | Unlocks | Size |
|---|---|---|
| **Snapshot in the view request**: `"snapshot": {"players": [...], "map": "...", "mode": "...", "score": [...]}`, redacted like the UI | Team balancer, AFK list, live stats, per-player tools without log parsing | ~10 lines in `plugin_view`, plus a PLUGINS.md line; both hosts |
| **`"persist": true` on an html block**: keep the frame mounted while F10 is closed | Countdowns, scheduled broadcasts, timers in the page | Keep `<Plugins />` mounted and hidden instead of unmounted |
| **RCON replies**: return each sent command's reply text to the page or in the next view request | Plug-ins that query (`status`, ban checks) and react | Medium: thread replies back through `plugin_action` |
| **Session mode**, as already specified | Rules engine, join MOTD, AFK kicker, recorders | Large: process supervision, event filter, backoff |

## Plug-ins to build

### Now: one script, no data source

| Plug-in | Page | Permissions |
|---|---|---|
| **Broadcast board** | A grid of buttons from `messages.toml` ("Rules", "Join the Discord", "Restart in 5"); one click sends it | `rcon: say` |
| **Quick map launcher** | Map tiles with embedded thumbnails (about 24 small JPEGs fit the 512 KiB cap) and a mode pick; a click loads it | the map-load command |
| **Admin handover log** | A text box and timestamped notes, kept in a file next to the plug-in | none |
| **Callout maps** | A static reference page: Halo 3 maps as SVG with callout names | none |
| **Discord announce** | Type once: posted to a Discord webhook from `exec` and sent in-game | `rcon: say` |
| **Event countdown** | Reads `events.toml`, counts down to the next scrim or event, with ANNOUNCE | `rcon: say` |

### Soon: reads the game box over ssh

| Plug-in | Source | Notes |
|---|---|---|
| **Log search** | grep over the dedicated server logs | Text param, table of matches; row action kick or ban |
| **Report queue** | `!report` / `!admin` lines in the chat log | Badge `warn` while any are open |
| **Population chart** | join and leave lines | html chart of players by hour and weekday |
| **Stats ladder** | kill lines | K/D and medals per player, season reset |
| **Box panel** | `df`, `uptime`, `systemctl status`, `docker ps` | Disk, CPU and services; restart-service action (danger). Health covers memory and OOM |
| **Config snapshots** | `dedicated.toml`, playlists, ban list | Diff since the last snapshot; restore behind a confirm |
| **Uptime Kuma** | Kuma API from `exec` | Uptime bar per server; badge `alert` when one is down |
| **Forge watch** | ReclaimerForge API | New versions of installed maps, new uploads from followed authors; badge `warn` |

### After the snapshot or session mode

- **Team balancer** and **AFK list** (snapshot).
- **Rules engine**, **join MOTD**, **AFK kicker** (session mode).

Gryphon (moderation) and Loadout (Megalo deploys) already have plug-ins.
