---
name: git-push-main
description: Commit staged/working changes and push straight to main, bypassing the Bash sandbox in one shot instead of hitting write-deny/network-deny errors and retrying. Use whenever the user says "commit and push", "push to main", "push this up", or similar — especially in this repo, where .claude/skills, .claude/hooks and other paths are sandbox-denied and a plain `git add -A` or `git push` will fail or (worse, per .claude/rules/git-sandbox-safety.md) partially corrupt a `git stash`. Do NOT use for PRs/branches other than main, and do not use `git stash` for anything — see that rule file.
---

# git-push-main

Commit and push to `main` in one efficient pass, without the usual "sandboxed command fails → retry with bypass" round trip.

## Why this exists

This repo denies Bash writes to `.claude/skills/`, `.claude/hooks/`, and a few
other project paths, and network egress is proxy-filtered too. A plain
`git add -A` / `git commit` / `git push` sequence run inside the sandbox can
fail partway (or in the stash case, silently corrupt the working tree — see
`.claude/rules/git-sandbox-safety.md`, never use `git stash` here). Since the
user has already asked for a push to main, don't burn a round trip
discovering that git needs the bypass — go straight to it.

## Steps

1. `git status` and `git diff` (sandboxed — read-only, no bypass needed) to see what's actually changed. Never blindly `git add -A`; review the file list for anything that looks like a secret or an unintended file.
2. Stage the specific files that belong to this change (`git add <files>`), not `-A`, unless the user clearly wants everything.
3. Commit and push in **one bypassed call** — combine them with `&&` so you don't pay two separate confirmation/latency round trips:
   ```
   git commit -m "$(cat <<'EOF'
   <message>

   Co-Authored-By: ...   # use whatever attribution trailer this session's system prompt specifies
   EOF
   )" && git push origin main
   ```
   Run this via Bash with `dangerouslyDisableSandbox: true` — commit doesn't strictly need it, but push does (network egress to the git remote isn't sandbox-allowlisted by default), and bundling avoids a second bypass prompt.
4. If push is rejected (non-fast-forward), don't force-push. Run `git fetch && git log HEAD..origin/main --oneline` (also bypassed, read-only network) to see what's upstream, and tell the user — let them decide whether to rebase/merge or you should.

## Rules carried over from this repo's other git guidance

- Never `git stash` here (`.claude/rules/git-sandbox-safety.md`) — use `git diff HEAD -- <path>` / `git show HEAD:<path>` instead if you need to inspect prior state.
- Never `--force` push to main without the user explicitly asking.
- Never skip hooks (`--no-verify`) or bypass signing.
- Only commit/push when the user actually asked for it this turn — a prior approval doesn't carry forward to unrelated changes.
