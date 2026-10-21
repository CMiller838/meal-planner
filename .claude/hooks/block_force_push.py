#!/usr/bin/env python3
"""PreToolUse(Bash): refuse a force-push to main/master. Exit 2 blocks; stderr is the reason Claude sees.

Parses the command with shlex instead of regex-matching the whole string, so text that merely mentions a push (a heredoc
body, a commit message, `echo`, `$?` in another command of the chain) is never mistaken for one. Only a real
`git [opts] push ...` is judged, and only on its own arguments:
  force = --force* / an unambiguous abbreviation (--for...) / --mirror / a short-flag group holding f (-f, -uf) / a +refspec
  target = a refspec naming main or master (HEAD and @ mean the current branch), or no refspec at all (a bare push
           sends the current branch; its branch is read from the directory the command runs in, following `cd`)
Fails closed where it cannot tell: a push with a force flag whose arguments hold a shell expansion ($, backtick, {}, *),
`--all`/`--mirror` with force (touches main), `bash -c '...'`/`eval` wrappers (the inner string is parsed the same way),
and a command shlex cannot parse (falls back to "git ... push" plus any force-looking flag anywhere).
ponytail: a parser, not a shell (a git alias or a script that pushes can still hide it); GitHub branch protection (no
force-push on main) is the real backstop.

`python3 .claude/hooks/block_force_push.py --selftest` runs the cases at the bottom.
"""
import json
import os
import re
import shlex
import subprocess
import sys

PROTECTED = {"main", "master"}
SEPS = {";", "&&", "||", "|", "|&", "&", "(", ")", "{", "}"}
WRAPPERS = {"env", "sudo", "nohup", "setsid", "timeout", "time", "command", "exec", "nice", "stdbuf"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
GIT_OPTS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
PUSH_OPTS_WITH_VALUE = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}


