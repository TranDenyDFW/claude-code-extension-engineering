# Safety classifiers and model fallback

> Claude Code 2.1.224, verified 2026-08-12. What that means here: every claim below was checked
> against a live fetch of the Model configuration page on that date. Its sourcing is THINNER than
> its siblings and that is recorded rather than glossed: this file rests on one page, where the
> status line and session references each rest on dedicated pages of their own. The refusal-message
> wording in the error reference is NOT restated here, because that page is `verified-partial` and
> the relevant sections sit in the part of it that two fetches failed to return. It carries NO
> verbatim quotes, so the quote gate says nothing about it.


Why a request is refused, or is silently answered by a different model than the one selected. This
is a BEHAVIOUR reference rather than an authoring surface: there is nothing here to build, and it
exists because the observable symptom, a refusal on benign-looking work or a model that changed
underneath you, is otherwise unattributable.

**Layer:** Runtime behaviour | **Classification:** builtin | **Status:** stable

## Read this first: two unrelated things are called a classifier

- The CONTENT safety classifier described here evaluates a request for cybersecurity and biology content and can cause a refusal or a model switch, while the AUTO-MODE classifier described in `sandboxing.md` evaluates a shell command to decide whether to prompt for permission: they share a word and nothing else, and answering a refusal question with auto-mode behaviour is the predictable error a keyword search invites. [ENGINEERING]

## What actually happens

- Fable 5 and Opus 5 run with safety classifiers for cybersecurity and biology content, and when a classifier flags a request AND the flagged category has a fallback model, the request is re-run on that model with a notice in the transcript. [OFFICIAL]
- The fallback target depends on which model refused and which category was flagged: Fable 5 sends biology to Opus 5 and cybersecurity to Opus 4.8, while Opus 5 sends cybersecurity to Opus 4.8 and its biology flags END IN A REFUSAL because Opus 5 runs its own biology classifiers with no fallback model. [OFFICIAL]
- After a fallback the session CONTINUES on the fallback model and returning to the original is a deliberate act, so a session can quietly stay on a different model than the one selected. [OFFICIAL]
- Category-based fallback requires v2.1.219 or later; before that every flagged Fable 5 request re-ran on the provider's default Opus model and Opus 5 was not a fallback source at all. [OFFICIAL] [v2.1.219]
- The fallback target is checked against `availableModels`, and when the target is blocked there NO fallback occurs, the refusal surfaces as a normal error and the session's model is unchanged, so a restriction intended as governance converts a silent recovery into a visible failure. [OFFICIAL]

## Why it can fire on work that is obviously benign

- A flag can trigger on the FIRST request of a session, before anything unusual is sent, because that request carries workspace context such as CLAUDE.md content and git status, so a repository holding security or biology material can trip the classifier on that context alone. [OFFICIAL]
- `claude --safe-mode` starts a session with customizations disabled, including CLAUDE.md, skills, MCP servers and hooks, which is the documented way to test whether local context is the trigger, though git status and directory names are not customizations and are still included, so it narrows the cause without eliminating it. [OFFICIAL]

## Taking the decision back

- Setting `switchModelsOnFlag` to false, or using the equivalent `/config` toggle, stops the automatic switch so a flagged request pauses and offers two options: switch to the fallback, or edit the prompt and retry on the current model. [OFFICIAL]
- The pause is not offered when the flagged category has no fallback model, such as a biology flag on Opus 5, where the request simply ends in the refusal, and on mobile web sessions editing and retrying is not available at all. [OFFICIAL]

## Failure posture

- None of this is an extension point: there is no setting that disables the classifiers, the only authored control is whether the switch happens automatically or asks, and a plan depending on suppressing a safety refusal has no mechanism to build on, so saying that is the correct answer rather than naming a setting that does something adjacent. [ENGINEERING]
- The observable symptom of a fallback is a model change rather than an error, so a session reporting different capability than expected, or billing against a different model, may have fallen back several turns earlier. [ENGINEERING]

## What this file does NOT cover

- The exact refusal message strings and their version history live in the error reference, which this library records as `verified-partial` because two fetches on 2026-08-05 returned its message-index rows but not its tail where those sections sit, so they are deliberately not restated here on the strength of an unconfirmed fetch. [ENGINEERING]

## Definition of Done

- The content classifier and the auto-mode permission classifier are kept apart in the answer
- A refusal is attributed to a category and a model, not to a settings key
- `--safe-mode` is used to test the local-context hypothesis before blaming the request
- Any claim about refusal wording is checked against a live fetch first
