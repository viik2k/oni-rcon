# ONI RCON desktop 1.9.0

Automation Studio, a JavaScript editor for the automations rules can't express, and a guided way to add plug-ins.

## New

- **Automation Studio.** A built-in F10 plug-in (no install or approval) for scripted automations: counters that outlive restarts, `!commands` with arguments, strike systems, rotating announcements, Discord logs. The editor has suggestions, docs on hover, live problems and a command palette. RUN a script for real or TEST it as a dry run, watch live events, simulate your own, and keep data that survives restarts. See [docs/STUDIO.md](docs/STUDIO.md).
- **Adding plug-ins is guided.** The empty Plug-ins tab and ADD A PLUG-IN walk through get it, turn it on, approve it, watch it. Oni lists plug-in folders it finds in `plugins/` and adds them to your config on TURN ON, and DOWNLOAD FROM GIT… clones one for you.
- **Version drift.** A server behind the newest Project Reclaimer release says so on its card, and the feed says `MIXED VERSIONS` when your servers disagree. Checked hourly.

## Security

Studio scripts run sandboxed: no network, RCON only through the plug-in filter and its `permissions.rcon`, and chat and Discord rate limits.

## Upgrading

Desktop installs update in place from the app. Existing plug-ins and config work unchanged.
