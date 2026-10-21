#!/usr/bin/env python3
"""PreToolUse(Bash): refuse a force-push to main/master. Exit 2 blocks; stderr is the reason Claude sees.

Parses the command with shlex instead of regex-matching the whole string, so text that merely mentions a push (a heredoc
body, a commit message, `echo`, `$?` in another command of the chain) is never mistaken for one. Any `git [opts] push ...`
found in a command segment is judged on its own arguments, wherever it sits (after `timeout -s KILL 5`, `env -u X`,
`ssh host`, `then`, `xargs`...), except in segments whose program only prints text (echo, grep, cat...):
  force  = --force* / an unambiguous abbreviation (--for...) / --mirror / a short-flag group holding f / a +refspec
  target = a refspec naming main or master (HEAD and @ mean the current branch), or no refspec at all (a bare push sends
           the current branch, read from the directory the command runs in, following `cd` and `git -C`)
Fails closed: a push whose arguments hold a shell expansion ($ ` {} * ?), forced --mirror/--all, a current branch that
cannot be read, an unparseable command that looks like a force push, `$(...)` and backticks (parsed as commands, also
inside double quotes), `bash -c '...'`/`eval` and heredocs fed to a shell (parsed the same way), and any error in this
script or an unreadable payload (the wrapper turns every non-zero, non-zero-but-not-2 exit into a block too).
ponytail: a parser, not a shell (an alias, a script, or an interpreter heredoc such as `python3 - <<EOF` can still hide a
push); GitHub branch protection (no force-push on main) is the real backstop.

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
TEXT_ONLY = {"echo", "printf", "cat", "ls", "wc", "head", "tail", "which", "type"}  # programs that never run their arguments
GIT_OPTS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
PUSH_OPTS_WITH_VALUE = {"-o", "--push-option", "--receive-pack", "--exec"}
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)(\w+)\1([^\n]*)\n(.*?)\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
BACKTICKS = re.compile(r"`([^`]*)`", re.S)


def substitutions(cmd):
    """Bodies of $(...) (balanced, nested ones included in their parent's body) and `...`; None when a $( never closes."""
    out, i = [], 0
    while True:
        i = cmd.find("$(", i)
        if i < 0:
            break
        depth, j = 1, i + 2
        while j < len(cmd) and depth:
            depth += {"(": 1, ")": -1}.get(cmd[j], 0)
            j += 1
        if depth:
            return None
        out.append(cmd[i + 2:j - 1])
        i += 2
    return out + BACKTICKS.findall(cmd)


def current_branch(cwd):
    try:
        r = subprocess.run(["git", "-C", cwd or ".", "symbolic-ref", "--short", "HEAD"], capture_output=True, text=True, timeout=10)
        return r.stdout.strip()
    except Exception:
        return ""  # unreadable: the caller fails closed


def split_heredocs(cmd):
    """Return (command with heredoc bodies removed, bodies that a shell will execute)."""
    bodies = []

    def drop(m):
        header = cmd[cmd.rfind("\n", 0, m.start()) + 1:m.start()] + m.group(3)
        if re.search(r"\b(bash|sh|zsh|dash|ksh|eval|source)\b", header):
            bodies.append(m.group(4))
        return f"<<{m.group(2)}{m.group(3)}"

    return HEREDOC.sub(drop, cmd), bodies


def tokens_of(cmd):
    """Shell tokens; backticks and newlines act as command separators."""
    lex = shlex.shlex(cmd.replace("`", " ; ").replace("\n", " ; "), posix=True, punctuation_chars=True)
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
    for t in seg:
        if skip:
            skip = False
        elif re.fullmatch(r"[<>&|]+", t):
            skip = True
            if out and out[-1].isdigit():
                out.pop()  # the fd in 2>&1
        else:
            out.append(t)
    return out


def first_program(seg):
    """Basename of the first real program (VAR=value assignments skipped)."""
    for t in seg:
        if not re.match(r"^[A-Za-z_]\w*=", t):
            return os.path.basename(t)
    return ""


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


def force_target(args, cwd, branch_of, stdin_args=False):
    """Reason string if this push cannot be shown safe, i.e. it force-updates (or may force-update) a protected branch.
    stdin_args: more arguments arrive on stdin (xargs), so the target is unknown."""
    if any(re.search(r"[$`{}*?]", x) for x in args):
        return "a push whose arguments hold a shell expansion cannot be checked (write the remote and branch out)"
    force = mirror = all_refs = has_repo = False
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        if a in PUSH_OPTS_WITH_VALUE:
            i += 2
            continue
        if a == "--repo":
            has_repo = True
            i += 2
            continue
        if a.startswith("--"):
            name = a.split("=")[0]
            if name == "--repo":
                has_repo = True
            elif name.startswith("--force") or (len(name) >= 5 and "--force".startswith(name)):
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
    refs = pos if has_repo else pos[1:]  # the first positional is the remote unless --repo named it
    force = force or any(r.startswith("+") for r in refs)
    if not force:
        return None
    if stdin_args:
        return "a force push whose arguments come from stdin (xargs) cannot be checked"
    if mirror or all_refs:
        return "a forced --mirror/--all push updates every branch, main included"
    branch = branch_of(cwd)
    for r in pos + ([] if refs else ["HEAD"]):  # every positional is checked: the remote cannot be told from a ref reliably
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
    if depth > 4:
        return "commands nested too deeply to check"
    cmd, bodies = split_heredocs(cmd)
    subs = substitutions(cmd)
    if subs is None:
        return "an unclosed $( cannot be checked"
    for inner in bodies + subs:
        why = analyze(inner, cwd, branch_of, depth + 1)
        if why:
            return why
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
        prog = first_program(seg)
        if prog in TEXT_ONLY:
            continue
        for k, t in enumerate(seg):  # a shell or eval anywhere (env bash -c, timeout 5 sh -c): its string arguments are commands
            if os.path.basename(t) in SHELLS or t == "eval":
                for inner in seg[k + 1:]:
                    if not inner.startswith("-") and re.search(r"\bpush\b", inner):
                        why = analyze(inner, cwd, branch_of, depth + 1)
                        if why:
                            return why
        for j, t in enumerate(seg):  # a git anywhere in the segment, whatever wraps it (timeout -s KILL 5, ssh h, then...)
            if os.path.basename(t) == "git":
                got = push_args(seg[j:], cwd)
                if got:
                    why = force_target(got[0], got[1], branch_of, stdin_args=prog == "xargs")
                    if why:
                        return why
    return None


def main():
    try:
        payload = json.load(sys.stdin)
        cmd = payload.get("tool_input", {}).get("command", "")
        cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or "."
        why = analyze(cmd, cwd)
    except Exception as e:  # never fail open: an error here blocks the command
        print(f"Blocked: the force-push guard failed ({type(e).__name__}: {e}).", file=sys.stderr)
        return 2
    if why:
        print(f"Blocked: {why}. Force-pushing to main/master is banned.", file=sys.stderr)
        return 2
    return 0


def _selftest():
    on = lambda b: (lambda cwd: b)
    blocked = lambda c, b="feature": analyze(c, ".", on(b)) is not None
    # real force pushes to main/master, in every spelling and wrapper
    for c in ["git push -f origin main", "git push --force origin master", "git push origin main --force", "git push -uf origin main",
              "git push --force-with-lease origin main", "git push --for origin main", "git push origin +main", "git push origin +HEAD:main",
              "git push origin HEAD:refs/heads/main -f", "git push -f origin 'main'", 'git push "--force" origin main',
              "git -C /x push -f origin main", "cd /x && git push -f origin master", "FOO=1 git push -f origin main",
              "timeout 60 git push -f origin main", "git add . && git commit -m x && git push -f origin main",
              "bash -c 'git push -f origin main'", 'eval "git push --force origin main"', "git push --mirror -f", "git push --mirror",
              "git push -f origin $BRANCH", "git push -f origin {main,x}", "git push origin $BRANCH",
              # wrappers with option values, shell keywords, remote shells, xargs
              "timeout -s KILL 5 git push -f origin main", "env -u X git push -f origin main", "sudo -u bob git push -f origin main",
              "nice -n 5 git push -f origin main", "if true; then git push -f origin main; fi", "while x; do git push -f origin main; done",
              "ssh host git push -f origin main", "echo main | xargs git push -f origin", "! git push -f origin main", "time git push -f origin main",
              # substitutions, also inside quotes; heredocs a shell runs
              "echo $(git push -f origin main)", 'echo "$(git push -f origin main)"', "echo `git push -f origin main`",
              "bash <<EOF\ngit push -f origin main\nEOF", "cat <<EOF | sh\ngit push -f origin main\nEOF",
              "timeout 5 bash -c 'git push -f origin main'", "env X=1 sh -c \"git push -f origin master\"", 'echo "$(echo $(git push -f origin main))"',
              "echo $(git push -f origin main", "grep x f | sort | git push -f origin main",
              # --repo shifts the positionals: main is a refspec, not the remote
              "git push -f --repo origin main", "git push --repo=origin -f main", "git push -f main"]:
        assert blocked(c), c
    # a bare / HEAD force push is judged by the current branch; an unreadable branch fails closed
    assert blocked("git push -f", "main") and blocked("git push --force origin HEAD", "master") and blocked("git push -f origin", "main")
    assert not blocked("git push -f", "feature") and not blocked("git push --force origin HEAD", "feature")
    assert blocked("git push -f", "")
    # not force pushes, no expansions: must pass (these were false positives of the old regex guard)
    for c in ["git push origin main", "git push", "git push -u origin main", "git push origin feature", "git push --follow-tags origin main",
              "git push -f origin feature", "git push --force-with-lease origin my-branch", "git push origin main && echo done",
              "git push 2>&1 | tail -1; cd /x; echo exit=$?", "git push origin main 2>&1 | tail -1",
              "git commit -m 'docs: explain git push -f and --force on main'", "echo 'git push -f origin main'", "echo git push -f origin main",
              "git log --format=%h --follow main && git push origin feature", "tail -f log.txt; git push",
              "grep -rn 'git push' . | head && echo {a,b} $HOME `date`",
              "python3 - <<'EOF'\nprint('git push --force origin main {x}')\nEOF\ngit status",
              "cat <<EOF\ngit push -f origin main\nEOF", "git status; ls -lf; git pull --force origin main", "git push origin --delete old-branch",
              "if true; then git status; fi", "timeout -s KILL 5 git status", "git commit -m \"$(echo hi)\"",
              'echo "$(echo $(git status))"', "timeout 5 bash -c 'git status'"]:
        assert not blocked(c, "main"), c
    assert analyze("git push -f origin 'unterminated", ".", on("x")) is not None  # unparseable + force-looking: fail closed
    assert analyze("echo 'unterminated", ".", on("main")) is None
    # main() never fails open
    import io
    sys.stdin = io.StringIO("not json")
    assert main() == 2
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    else:
        sys.exit(main())
