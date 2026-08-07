# Custom Themes

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


User-authored named colour themes as JSON. Cosmetic, not a behaviour primitive, but authored and plugin-distributable, so it belongs on the map.

**Layer:** Context / Instruction | **Classification:** primitive | **Status:** stable | **Since:** v2.1.118

## What it is

- Named custom themes are JSON files under ~/.claude/themes/, created through the /theme colour editor or hand-edited.  [ANTHROPIC] [v2.1.118]
- Plugins ship themes via a themes/ directory, but from v2.1.129 themes and monitors must be declared under the manifest's experimental key.  [ANTHROPIC] [EXPERIMENTAL] [v2.1.129]
- A theme is cosmetic. It changes no model behaviour, so it is never the answer to a capability question.  [ENGINEERING]