def current_branch(cwd):
    r = subprocess.run(["git", "-C", cwd or ".", "symbolic-ref", "--short", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip()


def tokens_of(cmd):
    """Split into shell tokens; heredoc bodies removed, newlines treated as `;`."""
    cmd = re.sub(r"<<-?\s*(['\"]?)(\w+)\1([^\n]*)\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", r"<<\2\3", cmd, flags=re.S)
    lex = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    return list(lex)


def segments(tokens):
    seg = []
    for t in tokens:
        if t in SEPS:
            if seg:
                yield seg
            seg = []
        else:
            seg.append(t)
    if seg:
        yield seg


def drop_redirections(seg):
    out, skip = [], False
    for i, t in enumerate(seg):
        if skip:
            skip = False
        elif re.fullmatch(r"[<>&|]+", t):
            skip = True
            if out and out[-1].isdigit():
                out.pop()  # the fd in 2>&1
        else:
            out.append(t)
    return out


def split_program(seg):
    """Strip VAR=value and wrapper commands; return the real argv."""
    i = 0
    while i < len(seg):
        t = seg[i]
        if re.match(r"^[A-Za-z_]\w*=", t):
            i += 1
        elif os.path.basename(t) in WRAPPERS:
            i += 1
            while i < len(seg) and (seg[i].startswith("-") or re.fullmatch(r"[\d.]+[smhd]?", seg[i]) or re.match(r"^[A-Za-z_]\w*=", seg[i])):
                i += 1
        else:
            break
    return seg[i:]


def push_args(argv, cwd):
    """argv = ['git', ...]. Returns (args after push, cwd it runs in) or None when this is not a git push."""
    i = 1
    while i < len(argv):
        a = argv[i]
        if a in GIT_OPTS_WITH_VALUE:
            if a == "-C" and i + 1 < len(argv):
                cwd = os.path.normpath(os.path.join(cwd or ".", os.path.expanduser(argv[i + 1])))
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            return (argv[i + 1:], cwd) if a == "push" else None
    return None


def force_target(args, cwd, branch_of):
    """Reason string if this push force-updates a protected branch, else None."""
    force = mirror = all_refs = False
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        if a in PUSH_OPTS_WITH_VALUE:
            i += 2
            continue
        if a.startswith("--"):
            name = a.split("=")[0]
            if name.startswith("--force") or (len(name) >= 5 and "--force".startswith(name)):
                force = True
            elif len(name) >= 4 and "--mirror".startswith(name):
                force = mirror = True
            elif len(name) >= 4 and ("--all".startswith(name) or "--branches".startswith(name)):
                all_refs = True
        elif a.startswith("-o"):
            pass  # -o<option> push option, not a flag group
        elif a.startswith("-") and len(a) > 1:
            force = force or "f" in a[1:]
        else:
            pos.append(a)
        i += 1
    refs = pos[1:]
    force = force or any(r.startswith("+") for r in refs)
    if not force:
        return None
    if any(re.search(r"[$`{}*?]", x) for x in args):
        return "a force push whose arguments hold a shell expansion cannot be checked"
    if mirror or all_refs:
        return "a forced --mirror/--all push updates every branch, main included"
    branch = branch_of(cwd)
    for r in refs or ["HEAD"]:
        dst = r.lstrip("+").split(":")[-1].removeprefix("refs/heads/")
        if dst in ("HEAD", "@", ""):
            if not branch:
                return "a force push to the current branch, which could not be read, cannot be checked"
            dst = branch
        if dst in PROTECTED:
            return f"force-pushing to {dst} is banned"
    return None


def analyze(cmd, cwd, branch_of=current_branch, depth=0):
    """Reason string if the command contains a banned force-push, else None."""
    try:
        toks = tokens_of(cmd)
    except ValueError:  # unbalanced quotes: crude fallback, fail closed
        if re.search(r"git\s.*push", cmd) and re.search(r"(^|\s)(-\w*f|--fo|--mirror|\+\S)", cmd):
            return "could not parse the command and it looks like a force push"
        return None
    for seg in segments(toks):
        seg = drop_redirections(seg)
        if seg[:1] == ["cd"] and len(seg) > 1:
            cwd = os.path.normpath(os.path.join(cwd or ".", os.path.expanduser(seg[1])))
            continue
        argv = split_program(seg)
        if not argv:
            continue
        prog = os.path.basename(argv[0])
        if prog == "git":
            got = push_args(argv, cwd)
            if got:
                why = force_target(got[0], got[1], branch_of)
                if why:
                    return why
        elif (prog in SHELLS or prog == "eval") and depth < 3:
            for inner in argv[1:]:  # bash -c 'git push -f ...' / eval "..."
                if not inner.startswith("-") and re.search(r"\bpush\b", inner):
                    why = analyze(inner, cwd, branch_of, depth + 1)
                    if why:
                        return why
    return None


def main():
    payload = json.load(sys.stdin)
    cmd = payload.get("tool_input", {}).get("command", "")
    cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or "."
    why = analyze(cmd, cwd)
    if why:
        print(f"Blocked: {why}. Force-pushing to main/master is banned.", file=sys.stderr)
        return 2
    return 0


def _selftest():
    on = lambda b: (lambda cwd: b)
    blocked = lambda c, b="feature": analyze(c, ".", on(b)) is not None
    # real force pushes to main/master, in every spelling
    for c in ["git push -f origin main", "git push --force origin master", "git push origin main --force", "git push -uf origin main",
              "git push --force-with-lease origin main", "git push --for origin main", "git push origin +main", "git push origin +HEAD:main",
              "git push origin HEAD:refs/heads/main -f", "git push -f origin 'main'", 'git push "--force" origin main',
              "git -C /x push -f origin main", "cd /x && git push -f origin master", "FOO=1 git push -f origin main",
              "timeout 60 git push -f origin main", "git add . && git commit -m x && git push -f origin main",
              "bash -c 'git push -f origin main'", 'eval "git push --force origin main"', "git push --mirror -f", "git push --mirror",
              "git push -f origin $BRANCH", "git push -f origin {main,x}"]:
        assert blocked(c), c
    # a bare / HEAD force push is judged by the current branch
    assert blocked("git push -f", "main") and blocked("git push --force origin HEAD", "master") and blocked("git push -f origin", "main")
    assert not blocked("git push -f", "feature") and not blocked("git push --force origin HEAD", "feature")
    # not force pushes: must pass (these were false positives of the old regex guard)
    for c in ["git push origin main", "git push", "git push -u origin main", "git push origin feature", "git push --follow-tags origin main",
              "git push -f origin feature", "git push --force-with-lease origin my-branch", "git push origin main && echo done",
              "git push 2>&1 | tail -1; cd /x; echo exit=$?", "git push origin main 2>&1 | tail -1",
              "git commit -m 'docs: explain git push -f and --force on main'", "echo 'git push -f origin main'",
              "git log --format=%h --follow main && git push origin feature", "tail -f log.txt; git push",
              "grep -rn 'git push' . | head && echo {a,b} $HOME `date`",
              "python3 - <<'EOF'\nprint('git push --force origin main {x}')\nEOF\ngit status",
              "cat <<EOF\ngit push -f origin main\nEOF", "git status; ls -lf; git pull --force origin main", "git push origin --delete old-branch"]:
        assert not blocked(c, "main"), c
    assert blocked("git push -f", "")  # branch unreadable (cd into a missing dir): fail closed
    assert analyze("git push -f origin 'unterminated", ".", on("x")) is not None  # unparseable + force-looking: fail closed
    assert analyze("echo 'unterminated", ".", on("main")) is None
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    else:
        sys.exit(main())
