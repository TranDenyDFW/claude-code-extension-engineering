# Custom Themes

> Claude Code 2.1.220, verified 2026-07-29. Delta from 2.1.219: none (changelog: bug fixes and reliability improvements only).


User-authored named colour themes as JSON. Cosmetic, not a behaviour primitive, but authored and plugin-distributable, so it belongs on the map.

**Layer:** Context / Instruction &middot; **Classification:** primitive &middot; **Status:** stable &middot; **Since:** v2.1.118

## What it is

- Named custom themes are JSON files under ~/.claude/themes/, created through the /theme colour editor or hand-edited.  [ANTHROPIC] [v2.1.118]
- Plugins ship themes via a themes/ directory, but from v2.1.129 themes and monitors must be declared under the manifest's experimental key.  [ANTHROPIC] [EXPERIMENTAL] [v2.1.129]
- A theme is cosmetic. It changes no model behaviour, so it is never the answer to a capability question.  [ENGINEERING]
