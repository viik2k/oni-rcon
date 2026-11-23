# ONI RCON desktop 1.16.0

Four more Reclaimer server settings you can now change from the console, plus a playlist check that accepts everything the server does.

## New

- **Combat bots.** F3 › SERVER › COMBAT BOTS sets how many fighting bots a Reclaimer 0.10.6+ server's multiplayer games have, and how many of them fly or drive the map's vehicles. Bots take player places and always leave at least one for a person. ([#68](https://github.com/viik2k/oni-rcon/pull/68))
- **Campaign.** F3 › SERVER › CAMPAIGN puts a 0.10.7+ server on a co-op campaign (Halo 3, CE, Halo 2, ODST, Reach or a mod's) from a mission and at a difficulty you pick. SWITCH PLAYLIST puts it back on multiplayer. ([#69](https://github.com/viik2k/oni-rcon/pull/69))
- **Hit check and stalled joins.** F3 › SERVER › HIT CHECK chooses what a 0.10.8+ server does about impossible shots (log and report, remove the player, or nothing). STALLED JOINS asks a player whose join has stalled to join again. ([#70](https://github.com/viik2k/oni-rcon/pull/70))

## Fixed

- **Playlists.** The playlist check and editor now accept every field Reclaimer documents: lobby sizes, vote-time curves, co-op campaign and Firefight entries, start-together settings, and 1 to 256 games. Editing a playlist no longer drops a curve or lobby sizes. ([#71](https://github.com/viik2k/oni-rcon/pull/71))

## Under the hood

- In-range dependency updates (npm, cargo, uv). ([#72](https://github.com/viik2k/oni-rcon/pull/72))

## Upgrading

Desktop installs update in place from the app. Config and plug-ins work unchanged.
