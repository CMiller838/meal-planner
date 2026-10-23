#!/usr/bin/env python3
"""Planning-chat bridge (Phase 72): makes Hermes answer the app's chat. Stdlib only, runs on the PC.

`python3 tools/hermes_chat_bridge.py [--once] [--responder "cmd {prompt}"]`. Polls GET /chat on the Worker, runs the
responder once per unanswered user message (default `hermes -z "<prompt>" chat`, an argv list, no shell) and posts the
reply to POST /chat/reply. Reads MP_WORKER_URL and MP_AUTH_TOKEN from the environment or ./.env.
Hermes returns constraints and edits, never meals; the Worker validates every reply.
"""
import argparse
import json
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from notify import env

POLL_ACTIVE = 1  # seconds while a chat was opened under ACTIVE_WINDOW ago
POLL_IDLE = 10
ACTIVE_WINDOW = 600
HISTORY = 12
RESPONDER_TIMEOUT = 120
FALLBACK = {"text": "Sorry, could you say that another way?", "edits": [], "ask": False}
GIVE_UP = {"text": "I didn't follow, could you put it another way?", "edits": [], "ask": False}
EDIT_TYPES = """Edit types (day is 1-14, slot is breakfast|lunch|dinner|snack):
  {"type":"busy","day":N}  {"type":"free","day":N}  {"type":"noCook","day":N}
  {"type":"chip","id":"comfort|light|no-spice|less-red-meat|no-pasta|protein-boost","days":[N]}
  {"type":"budget","perWeek":POUNDS,"days":[N]}
  {"type":"lock","day":N,"slot":S}  {"type":"unlock","day":N,"slot":S}  {"type":"reroll","day":N,"slot":S}
(days and slot are optional on chip, budget and reroll; days defaults to the day in focus.)"""


def poll_interval(open_at, now=None):
    """1 s while a chat opened under 10 min ago, else 10 s (keeps the Worker under its free-tier request budget)."""
    if not open_at:
        return POLL_IDLE
    now = now or datetime.now(timezone.utc)
    age = (now - datetime.fromisoformat(open_at.replace("Z", "+00:00"))).total_seconds()
    return POLL_ACTIVE if age < ACTIVE_WINDOW else POLL_IDLE


def parse_reply(out):
    """The last {...} JSON object in the responder's stdout; anything else -> the 'say that another way' fallback."""
    dec = json.JSONDecoder()
    for i in reversed([i for i, ch in enumerate(out or "") if ch == "{"]):
        try:
            obj, _ = dec.raw_decode(out[i:])
        except ValueError:
            continue
        if isinstance(obj, dict) and ("text" in obj or "edits" in obj):
            return {"text": str(obj.get("text", "")), "edits": obj.get("edits") if isinstance(obj.get("edits"), list) else [], "ask": obj.get("ask") is True}
    return dict(FALLBACK)


def build_prompt(messages, context, opener=False, strict=False):
    lines = [
        "You help plan a two-week meal plan by chatting, one day at a time. Lead; ask ONE question at a time.",
        "Never name or choose meals: the app's generator picks meals. You only return constraints as edits.",
        EDIT_TYPES,
        'Reply with ONLY one JSON object: {"text":"short reply","edits":[...],"ask":false}. Set "ask":true with no edits when you need to ask a question first.',
    ]
    if strict:
        lines.append("Your last edits were rejected: use only these types and fields exactly as listed.")
    if opener:
        lines.append("Open the chat: one short question, using the gaps, expiring items or an over-budget week in the context.")
    lines.append("Context: " + json.dumps(context or {}))
    recent = [m for m in messages if m.get("text")][-HISTORY:]
    lines += [f'{"User" if m["from"] == "user" else "Hermes"}: {m["text"]}' for m in recent]
    return "\n".join(lines)


def call(base, token, method, path, body=None):
    req = urllib.request.Request(base.rstrip("/") + path, method=method, headers={"X-Auth-Token": token, "X-Actor": "hermes", "Content-Type": "application/json", "User-Agent": "meal-planner-chat-bridge"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, None


def ask(responder, prompt):
    argv = [prompt if a == "{prompt}" else a.replace("{prompt}", prompt) for a in responder]
    try:
        return parse_reply(subprocess.run(argv, capture_output=True, text=True, timeout=RESPONDER_TIMEOUT).stdout)
    except (OSError, subprocess.TimeoutExpired):
        return dict(FALLBACK)


def answer(base, token, responder, thread, msg):
    """Answer one user message; re-ask once when the Worker dropped edits, give up politely when nothing valid survives twice."""
    history = [m for m in thread["messages"] if m["id"] <= msg["id"]]
    opener = bool(msg.get("open"))
    post = lambda rep: (call(base, token, "POST", "/chat/reply", {"session": thread["session"], "replyTo": msg["id"], **rep}) or (0, None))[1] or {}
    rep = ask(responder, build_prompt(history, msg.get("context"), opener))
    got = post(rep)
    if got.get("dropped"):
        rep = ask(responder, build_prompt(history, msg.get("context"), opener, strict=True))
        got = post(rep)
        if got.get("dropped") and got["dropped"] >= len(rep["edits"]):
            post(GIVE_UP)


def run_once(base, token, responder, done):
    status, thread = call(base, token, "GET", "/chat")
    if status != 200 or not thread or not thread.get("session"):
        return thread, 0
    replied = {m.get("replyTo") for m in thread["messages"] if m["from"] == "hermes"}
    pending = [m for m in thread["messages"] if m["from"] == "user" and m["id"] not in replied and m["id"] not in done] if thread.get("openAt") else []
    for m in pending:
        done.add(m["id"])
        answer(base, token, responder, thread, m)
    return thread, len(pending)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--responder", default='hermes -z {prompt} chat')
    a = ap.parse_args(argv)
    base, token = env("MP_WORKER_URL"), env("MP_AUTH_TOKEN")
    if not (base and token):
        sys.exit("MP_WORKER_URL and MP_AUTH_TOKEN are required (environment or .env)")
    responder, done = shlex.split(a.responder), set()
    while True:
        try:
            thread, _ = run_once(base, token, responder, done)
        except (urllib.error.URLError, OSError) as e:
            print("poll failed:", e, file=sys.stderr)
            thread = None
        if a.once:
            return
        time.sleep(poll_interval((thread or {}).get("openAt")))


if __name__ == "__main__":
    main(sys.argv[1:])
