import asyncio
import json
import sys

import pytest

from oni_rcon.app import OniApp, render_event, target_of
from oni_rcon.config import Server, load_config, parse_target, resolve_passwords
from oni_rcon.demo import serve_fakes
from oni_rcon.rcon import Rcon


def test_targets():
    assert parse_target("11774").where == "127.0.0.1:11774"
    assert (parse_target("10.0.0.5:49176", ssh="box").where) == "10.0.0.5:49176 via ssh box"
    assert parse_target("[::1]:5000").host == "::1"
    assert parse_target("wss://rcon.example.org/s1").url == "wss://rcon.example.org/s1"
    with pytest.raises(ValueError):
        Server()


def test_config(tmp_path, monkeypatch):
    p = tmp_path / "c.toml"
    p.write_text(f'by = "op"\n[defaults]\nssh = "box"\npassword_command = [{json.dumps(sys.executable)}, "-c", "print(42)"]\n'
                 '[[server]]\nport = 1\n[[server]]\nport = 2\nssh = ""\npassword_env = "X_PW"\n')
    monkeypatch.setenv("X_PW", "fromenv")
    by, servers = load_config(p)
    resolve_passwords(servers)
    assert by == "op" and [s.ssh for s in servers] == ["box", ""]
    assert [s.password for s in servers] == ["42", "fromenv"]


def test_event_lines():
    names = {7: "Viper", 9: "Rook"}
    assert render_event("s1", {"event": "kill", "killer": 7, "victim": 9, "weapon": "sword"}, names).plain.endswith(
        "Viper ✕ Rook  [sword]")
    assert "died" in render_event("s1", {"event": "kill", "victim": 9}, names).plain
    assert "[SERVER] hi" in render_event("s1", {"event": "chat", "channel": "server", "text": "hi"}, {}).plain
    line = render_event("s1", {"event": "ban", "name": "Rook", "address": "1.2.3.4"}, {}).plain
    assert "1.2.3.4" not in line and "BAN  Rook" in line
    assert target_of({"number": 3, "player_id": "abc"}) == "abc" and target_of({"number": 3}) == "#3"


def test_rcon_against_fake():
    async def go():
        (port, *_), keep = await serve_fakes(tick=False)
        events, states = [], []
        rc = Rcon(f"ws://127.0.0.1:{port}", "demo", "pytest", lambda _, e: events.append(e),
                  lambda _, s, d: states.append(s))
        task = asyncio.create_task(rc.run())
        while rc.state != "online":
            await asyncio.sleep(0.01)
        st = await rc.call("status")
        assert st["ok"] and st["data"]["max_players"] == 16
        players = (await rc.call("players"))["data"]["players"]
        victim = players[0]
        r = await rc.call("kick", victim["player_id"], "spawn camping")
        assert r["ok"]
        await asyncio.sleep(0.05)
        assert any(e.get("event") == "kick" for e in events)
        assert (await rc.call("players"))["data"]["count"] == len(players) - 1
        task.cancel()

        bad = Rcon(f"ws://127.0.0.1:{port}", "wrong", "pytest", lambda *_: None, lambda *_: None)
        await asyncio.wait_for(bad.run(), 5)  # returns instead of retrying
        assert bad.state == "denied"

    asyncio.run(go())


def test_app_against_fakes():
    async def go():
        ports, keep = await serve_fakes(tick=False)
        app = OniApp([Server(port=p, password="demo") for p in ports], by="pytest", intro=False)
        async with app.run_test(size=(160, 48)) as pilot:
            for _ in range(100):
                await pilot.pause(0.05)
                if all(st.online and "players" in st.data for st in app.stations):
                    break
            assert app.stations[0].label == "Slayer"  # common "Demo Ops | " prefix stripped
            assert app.query_one("#players").row_count == len(app.stations[0].players) > 0
            await pilot.press("f5")
            app.query_one("#cmd").focus()
            app.query_one("#cmd").value = "say hello there"
            await pilot.press("enter")
            await pilot.pause(0.3)
            assert any("hello there" in str(e.get("text")) for _, e in app.feed)
    asyncio.run(go())
