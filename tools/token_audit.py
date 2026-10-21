"""Token spend per subagent type from Claude Code transcripts (stdlib only).
Usage: python3 tools/token_audit.py   (run at project-retro; compare to plan-phase's ~100k budget)
"""
import collections, glob, json, os

# Claude Code names the transcript dir after the project path, with / and . replaced by -
_proj = os.getcwd().replace('/', '-').replace('.', '-')
root = os.path.expanduser(f'~/.claude/projects/{_proj}')
by = collections.defaultdict(lambda: [0, 0, 0, 0, 0])  # runs, turns, fresh, cached, out
for f in glob.glob(f'{root}/*/subagents/*.jsonl'):
    try:
        typ = json.load(open(f.replace('.jsonl', '.meta.json'))).get('agentType', '?')
    except (OSError, ValueError):
        typ = '?'
    a = by[typ]
    a[0] += 1
    for line in open(f):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        u = (d.get('message') or {}).get('usage') if d.get('type') == 'assistant' else None
        if u:
            a[1] += 1
            a[2] += u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
            a[3] += u.get('cache_read_input_tokens', 0)
            a[4] += u.get('output_tokens', 0)
for t, (n, turns, fresh, cached, out) in sorted(by.items(), key=lambda kv: -kv[1][2]):
    print(f'{t:18} runs={n:3} avg turns={turns // n:3} fresh={fresh // n:>8,} cached={cached // n:>10,} out={out // n:>7,}')
