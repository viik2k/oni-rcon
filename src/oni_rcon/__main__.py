"""oni-rcon [targets...] [-c CONFIG] [--ssh DEST] [--by NAME] [--demo]"""
from __future__ import annotations

import argparse
import getpass

from . import __version__
from .config import Server, default_config, load_config, parse_target, resolve_passwords


def main() -> None:
    ap = argparse.ArgumentParser(prog="oni-rcon", description="ONI-themed RCON console for Project Reclaimer servers.",
                                 epilog="With no targets, servers come from the config file (see oni-rcon.example.toml).")
    ap.add_argument("targets", nargs="*", help="PORT, HOST:PORT or ws(s)://URL of a server's RCON")
    ap.add_argument("-c", "--config", help="config file (default: $ONI_RCON_CONFIG, ./oni-rcon.toml, then the user config dir)")
    ap.add_argument("--ssh", metavar="DEST", default="", help="reach the targets through an SSH tunnel to DEST")
    ap.add_argument("--by", help="your name in the server's admin log (default: config `by`, then your login)")
    ap.add_argument("--demo", action="store_true", help="run against three simulated servers, no setup needed")
    ap.add_argument("--no-intro", action="store_true", help="skip the boot sequence")
    ap.add_argument("-V", "--version", action="version", version=f"oni-rcon {__version__}")
    a = ap.parse_args()

    cfg_by = ""
    if a.demo:
        from .demo import start_in_thread
        servers = [Server(port=p, password="demo") for p in start_in_thread()]
    elif a.targets:
        servers = [parse_target(t, ssh=a.ssh) for t in a.targets]
    else:
        path = a.config or default_config()
        if not path:
            ap.error("no targets and no config file; try `oni-rcon --demo`, or `oni-rcon HOST:PORT` with the game port")
        cfg_by, servers = load_config(path)
    resolve_passwords(servers)

    from .app import OniApp
    OniApp(servers, by=a.by or cfg_by or getpass.getuser(), intro=not a.no_intro).run()


if __name__ == "__main__":
    main()
