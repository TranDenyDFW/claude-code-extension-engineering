# Custom Output Styles

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


The only authored surface that modifies Claude's SYSTEM PROMPT rather than adding context to it. A markdown file with frontmatter whose instructions are appended to the system prompt while the style is active.

**Layer:** Context / Instruction | **Classification:** primitive | **Status:** stable | **Since:** v1.0.81

## What it is

- A custom output style is a markdown file with frontmatter whose body is appended to the system prompt. It lives in ~/.claude/output-styles, .claude/output-styles, or a managed-policy directory.  [v1.0.81]
- This is the only authored mechanism that modifies the system prompt. A Skill or CLAUDE.md adds context the model reads; an output style changes the instructions the model operates under.

## Contract and gotchas

- The keep-coding-instructions frontmatter key preserves the default software-engineering system prompt instead of replacing it; without it a style replaces that prompt wholesale.  [v2.0.37]
- Built-in styles (Default, Explanatory, Learning, Proactive) ship with Claude Code and are selected, not authored. Only the custom file is an extension point.  [v1.0.81]
- Plugins ship output styles through an output-styles/ directory or the outputStyles manifest key.
- The /output-style command was removed at v2.1.91; on current builds selection is through /config or the outputStyle setting. Verify the activation path on your build before documenting it.  [v2.1.91]

## Failure posture

- An output style cannot fail closed, because it is system-prompt text rather than enforcement. If the style is not selected, not loaded, or overridden by a plugin style with force-for-plugin, the session simply behaves as Default and says nothing about it  [ENGINEERING]  [v2.1.220]
- It is also read ONCE at session start, so a mid-session edit appears to do nothing until /clear or a new session. That silence is the most common reason a style looks broken when it is merely not yet loaded  [OFFICIAL]  [v2.1.220]

## Writing a style that survives the session

The mechanism above is about loading. This is about the TEXT, which is where a style actually fails. None of the following is documented; it is practice observed in shipped styles, and a live instance running in this project exhibits six of the seven.

- State PERSISTENCE explicitly: the style applies to every response and does not lapse after many turns. The library already records WHEN a style is loaded, under Contract and gotchas above, which is a fact about LOADING; whether an instruction decays in EFFECT across a long session is a behavioural question this library has not measured, and the clause is cheap insurance either way  [ENGINEERING]
- Name one or two EXACT deactivation phrases and refuse to stop for anything else. Without a named off switch a model drops the style on any vaguely negative signal, which reads to the user as the style being broken rather than dismissed  [ENGINEERING]
- Give the style an ESCAPE HATCH and name the situations that trigger it, safety warnings and irreversible-action confirmations being the obvious ones. A compression or persona style with no stated exemption either mangles a warning or gets abandoned wholesale the first time it would  [ENGINEERING]
- Ship GRADED INTENSITY LEVELS rather than one on/off behaviour, so a user who finds it too strong dials it down instead of switching it off. Pairs with the named off switch: one control for degree, one for stopping  [ENGINEERING]
- Forbid SELF-REFERENCE. The style must never name, tag or recap itself in the response, because a style that announces itself has spent output on describing what the reader can already see  [ENGINEERING]
- Do not invent abbreviations to save tokens. The claim is falsifiable and it fails: a coined short form is split by the tokenizer much as the full word is, so it costs about the same and reads worse. Standard well-known acronyms are a different case  [ENGINEERING]
- UNVERIFIED, do not adopt as fact: one source reinforces a style with a per-turn UserPromptSubmit reminder on the theory that a once-per-session system-prompt instruction is outcompeted by content injected every turn. If true it would be a real limit on output styles and would sit directly beside the read-once fact above. It is a behavioural claim, this library has not measured it, and the workaround costs a hook on every message  [ENGINEERING]
