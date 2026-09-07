## GIT STASH IS UNSAFE IN THIS SANDBOXED REPO

`.claude/skills/`, `.claude/hooks/`, and other project paths are in this
repo's Bash sandbox write-deny list. A sandboxed `git stash` can silently
fail to restore those paths on `git stash pop`, leaving the working tree
partially reverted in a way that looks like a merge conflict but isn't one.
Recovering from this is expensive: each file restored via
`git checkout stash@{0} -- <file>` re-triggers a full-file "changed on disk"
reminder for that file.

**Do not run `git stash` in this repo to inspect prior state.** Use instead:
- `git diff HEAD -- <path>` — uncommitted changes to a path, no working-tree
  mutation.
- `git show HEAD:<path>` — a file's last-committed content.
- `git diff <ref>...<ref> -- <path>` — compare two points in history.

If a stash is genuinely unavoidable, run both `stash` and `pop` with
`dangerouslyDisableSandbox: true` from the start, not just on retry after
failure.
