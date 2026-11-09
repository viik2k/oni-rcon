# ONI RCON desktop 1.13.0

Reclaimer 0.10 commands, a restart that waits for the game to end, and honest replies from Reach Renaissance servers.

## New

- **Reclaimer 0.10.** On a server running Reclaimer 0.10 or later, KICK asks how long to block rejoining, MUTE asks what to silence (text, voice or both) and offers a shadow mute, TEAM COUNT goes up to 64 teams, and F3 MATCH has NEXT GAME and REPLAY. The F5 console suggests `next`, `replay`, `health`, `mutes`, `queue` and `immune`. Older servers get the old commands, unchanged. ([#52](https://github.com/viik2k/oni-rcon/pull/52))
- **Restart after this game.** While a game is on, RESTART SERVER asks AFTER THIS GAME or NOW. After this game warns players in chat, shows `↻ AFTER GAME` on the server's card, and restarts once the game ends or the server empties. Press RESTART SERVER again to cancel or restart now. Keep the app open while a restart is pending. ([#51](https://github.com/viik2k/oni-rcon/pull/51))

## Fixed

- **Reach Renaissance.** A `say` that nobody saw because match chat wasn't up now shows as failed with the server's reason, not as sent. The F4 ban list, and the map and mode pickers, now fill in on a Reach server. ([#50](https://github.com/viik2k/oni-rcon/pull/50))

## Upgrading

Desktop installs update in place from the app. Config and plug-ins work unchanged.
