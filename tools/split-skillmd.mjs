/**
 * Step 7 of the split: write the four SKILL.md files and their INDEX.md.
 *
 *   node tools/split-skillmd.mjs            # report lengths, write nothing
 *   node tools/split-skillmd.mjs --write
 *
 * The shared clauses are composed from ONE source here rather than pasted four times. They are the
 * clauses that were measured to matter: the imperative clause, the bare-symptom clause including
 * "is a QUESTION", and the exclusions. GQ-03 went from 0 of 9 to 5 of 5 on the bare-symptom clause
 * alone, so a copy of it drifting in one of four skills is a measurable regression, not a tidiness
 * problem.
 *
 * Each description must come in under the ~1536 char cap that description plus when_to_use SHARE,
 * measured on the PARSED value. That distinction is not pedantry: extension-doctor.mjs counted the
 * raw escaped text and reported this project's own skill 20 chars over when it was 2 under.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* REVERTED EXPERIMENT: THIS TOOL DOES NOT RUN.
 *
 * The four-skill cutover it belongs to was undone in 32adbf3, because four skills invoked the
 * library LESS than one: 22 of 36 against 26 of 36, below a floor of 26 that was frozen before
 * the run. skills/ holds a single skill again, nothing in this repo or in .github/workflows
 * calls this file, and any cc-ext-* loop inside it now iterates an EMPTY SET, so its checks
 * report success having examined nothing.
 *
 * It is kept rather than deleted because it is the apparatus of a measured negative, and
 * deleting it would make that measurement harder to reproduce. Set SPLIT_EXPERIMENT=1 to run it
 * deliberately. */
if (process.env.SPLIT_EXPERIMENT !== '1') {
  console.error('split-skillmd.mjs: the four-skill split was REVERTED in 32adbf3, and nothing calls this tool.');
  console.error('  skills/ holds one skill, so any cc-ext-* loop here iterates an empty set.');
  console.error('  Set SPLIT_EXPERIMENT=1 to run it deliberately.');
  process.exit(2);
}
const MAP = JSON.parse(readFileSync(join(ROOT, 'data', 'routing', 'skill-split.json'), 'utf8'));
const WRITE = process.argv.includes('--write');
const CAP = 1536;

/* The row each subject gets in its skill's "Where to look" table, lifted from the single skill's
   table so the wording a reader already knows survives the split. */
const LABEL = {
  'auto-memory.md': 'Auto memory', 'claude-md-family.md': 'CLAUDE.md family',
  'compatibility.md': 'Compatibility', 'output-styles.md': 'Custom Output Styles',
  'themes.md': 'Custom Themes', 'skills.md': 'Skills', 'testing.md': 'Testing and iteration',
  'hooks.md': 'Hooks', 'hook-events.md': 'Hook event contracts',
  'permissions.md': 'Permission rules: allow, ask, deny',
  'sandboxing.md': 'OS-level sandboxing (not on native Windows)',
  'monitors.md': 'Monitors [EXPERIMENTAL]', 'context-modes.md': 'Context modes',
  'subagents.md': 'Subagents', 'agent-teams.md': 'Agent Teams [EXPERIMENTAL]',
  'workflows.md': 'Dynamic Workflows', 'mcp.md': 'MCP servers',
  'channels.md': 'Channels [EXPERIMENTAL]', 'lsp.md': 'LSP / code intelligence',
  'plugins.md': 'Plugins', 'agent-sdk.md': 'Agent SDK', 'github-action.md': 'GitHub Action',
  'statusline.md': 'Status lines', 'sessions.md': 'Sessions, transcripts, resume, /rewind',
  'safety-classifier.md': 'Safety classifier', 'selection.md': 'Choosing between mechanisms',
  'composition-cards.md': 'Combining two mechanisms', 'sources.md': 'Evidence sources',
  'INDEX.md': 'I do not know which of these owns my question',
};

const SUBJECTS = {
  'cc-ext-enforcement-and-scope':
    'permission rules (allow, ask, deny), the OS sandbox, settings files and environment variables, what survives a session ending (transcripts, resume, /rewind), the safety classifier, and which build a capability exists on',
  'cc-ext-hooks-and-live-events':
    'hooks and hook events incl. Stop and Notification, monitors, channels, status lines, and testing an extension you have wired up',
  'cc-ext-delegation-and-instructions':
    'subagents, dynamic workflows, agent teams, skills, CLAUDE.md, rules, auto memory, and context modes',
  'cc-ext-packaging-and-integration':
    'plugins, MCP servers, the Agent SDK, the GitHub Action, LSP and code intelligence, output styles, and themes',
};

