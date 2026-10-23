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
assert b.parse_reply("total garbage") == b.FALLBACK and b.parse_reply("") == b.FALLBACK
# build_prompt
msgs = [{"id": i, "from": "user" if i % 2 else "hermes", "text": f"msg{i}"} for i in range(1, 20)]
p = b.build_prompt(msgs, {"day": 3, "gaps": ["iron"]})
assert all(t in p for t in ("busy", "noCook", "chip", "budget", "lock", "unlock", "reroll")) and '"iron"' in p
assert "msg19" in p and "msg8" in p and "msg7" not in p  # last 12 only
assert "Never name or choose meals" in p and "rejected" in b.build_prompt([], {}, strict=True)
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
        self.send(200, state["thread"])

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        posted.append(body)
        self.send(200, {"id": 99, "dropped": 1 if state.get("drop") else 0})


srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
resp = [sys.executable, "-c", 'print("chatter"); print(\'{"text":"ok","edits":[{"type":"busy","day":2}],"ask":false}\')', "{prompt}"]
state["thread"] = {"session": "s1", "openAt": now.isoformat(), "messages": [
    {"id": 1, "from": "user", "text": "", "open": True, "context": {"day": 1}},
    {"id": 2, "from": "hermes", "replyTo": 1, "text": "Hi", "edits": []},
    {"id": 3, "from": "user", "text": "no cooking Tuesday", "day": 2}]}
_, n = b.run_once(base, "t", resp, set())
assert n == 1 and len(posted) == 1 and posted[0]["replyTo"] == 3 and posted[0]["edits"][0]["day"] == 2, posted
# dropped edits: re-ask once, then the apology
posted.clear(); state["drop"] = True
b.run_once(base, "t", resp, set())
assert [p.get("replyTo") for p in posted] == [3, 3, 3] and posted[-1]["text"] == b.GIVE_UP["text"], posted
# closed chat: nothing answered
posted.clear(); state["thread"]["openAt"] = None
assert b.run_once(base, "t", resp, set())[1] == 0 and not posted
srv.shutdown()
print("hermes_chat_bridge: ok")
