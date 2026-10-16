# Automation rules

Rules the desktop console follows for you: **WHEN** something happens, **ONLY IF** it holds, **THEN DO** these things.
Open them with **F9**, or Ctrl+P → *Automation rules*.

Adapted from the rules in [ibigsnet/oni-rcon](https://github.com/ibigsnet/oni-rcon) by RifleJock.

## What a rule looks like

> **WHEN** a player reaches a killing spree (5, 10, 15, 20, 25, 30)
> **THEN** say in chat: `{player} is on a {medal}! ({kills} kills)`

- **WHEN** (one): a medal, spree or multi-kill; a weapon kill, first blood, N kills; a join or leave; a `!command`;
  a vote starting; a match starting or ending; a server going down or coming back; a server filling or emptying; the
  player count crossing N; a server's frame rate dropping under, or back over, N; every N minutes; or at a time of day
  (cron-style, with a timezone).
- **ONLY IF** (up to 8, all must hold): the player count, an admin online (or none), the player's role, their K/D,
  the day or time of day, the server's frame rate, another server's player count or state, the map, the mode.
- **THEN DO** (1 to 8, in order): say in chat (here, everywhere, or on another server), message the player, the admins
  or everyone with a role privately, cancel the vote, shuffle the teams, wait, post to Discord or Telegram.
- **Limits.** A *cooldown* (seconds before it can fire again for the same server and player) and a *per-hour* count.
  Moments such as a medal or a join default to no cooldown; states such as a server filling default to 30 seconds.

Messages can use `{player}`, `{server}`, `{count}`, `{max}`, `{medal}`, `{kills}`, `{weapon}`, `{victim}`, `{kd}`,
`{fps}`, `{map}`, `{mode}`, `{admins}`, `{target}`, `{args}`, `{down}` and `{time}`.

## Making one

- **TEMPLATE** starts from a ready-made rule (spree announcer, lag alert, `!admin` call, server-down alert, votes off,
  and more) and walks through it so you can change the words.
- **NEW** builds one a step at a time: name, which servers, WHEN, ONLY IF, THEN DO, limits, then a read-back.
- **TEST** shows what the rule would do if it fired right now on a server you pick (its conditions and limits aside),
  and offers to really do it.
- **TURN OFF** keeps a rule but stops it; **DELETE** removes it.

## Roles

**ROLES** says who rules treat as **ADMIN**, **VIP** or **MOD**. ADMIN here is for rules only (who an *admin online*
condition or a *message the admins* step means); the server's own admin list is under F4. While anyone has the VIP
role, a built-in rule cancels any vote to kick them.

## Discord

**DISCORD** adds webhooks by name. In Discord: the channel's gear → Integrations → Webhooks → New Webhook → Copy
Webhook URL. The URL is kept by the app in `discord.json` beside the config (readable only by you) and the window only
ever sees it with its secret part hidden. Rules post to it by name; **SEND A TEST** checks it. Posts are at least 2
seconds apart and never ping `@everyone`, roles or users.

## Telegram

**TELEGRAM** adds a bot and a chat under a name, for rules to post to.

1. In Telegram, message **@BotFather**, send `/newbot` and pick a name. It replies with a bot token.
2. Open a chat with your bot and send it a message. For a group, add the bot and send a message there; for a channel,
   make the bot an admin that can post, then post once.
3. In the console choose **TELEGRAM → + Add a chat**, paste the token and pick your chat from the list. The console finds
   it from the bot's recent messages. If nothing shows yet, message the bot and choose *Look again*, or type the chat's
   number (a group's starts with `-`) or a public channel's `@name`. Then name it, like `alerts`.

The token is kept by the app in `telegram.json` beside the config (readable only by you) and the window only ever sees
the bot's number and the chat. Rules post to it by name; **SEND A TEST MESSAGE** checks it, and a refusal says why (a
revoked token, a bot removed from the chat). Posts are plain text, never previewed, and at least 3 seconds apart, inside
Telegram's limit of 20 a minute to a group. Anyone with the token can post as the bot: send `/revoke` to @BotFather to
cancel it. A bot with a webhook set elsewhere can't have its messages read to find the chat; type the chat's number instead.

The ready-made templates that post to Discord post to Telegram instead when a chat is all you've set up.

This is one-way: the console tells Telegram things. The bot doesn't take commands back, so nobody in the chat can reach a
server through it.

## Safety limits

- Chat from rules is held to **20 lines a minute per server**, across every rule.
- *Shuffle teams* only runs while a match is being played.
- A step that fails never stops the others. Each run, and what happened to each step, is written to the command log
  as `AUTO` and shown under RECENT in the list.
- Nothing runs in demo mode against a real Discord channel or Telegram chat.

## What to know

- Rules run **while the console is open**. They act through the same connection as the buttons do, so a closed
  console, or a server it has lost, does nothing.
- Rules live in `automation.json` beside the config; a rule that no longer checks out is skipped and said so.
- A vote can't be switched off on the dedicated server, so the *Votes off* template cancels each vote the moment it
  starts and says so in chat.