const CAPABILITY = {
  'cc-ext-enforcement-and-scope':
    'whether a key is honored at project scope or only user/managed/CLI scope, which tools a path rule is consulted for, and whether a rule exists on an older build',
  'cc-ext-hooks-and-live-events':
    'whether an event can BLOCK or only report, what a handler receives on stdin, and whether a matcher names a tool that exists',
  'cc-ext-delegation-and-instructions':
    'what a subagent receives and what it cannot see, which instruction file wins at which scope, and what a workflow may do',
  'cc-ext-packaging-and-integration':
    'what a plugin may ship, which scope an MCP server is resolved from, and whether a surface exists on an older build',
};

const IMPERATIVE = {
  'cc-ext-enforcement-and-scope': '"put our sandbox config in settings.json", "deny that tool", "make this rule apply to the repo"',
  'cc-ext-hooks-and-live-events': '"wire up a hook that...", "make it stop when X", "have it notify me on..."',
  'cc-ext-delegation-and-instructions': '"give the subagent access to...", "put that in CLAUDE.md", "spin up a team that..."',
  'cc-ext-packaging-and-integration': '"package this as a plugin", "add an MCP server for...", "ship this as an Action"',
};

const SYMPTOM = {
  'cc-ext-enforcement-and-scope': '"settings.json ignored", "where is settings.json", "how do I delete sessions", "permission rule not applying"',
  'cc-ext-hooks-and-live-events': '"stop hook notification", "stop hook not working", "hook never fires", "statusline blank"',
  'cc-ext-delegation-and-instructions': '"# memory not working", "CLAUDE.md ignored", "subagent cannot see the file", "skill never triggers"',
  'cc-ext-packaging-and-integration': '"MCP server not showing up", "plugin not loading", "output style has no effect"',
};

/* Identical in all four, by construction rather than by discipline.

   DRIFT, corrected 2026-08-19: the EXCLUSIONS tail below read "Name the page and stop." while
   the live description had moved to "Answer; name the page.". Those are not stylistic variants.
   SKILL.md records the stop-reading as a rule about SILENCE that LOST two blind pairwise
   comparisons to an arm carrying no relevant library at all, so this copy was preserving the
   losing instruction. tools/description-copy-check.mjs now fails if any tool's copy of a
   description clause diverges from SKILL.md again. */
const QUESTION_CLAUSE = 'A bare noun phrase is a QUESTION, not system output to acknowledge.';
const EXCLUSIONS = 'NOT for operating Claude Code rather than extending it: telemetry, permission MODES, containers and VMs, the token budget, the agents dashboard, usage and billing, IDE integrations, install and login. Answer; name the page.';
const SIBLINGS = 'If the question is about another extension mechanism, say so and name the sibling skill rather than answering from the nearest file here.';

export function describe(skill) {
  return [
    `Building, debugging, or reasoning about the limits of a Claude Code extension: ${SUBJECTS[skill]}.`,
    'Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave.',
    `ALSO capability and scope: ${CAPABILITY[skill]}.`,
    `ALSO for IMPERATIVE build requests, not only questions: ${IMPERATIVE[skill]}. They presuppose it can, and often it cannot.`,
    `ALSO for a BARE SYMPTOM or lookup with no artifact attached: ${SYMPTOM[skill]}. ${QUESTION_CLAUSE}`,
    SIBLINGS,
    EXCLUSIONS,
  ].join(' ');
}

const TITLE = {
  'cc-ext-enforcement-and-scope': 'Claude Code extensions: enforcement and scope',
  'cc-ext-hooks-and-live-events': 'Claude Code extensions: hooks and live events',
  'cc-ext-delegation-and-instructions': 'Claude Code extensions: delegation and instructions',
  'cc-ext-packaging-and-integration': 'Claude Code extensions: packaging and integration',
};

const LEGEND_SKILL = 'cc-ext-delegation-and-instructions';

