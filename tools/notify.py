#!/usr/bin/env python3
"""Send one line to Telegram, or do nothing when it isn't set up. Stdlib only.

`python3 tools/notify.py "text"`. Reads NOTIFY_BOT_TOKEN and NOTIFY_CHAT_ID from the environment, else from ./.env.
Used by tools/pipeline.sh, tools/githooks/post-commit and tools/workflow_audit.py. Never fails the caller.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name:
                return v.strip().strip("'\"")
    except OSError:
        pass
    return ""


def send(text):
    token, chat = env("NOTIFY_BOT_TOKEN"), env("NOTIFY_CHAT_ID")
    if not (token and chat):
        return False
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", method="POST",
                                 data=json.dumps({"chat_id": chat, "text": text[:4000]}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15):
        return True


if __name__ == "__main__":
    try:
        send(" ".join(sys.argv[1:]))
    except Exception as e:  # offline or a bad token: say so, never break a hook
        print(f"notify: not sent ({type(e).__name__})", file=sys.stderr)
