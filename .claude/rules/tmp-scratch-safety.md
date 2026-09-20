## SCRATCH/COMPARISON WORK: NEVER CHAIN AN UNGUARDED `cd` WITH A WRITE

`/tmp` is outside this sandbox's write allowlist (`$TMPDIR` is the writable
scratch dir). A command like:

```
mkdir -p /tmp/x && cd /tmp/x
git show HEAD:generator.js > generator.js
```

fails at `mkdir` (permission denied), which means `cd` never runs — but
because the `git show > file` line is a *separate* statement, not chained
with `&&`, it still executes, in whatever directory the shell was already in
(normally the project root). A relative redirect target that happens to share
a real filename then silently overwrites live work with no error and no
warning. This has actually happened in this repo: `data.js`,
`shopping-list.js`, and `shelf-life.js` got clobbered back to their
last-committed content mid-edit this way.

**Fixes, in order of preference:**

1. **Don't write comparison content to disk at all.** To check current vs.
   HEAD, use `git diff <ref> -- <path>` or pipe: `git show HEAD:<path> | diff
   - <path>`. Nothing touches the filesystem.
2. **If a scratch file is genuinely needed, use `$TMPDIR`, not `/tmp`** (see
   the user's machine notes), and confirm the directory exists as its own
   checked command *before* anything that writes into it:
   `mkdir -p "$TMPDIR/scratch" || exit 1` — run that alone, see it succeed,
   then proceed.
3. **Never chain `mkdir ... && cd ...` in the same command block as a later
   write/redirect.** Run the `cd` alone first, confirm with `pwd`, and only
   then run commands that create or overwrite files by a relative name.
4. **After any command sequence that touched real files unexpectedly,
   `git status`/`git diff --stat` immediately** — don't assume a `&&` chain
   short-circuited a downstream destructive step just because an earlier step
   in it failed.
