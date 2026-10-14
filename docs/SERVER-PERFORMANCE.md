# Is my server lagging? A plain guide

How the **F7 HEALTH** tab shows how smoothly each Halo 3 server runs, and what to do when it doesn't. You don't need
to know anything technical to use it.

Adapted from the guide in [ibigsnet/oni-rcon](https://github.com/ibigsnet/oni-rcon) by RifleJock.

## The short version

- A server updates the game **60 times a second**. Each update is a **frame**.
- If it can't keep up, players see **lag**: rubber-banding, shots that don't register, people jumping around.
- F7 shows each server's frame rate. **Green is fine, amber is slipping, red is laggy.**
- Next to the table, **WHAT'S HAPPENING** and **WHAT TO DO** explain the selected server in plain words. Pick a
  server with the arrow keys.
- A server that is falling behind also shows its frame rate on its card in the left-hand list (for example `38fps`),
  and **SERVER FPS** is a line in the F3 sitrep.
- The feed says so, once, when a server drops under 40 frames a second, and once when it has kept up again for 3
  minutes. These are quiet notes: no banner, no chime.

## Reading the FRAME RATE table

| Column | What it means |
|---|---|
| **FPS** | Frames a second over the latest minute. 60 is perfect. Under 54 players start to notice; under 40 it's clearly laggy. |
| **5 MIN** | The average over the last five minutes, so one bad moment doesn't look like a disaster. |
| **WORST** | The slowest it got in those five minutes (the average over its slow seconds). |
| **LONGEST** | The longest single pause. Over 50 ms is a hitch players can feel. |
| **PLAYERS** | How many were on when it slowed down. |
| **LAST SLOW** | When it last fell behind. "none" means not in the last half hour. |

## The chart

**FRAME TIME** shows the last 30 minutes, one column per minute.

- A **bar** is how long a frame took on average that minute. Short and green is good.
- The **dashed line** marked "60 fps" is the target. Bars that rise above it mean lag.
- The amber **tick** on each bar is that minute's longest pause.
- Hover a bar for the numbers.

## Why "more cores" usually doesn't help

The game does almost all of its work on **one processor core**, and Wine (the layer that lets this Windows game run on
Linux) is also mostly a one-core program. A machine with 88 cores can still lag if each core is slow, because one busy
lobby only gets to use about one of them.

- **Faster cores help.** A recent desktop CPU runs a big lobby much better than an older server CPU with many slow cores.
- **Fewer players help.** Every player adds work to that one core.
- **More cores don't help a single lobby.** They let you run *more lobbies* side by side.

## How many players can my server handle?

It depends on the CPU, the map and the game mode, so find your own limit: watch F7 while the lobby fills.
**WHAT'S HAPPENING** says the smallest crowd it has fallen behind with in the last 30 minutes ("as few as 64
players"). Set the player cap a little below that. Heavy mods need far fewer players than a plain map.

If it is slow but the machine is not busy, check the host's memory (HOST on F7), the network, and any heavy map or mod
in the rotation.

## Where the numbers come from

The server writes a line to its log for every minute it spends under 54 frames a second:

    Server falling behind: under 54 frames a second for 58 of the last 58 seconds (29 on average, longest frame 125 ms) with 85 players.

oni-rcon reads those lines through your `health_cmd`, so **`health_cmd` has to print the server's log**
(`docker logs --timestamps ...`; the [README](../README.md#health-watch) has an example). A minute with no such line
kept up, so it counts as 60. That makes a minute's rate a slight overestimate (a "fine" second can be 55), never an
invented slowdown. Nothing else says how fast a server runs: RCON and `status.json` don't.

Nothing here slows a server down: it only reads the log the server already writes.
