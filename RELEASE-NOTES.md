# ONI RCON desktop 1.12.0

Reach Renaissance servers, through the Source RCON their dedicated server speaks.

## New

- **Reach Renaissance.** ONI RCON manages a Reach Renaissance dedicated server (0.1.32 or later) once its `dedicated.toml` sets an `[rcon]` password. On the setup screen, type the address as `source://HOST`; in the config, add `protocol = "source"` to its `[[server]]`. The station card, F1 and F3 show its game, map and players. Kick, ban, unban, broadcast, end game and round, and the F5 console work, directly or through an ssh tunnel. Its server sends no live feed, so F2 stays quiet for it.

## Upgrading

Desktop installs update in place from the app. Config and plug-ins work unchanged. The terminal console doesn't read `protocol`, so keep Reach servers out of a config it shares.
