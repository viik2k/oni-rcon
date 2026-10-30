# ONI RCON desktop 1.11.0

Session plug-ins work again, plug-ins say what they need installed, and character mods can be set from F3.

## New

- **Character mods (Project Reclaimer 0.9.18).** CHARACTER MODS on F3 sets which character mods a server's games include, whether players must accept them to join, whether everyone plays as one of their characters instead of Halo 3's, and whether players can download mods they're missing from the server. It lists the character mods in the server's content folder (`Mods`, each a folder with a `customization.json`), saves to its `dedicated.toml` and has the server reload. The server needs all 27 Halo 3 multiplayer maps in its game folder to use them.
- **What a plug-in needs.** Turning a plug-in on checks for the programs it needs before asking for approval, and offers each one's download page. Until they're there, F10 shows NEEDS PYTHON 3 (or what's missing) with GET and CHECK AGAIN, and the plug-in doesn't run. Python plug-ins need nothing new in their manifest; others can list what they need in `run.requires` (docs/PLUGINS.md).

## Fixes

- Approving Greeter, or any session plug-in, no longer closes the app. It also closed on every start after that.
- A plug-in whose manifest runs `python` now works on a Mac (where only `python3` exists) and on Windows with only the `py` launcher. Windows' Microsoft Store placeholder for `python` isn't mistaken for Python.

## Upgrading

Desktop installs update in place from the app. Config and plug-ins work unchanged. If the app closed after you approved Greeter, it starts normally again after this update.
