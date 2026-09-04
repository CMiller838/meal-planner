## AGENT RESUME PROTOCOL

Before any `Agent` tool call, ask: is there already an agent in this session doing
this work?

- Check the running conversation for an `agentId`/name from a prior `Agent` call on the
  same task. If one exists, use `SendMessage` to it — never `Agent` again for that task.
- If unsure whether one is still live, call `ListAgents` first. A completed agent can
  still be resumed via `SendMessage` (it replays from its own transcript with full
  context) — "completed" is not a reason to spawn fresh.
- A fresh `Agent` call starts with zero context and re-derives everything the original
  agent already read/grepped/decided. That re-derivation is the expensive part, not the
  final write — a resumed agent redoing its own research is fine, a second agent redoing
  someone else's research is waste.
- This applies double to `subagent_type: "claude"` or any type with `tools: *` — such an
  agent can itself call `Agent`, so spawning one fresh to "continue" prior work risks it
  spawning a *third* fresh agent to actually do the work, compounding the re-derivation
  cost.
