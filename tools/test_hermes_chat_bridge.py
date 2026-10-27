#!/usr/bin/env python3
"""Self-test for tools/hermes_chat_bridge.py: python3 tools/test_hermes_chat_bridge.py (stdlib only, no real credential)."""
import json
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hermes_chat_bridge as b

# parse_reply
assert b.parse_reply('{"text":"hi","edits":[{"type":"busy","day":2}],"ask":false}')["edits"] == [{"type": "busy", "day": 2}]
assert b.parse_reply('thinking {not json} ... {"text":"ok","edits":[],"ask":true}\n')["ask"] is True
assert b.parse_reply("   ") == b.FALLBACK and b.parse_reply("") == b.FALLBACK and b.parse_reply(None) == b.FALLBACK  # prose alone is now a valid reply
# Phase 94: prose + fenced edits block
r = b.parse_reply("Swapped it.\n```edits\n[{\"type\":\"busy\",\"day\":2}]\n```\nask: true\nsession_id: 2026_x\n")
assert r == {"text": "Swapped it.", "edits": [{"type": "busy", "day": 2}], "ask": True}, r
assert b.parse_reply("Just chatting, {with braces}.") == {"text": "Just chatting, {with braces}.", "edits": [], "ask": False}
assert b.parse_reply("Hm.\n```edits\n[oops\n```")["edits"] == [] and b.parse_reply("x\n```edits\n{\"a\":1}\n```")["edits"] == []
assert b.parse_reply("\nsession_id: abc\n") == b.FALLBACK
# build_prompt
msgs = [{"id": i, "from": "user" if i % 2 else "hermes", "text": f"msg{i}"} for i in range(1, 20)]
p = b.build_prompt(msgs, {"day": 3, "gaps": ["iron"]})
assert all(t in p for t in ("busy", "noCook", "chip", "budget", "lock", "unlock", "reroll", "place", "cap", "rate", "bulk", "cheaper", "context.shop", "cookId", "freezer first", '"type":"note"', "standing preferences")) and '"iron"' in p
pf = b.build_prompt([], {}, brief={"mode": "fridge", "window": [3, 6]})
assert "FRIDGE MODE" in pf and "[3, 6]" in pf and '"stock"' in pf and "FRIDGE MODE" not in b.build_prompt([], {}, brief={"a": 1})
pn = b.build_prompt([], {}, brief={"a": 1}, opener=True)
assert "stock" in pn and "leftover" in pn and "any chat" in pn and "fridge mode only" not in pn and "what's already cooked" in pn
assert "msg19" in p and "msg1:" not in p and b.HISTORY == 30  # last 30 (all 19 here)
assert "ONE question" not in p and "Never name" not in p and "rejected" in b.build_prompt([], {}, strict=True)
pb = b.build_prompt(msgs, {}, brief={"meals": [{"id": "x"}]}, spend={"weeks": {}})
assert '"meals":[{"id":"x"}]' in pb and "Spend so far" in pb and "Briefing" in pb and "Briefing" not in p
assert b.brief_of([{"open": True, "context": {"brief": {"a": 1}}}]) == {"a": 1} and b.brief_of([{"text": "x"}]) is None
pr = b.build_prompt(msgs, {"day": 2}, brief={"a": 1}, resumed=True, send_brief=False)
assert pr == 'Context: {"day": 2}\nUser: msg19' and "Briefing" in b.build_prompt(msgs, {}, brief={"a": 1}, resumed=True)
# poll_interval
now = datetime.now(timezone.utc)
iso = lambda d: (now - d).isoformat()
assert b.poll_interval(iso(timedelta(minutes=2)), now) == 1 and b.poll_interval(iso(timedelta(minutes=11)), now) == 10 and b.poll_interval(None) == 10

# --once against a stub Worker and a stub responder
posted, state = [], {}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body):
        self.send_response(code)
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        assert self.headers["X-Actor"] == "hermes" and self.headers["X-Auth-Token"] == "t"
        if self.path == "/spend":
            state["spendCalls"] = state.get("spendCalls", 0) + 1
            return self.send(200, {"weeks": {}, "budgetTarget": 50})
        self.send(200, state["thread"])

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        posted.append(body)
        self.send(200, {"id": 99, "dropped": 1 if state.get("drop") else 0})


srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
resp = [sys.executable, "-c", 'import sys; print("chatter"); print(\'{"text":"ok","edits":[{"type":"busy","day":2}],"ask":false}\'); open(sys.argv[2], "a").write(sys.argv[1] + "\\n=====\\n")', "{prompt}", str(Path(__file__).with_suffix(".prompts"))]
state["thread"] = {"session": "s1", "openAt": now.isoformat(), "messages": [
    {"id": 1, "from": "user", "text": "", "open": True, "context": {"day": 1, "brief": {"start": "2026-10-26", "meals": []}}},
    {"id": 2, "from": "hermes", "replyTo": 1, "text": "Hi", "edits": []},
    {"id": 3, "from": "user", "text": "no cooking Tuesday", "day": 2}]}
_, n = b.run_once(base, "t", resp, set())
assert n == 1 and len(posted) == 1 and posted[0]["replyTo"] == 3 and posted[0]["edits"][0]["day"] == 2, posted
prompts = Path(__file__).with_suffix(".prompts")
seen = prompts.read_text()
prompts.unlink()
assert '"start":"2026-10-26"' in seen and "Spend so far" in seen  # brief in the prompt
# dropped edits: re-ask once, then the apology
posted.clear(); state["drop"] = True
b.run_once(base, "t", resp, set())
assert [p.get("replyTo") for p in posted] == [3, 3, 3] and posted[-1]["text"] == b.GIVE_UP["text"], posted
# closed chat: nothing answered
posted.clear(); state["thread"]["openAt"] = None
assert b.run_once(base, "t", resp, set())[1] == 0 and not posted
assert state["spendCalls"] == 1, state  # spend fetched once per session, not per answer
prompts.unlink(missing_ok=True)
# Phase 94: session responder reuses one name per chat, briefing sent once unless it changes
calls = []
real_run = b.run
b.run = lambda responder, prompt, session=None: calls.append((session, prompt)) or "Fine.\n```edits\n[]\n```"
sresp = b.shlex.split(b.SESSION_RESPONDER)
b.SENT.clear()
H1 = [{"id": 1, "from": "user", "text": "hi", "open": True}, {"id": 3, "from": "user", "text": "next"}]
for m, br in ((H1[0], {"v": 1}), (H1[1], {"v": 1}), (H1[1], {"v": 2})):
    b.ask(sresp, "mp-s1", H1, {}, bool(m.get("open")), br, None)
b.ask(sresp, "mp-s2", H1, {}, True, {"v": 1}, None)
assert [c[0] for c in calls] == ["mp-s1"] * 3 + ["mp-s2"]
assert "You are Hermes" in calls[0][1] and '"v":1' in calls[0][1]
assert "You are Hermes" not in calls[1][1] and "Briefing" not in calls[1][1] and "User: next" in calls[1][1]
assert '"v":2' in calls[2][1] and "You are Hermes" not in calls[2][1] and "You are Hermes" in calls[3][1]
# resume fails -> one-shot responder with the full prompt
calls.clear(); b.SENT["mp-s1"] = "x"
b.run = lambda responder, prompt, session=None: calls.append((session, prompt)) or (None if session else "ok")
assert b.ask(sresp, "mp-s1", H1, {}, False, {"v": 1}, None)["text"] == "ok" and "You are Hermes" in calls[-1][1] and "mp-s1" not in b.SENT
b.run = real_run
srv.shutdown()
print("hermes_chat_bridge: ok")
