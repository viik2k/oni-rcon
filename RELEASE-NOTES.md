# ONI RCON desktop 1.11.0

Session plug-ins work again, plug-ins say what they need installed, character mods can be set from F3, and servers of other community projects are told apart from Halo 3.

## New

- **Character mods (Project Reclaimer 0.9.18).** CHARACTER MODS on F3 sets which character mods a server's games include, whether players must accept them to join, whether everyone plays as one of their characters instead of Halo 3's, and whether players can download mods they're missing from the server. It lists the character mods in the server's content folder (`Mods`, each a folder with a `customization.json`), saves to its `dedicated.toml` and has the server reload. The server needs all 27 Halo 3 multiplayer maps in its game folder to use them.
- **What a plug-in needs.** Turning a plug-in on checks for the programs it needs before asking for approval, and offers each one's download page. Until they're there, F10 shows NEEDS PYTHON 3 (or what's missing) with GET and CHECK AGAIN, and the plug-in doesn't run. Python plug-ins need nothing new in their manifest; others can list what they need in `run.requires` (docs/PLUGINS.md).
- **Other games.** A server of another community project, such as Project Gravemind (Halo 2) or Reach Renaissance (Halo: Reach), that speaks Reclaimer's remote console and names its game when it signs in shows that game on its card (H2, REACH) and in the sitrep. What is Reclaimer's alone (its `dedicated.toml` settings, playlists and game types, ReclaimerForge, its release warnings) is turned off for it. docs/OTHER-GAMES.md is what such a server needs, for those projects' developers. The demo's third server is a pretend Project Gravemind one.

## Fixes

- Approving Greeter, or any session plug-in, no longer closes the app. It also closed on every start after that.
- A plug-in whose manifest runs `python` now works on a Mac (where only `python3` exists) and on Windows with only the `py` launcher. Windows' Microsoft Store placeholder for `python` isn't mistaken for Python.
- A session plug-in that stops reading what Oni sends it no longer goes silent: its panel, toasts and RCON keep working, and the command log says it's behind.
- RCON a plug-in sends by itself is held to 60 commands a minute, and 20 chat messages a minute to one server, as automation is, so a plug-in gone wrong can't flood a server.
- A session plug-in that pushes many views at once redraws F10 at most 5 times a second, always ending on its latest.

## Upgrading

Desktop installs update in place from the app. Config and plug-ins work unchanged. If the app closed after you approved Greeter, it starts normally again after this update.
