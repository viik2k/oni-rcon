# ONI RCON desktop 1.7.0

Telegram alerts for automation rules, pardoning kicked players, and config edits that apply without a restart.

## New

- **Telegram for automation rules.** A new **Post to Telegram** THEN step sits beside Post to Discord, and a **TELEGRAM** button in the automation hub sets a bot up.
  - Paste the @BotFather token, pick the chat from the ones the bot has recently heard from (or type a chat ID or @channel), and name it. **SEND A TEST MESSAGE** checks it, and a refusal says why (revoked token, bot removed from the chat, rate limit).
  - The bot token is kept in `telegram.json` beside the config, readable only by you. The window never sees it, only the bot number and chat. Errors are stripped of their URL, since the token is part of it.
  - Posts are plain text with no link previews, paced 3 seconds apart. The ready-made templates that post to Discord post to Telegram instead when a chat is all you've set up.
  - One-way: the bot sends, it takes no commands. Setup and limits are in [docs/AUTOMATION.md](docs/AUTOMATION.md#telegram).
- **Pardon a kicked player (server 0.9.16+).** **F4 Blacklist** now lists who was kicked and how long they're still out. **PARDON** lets one rejoin now. The terminal UI gets the same with `o`, and the demos answer pardon too.
- **Config edits apply live (server 0.9.18+).** After you save capacity, playlist or per-server admin edits to `dedicated.toml`, the console sends `reload` and shows the server's own what-changed reply, instead of offering a restart that drops everyone. Older servers keep the restart path, and the notes and help say which applies.

## Fixed

- **FIND SERVERS ON IT** now adds a server that sets its own `rcon_password` in its `[[server]]` block. It was listed but not added ("put it in the config by hand"). The password is read on the box, found by the server's RCON port, so it still never lands on this machine.

## Security

The first Telegram version was reviewed adversarially before release; every fix below has a test that fails without it.

- **Chat picker.** Anyone can message a bot or add it to a group, so each line leads with the chat's kind as Telegram reports it (PRIVATE, GROUP, CHANNEL) rather than a name the stranger chose. Invisible and direction-changing characters are dropped from names, and a chat the bot was removed from is not offered. A name already in use is never replaced silently.
- **No stray mentions.** An `@` in player-supplied text (names, `!admin` text) becomes a look-alike so it can't ping anyone in Telegram.
- **Backpressure.** A flood limit (429, waiting up to 30 s) or a gateway error (502 to 504) is retried once. At most 20 posts wait per service; past that they are skipped and logged instead of delivering stale alerts late.
- **Token and file handling.** Only a token-shaped string can reach a request URL, so a hand-edited `telegram.json` can't steer it. Replies are read only up to 1 MiB. Changes to `telegram.json` are serialized, and a file that isn't a table is never written over.
- **Owner-only from the first byte.** The config (with RCON passwords) and the webhook and token files are created owner-only and exclusively, instead of being chmodded afterwards, so they're never briefly world-readable.

## Upgrading

Desktop installs update in place from the app. Pardon needs server 0.9.16 or later and live reload needs 0.9.18 or later; nothing else changes on older servers.
