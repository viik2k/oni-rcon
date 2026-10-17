"""What the console remembers between runs: whether the full boot sequence has played, whether the operator wants it
every time, and which plug-ins they approved. Kept next to the config file; a missing or unreadable file reads as the
defaults."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .config import write_atomic


def _read(path: Path | None) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path else {}
    except (OSError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


@dataclass
class Prefs:
    path: Path | None = None  # None: nothing is kept (tests, and anywhere there's no config directory)
    intro_seen: bool = False  # the full boot sequence has played once
    full_intro: bool = False  # play it every time, not only the first
    plugins_trusted: dict = field(default_factory=dict)  # plug-in id -> sha256 of the manifest the operator approved

    @classmethod
    def load(cls, path: Path | None) -> Prefs:
        data = _read(path)
        trusted = data.get("plugins_trusted")
        trusted = {k: v for k, v in trusted.items() if isinstance(v, str)} if isinstance(trusted, dict) else {}
        return cls(path, data.get("intro_seen") is True, data.get("full_intro") is True, trusted)

    def save(self) -> None:
        """Read, change, write: keys this version doesn't know (a newer one's, or another program's) are kept."""
        if self.path:
            data = _read(self.path)
            data.update(intro_seen=self.intro_seen, full_intro=self.full_intro, plugins_trusted=self.plugins_trusted)
            try:
                write_atomic(self.path, json.dumps(data, indent=2) + "\n")
            except OSError:
                pass  # a read-only profile mustn't stop the console: the sequence just plays again next time

    def intro_mode(self) -> str:
        """Which boot to play when nothing says otherwise: the full sequence the first time and whenever asked for,
        else the quick one."""
        return "full" if self.full_intro or not self.intro_seen else "quick"