function body(skill, files, words) {
  const rows = files.map((f) => `| ${LABEL[f] || f.replace(/\.md$/, '')} | [${f}](references/${f}) |`).join('\n');
  const wordLine = words.length
    ? `**Check the word before you check the shape.** If the question's key noun is ${words.map((w) => `\`${w}\``).join(', ')}, read the boundary table in [selection.md](references/selection.md) BEFORE opening INDEX.md. Each names a mechanism here and, separately, a Claude Code topic that is not here at all. Retrieval succeeds on the wrong one and reports nothing, because mechanically nothing went wrong.`
    : `This skill owns no ambiguous trigger noun. If a question's key noun is \`monitor\`, \`sandbox\`, \`permission\`, \`workflow\`, \`context\`, \`agent\`, \`session\` or \`classifier\`, it belongs to a sibling skill; name that skill rather than answering from the nearest file here.`;

  const legend = skill === LEGEND_SKILL
    ? `\n## How claims are tagged\n\nClaims are tagged by evidence: untagged is official documentation, \`[ANTHROPIC]\` is an\nAnthropic recommendation, \`[ENGINEERING]\` is engineering judgment, \`[COMMUNITY]\` is\ncommunity practice.\n\n\`[EXPERIMENTAL]\` means NOT STABLE, in either of two senses: off by default until a flag or\nsetting turns it on, or shipped but subject to change without notice.\n`
    : `\n## How claims are tagged\n\nThe evidence-tag legend lives in the delegation-and-instructions skill and in\n[sources.md](references/sources.md). The tags mean the same thing in every one of these skills.\n`;

  return `# ${TITLE[skill]}

## Before you wire anything up: check the request is possible

**An imperative is not a licence.** "Wire that up", "make it stop when X" presuppose the mechanism
can do what is being asked, and that presupposition is wrong often enough to check every time. The
costly failures in this domain are not syntax errors, they are configurations that parse, load, and
do nothing: an event that reports but **cannot block** wired to block, a key that is **inert in
project scope** written into the repo settings file, a path rule for a tool it is **never consulted
for**, a matcher naming a tool that **does not exist**. All four look correct in the file and all
four fail silently, so nobody finds out until the thing they were guarding against happens.

Before writing config: name the mechanism the request needs, open its reference, and confirm it can
do the thing **at the scope being asked for**. If it cannot, say so and give the nearest thing that
can. Say which half is deliverable when only half is.

## Before answering: open a reference

**If the question is diagnostic, capability, or scope shaped, open
[INDEX.md](references/INDEX.md) and read the reference it names before you answer.** Answering from
the shape of a settings file, or from the mechanism whose name the question happens to use, is the
failure mode this library exists to prevent.

${wordLine}

If no reference covers it, say what you could not confirm. A confident wrong mechanism claim is
indistinguishable from a correct one until it ships.

## This is one of four skills

The Claude Code extension library is split by the noun a question names:

| Skill | Owns |
|---|---|
| \`cc-ext-enforcement-and-scope\` | permission rules, the OS sandbox, settings scope, sessions, the safety classifier |
| \`cc-ext-hooks-and-live-events\` | hooks and hook events, monitors, channels, status lines, testing |
| \`cc-ext-delegation-and-instructions\` | subagents, workflows, agent teams, skills, CLAUDE.md, auto memory, context modes |
| \`cc-ext-packaging-and-integration\` | plugins, MCP, the Agent SDK, the GitHub Action, LSP, output styles, themes |

A question that spans two of them is answered by naming both, not by answering from whichever file
this skill happens to have.

## Where to look

| Need | Open |
|---|---|
${rows}
${legend}`;
}

let over = 0;
for (const [skill, spec] of Object.entries(MAP.skills)) {
  const files = [...spec.files, ...MAP.duplicatedIntoEverySkill.files].sort();
  const d = describe(skill);
  const flag = d.length > CAP ? ' OVER CAP' : '';
  if (d.length > CAP) over++;
  console.log(`${skill.padEnd(36)} description ${String(d.length).padStart(4)} / ${CAP}${flag}   ${files.length} reference files`);

  if (WRITE) {
    const dir = join(ROOT, 'skills', skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: ${JSON.stringify(d)}\n---\n\n${body(skill, files, spec.ownsCollisionWords)}`);
  }
}
if (over) { console.error(`\nFAIL: ${over} description(s) over the ${CAP} cap`); process.exit(1); }
console.log(`\n${WRITE ? 'wrote' : 'would write'} 4 SKILL.md files, every description under the cap.`);
