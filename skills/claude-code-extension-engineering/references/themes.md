# Custom Themes

> Claude Code 2.1.239. What that means here: this file carries NO verbatim quotes, so the quote gate
> says nothing about it. Per-claim provenance lives in `evidence/claims.jsonl`, where the gates read
> it; nothing else is asserted here.


User-authored named colour themes as JSON. Cosmetic, not a behaviour primitive, but authored and plugin-distributable, so it belongs on the map.

**Layer:** Context / Instruction | **Classification:** primitive | **Status:** stable | **Since:** v2.1.118

## What it is

- Named custom themes are JSON files under ~/.claude/themes/, created through the /theme colour editor or hand-edited.  [ANTHROPIC] [v2.1.118]
- Plugins ship themes via a themes/ directory, but from v2.1.129 themes and monitors must be declared under the manifest's experimental key.  [ANTHROPIC] [EXPERIMENTAL] [v2.1.129]
- A theme is cosmetic. It changes no model behaviour, so it is never the answer to a capability question.  [ENGINEERING]
